"""Disk-backed caches for mgz-pkmn.

Three stores live under `$XDG_CACHE_HOME/mgz-pkmn` (or `~/.cache/mgz-pkmn`):

- **api/<sha1>.json** — one file per upstream API request URL. TTL is enforced
  via mtime; reads older than `DEFAULT_API_TTL_SECONDS` miss and force a
  re-fetch. Saves bandwidth and API quota across consecutive runs since most
  users iterate over the same card lists with small tweaks.

- **url_overrides.json** — single-file map of `(name, set_hint)` →
  PriceCharting URL. Populated whenever the user pastes a PC URL on a line.
  On future runs, a line with the same `(name, set_hint)` but no URL picks
  up the previously-recorded one automatically. Lets the user paste a URL
  once and forget it.

- **images/<category>/<key>.<ext>** — binary image blobs (set logos, set
  symbols, card art). **No TTL.** Set images don't change once a set ships,
  so the cost of an occasional stale image is far below the cost of
  re-downloading the catalog every show. Cleared explicitly via
  `clear_image_cache()`; survives `clear_api_cache()` so a "wipe stale API
  payloads" never re-downloads tens of megabytes of stable artwork.

Disk persistence is opt-out via `MGZ_PKMN_NO_CACHE=1` (the CLI's `--no-cache`
flag sets this) so a clean run skips every store entirely. There is no LRU
eviction — the cache is small (KB per query for API; a few MB per warmed
set catalog for images) and clearing is a manual
`rm -rf ~/.cache/mgz-pkmn` away."""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import requests

DEFAULT_API_TTL_SECONDS = 7 * 24 * 60 * 60  # one week
DEFAULT_CACHE_WARN_BYTES = 50 * 1024 * 1024  # 50 MB
CONCEPT_WARM_STALE_SECONDS = 24 * 60 * 60  # one day — once-per-day startup gate
# Set-cards warm pass is much heavier (~500 HTTP requests for the whole
# catalog) and the underlying data turns over much more slowly than the
# concept dictionary — cards within a released set effectively don't
# change, only market prices drift. A weekly cadence matches the API
# response cache's own TTL: once a set-cards warm pass lands, every
# entry it primed survives until the API cache itself expires.
SET_CARDS_WARM_STALE_SECONDS = 7 * 24 * 60 * 60  # one week
# Set-image warm pass (set logos + symbols, ~200 sets x 2 images = ~400
# HTTP requests). Same weekly cadence as set-cards: indefinite TTL on the
# image bytes themselves, but the manifest's freshness gate keeps the
# runtime lifespan bootstrap from re-walking every container restart.
SETS_WARM_STALE_SECONDS = 7 * 24 * 60 * 60  # one week
# Per-card structural warm. The full card object (name, set, number,
# rarity, attacks, weaknesses, resistances, retreatCost, legalities,
# ancientTrait, images, ...) doesn't change once a card is printed, so
# the stale window is generous. Phase 1 of the pre-Scrydex catalog-warm
# epic (#368) populates this slice across the entire English catalog
# while pokemontcg.io is still free.
CARD_WARM_STALE_SECONDS = 7 * 24 * 60 * 60  # one week
_NO_CACHE_ENV = "MGZ_PKMN_NO_CACHE"
_WARN_BYTES_ENV = "MGZ_PKMN_CACHE_WARN_BYTES"
_OVERRIDES_FILE = "url_overrides.json"
_CONCEPT_WARM_FILE = "concept_warm.json"
_SET_CARDS_WARM_FILE = "set_cards_warm.json"
_SETS_WARM_FILE = "sets_warm.json"
_CARD_WARM_FILE = "card_warm.json"
OVERRIDES_SCHEMA_VERSION = 1
CONCEPT_WARM_SCHEMA_VERSION = 1
SET_CARDS_WARM_SCHEMA_VERSION = 1
SETS_WARM_SCHEMA_VERSION = 1
CARD_WARM_SCHEMA_VERSION = 1
_IMAGES_SUBDIR = "images"
# Allowed image extensions for read-side discovery; write-side derives the
# extension from the source URL but normalises it through this list so an
# unexpected suffix doesn't end up on disk.
_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".svg")

# Per-run counters for the API response cache: hits = served from disk,
# fetches = written after a successful network call. Reset at the start of
# each `pkmn lookup` invocation so the summary line reflects only that run.
_api_hits = 0
_api_fetches = 0


@dataclass(frozen=True)
class CacheStats:
    """Snapshot of disk-cache usage. Returned by `stats()` for the CLI to render.

    `api_oldest_mtime` is None when the API cache holds no entries — callers
    should treat that as "no oldest" rather than an unfilled field.

    `image_entry_count` / `image_bytes` cover the indefinite-TTL image slice
    (set logos, set symbols, card art). They live in their own bucket because
    they survive `clear_api_cache()` and tend to dominate the total once a
    set catalog has been warmed."""

    root: Path
    api_entry_count: int
    api_bytes: int
    api_oldest_mtime: float | None
    override_count: int
    override_bytes: int
    image_entry_count: int
    image_bytes: int
    # Concept-warm slice — populated from the `concept_warm.json` manifest
    # written by `pkmn cache warm-concepts`. `concept_warm_timestamp` is
    # None when no warm pass has been recorded yet; the CLI renders that as
    # "concept cache: not warmed" so the operator knows the state at a glance.
    concept_warm_timestamp: float | None
    concept_warm_names: int
    # Set-cards warm slice — populated from `set_cards_warm.json`, written by
    # `pkmn cache warm-set-cards`. Same shape as the concept slice: None
    # timestamp renders as "not warmed", and the count tracks how many
    # sets had their full card list primed during the most recent pass.
    set_cards_warm_timestamp: float | None
    set_cards_warm_count: int
    # Sets (logos/symbols) warm slice — populated from `sets_warm.json`,
    # written by `pkmn cache warm-sets` and by the runtime startup warm
    # bootstrap. Tracks how many sets had their logo + symbol images
    # primed during the most recent pass. None timestamp renders as
    # "not warmed". Image bytes themselves still carry indefinite TTL —
    # this manifest only gates the *re-walk* of upstream metadata.
    sets_warm_timestamp: float | None
    sets_warm_count: int
    # Per-card structural warm slice — populated from `card_warm.json`,
    # written by `pkmn cache warm-cards`. Phase 1 of the pre-Scrydex
    # catalog-warm epic (#368). `card_warm_count` is the total number of
    # cards whose full structural payload landed in the API cache slice
    # during the most recent pass; `card_warm_failed_count` is the
    # number that didn't (set queries that returned no results, etc.).
    card_warm_timestamp: float | None
    card_warm_count: int
    card_warm_failed_count: int


def _disabled() -> bool:
    """Honour `MGZ_PKMN_NO_CACHE=1` — when set, every cache read misses and
    every write is a no-op. Used by the `--no-cache` CLI flag for clean runs."""
    return os.environ.get(_NO_CACHE_ENV, "").strip() not in ("", "0", "false", "False")


def _cache_root_path() -> Path:
    """Compute the cache root path without creating it.

    Read-only counterpart to `cache_root()` — used by pre-flight checks
    (size warning, etc.) that shouldn't have the side effect of creating
    a cache directory on a fresh install or read-only filesystem."""
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "mgz-pkmn"


def cache_root() -> Path:
    """Resolve the cache directory, creating it lazily.

    Honours `XDG_CACHE_HOME` so users with a custom cache layout aren't
    overridden, and falls back to `~/.cache/mgz-pkmn` otherwise. Safe to
    call repeatedly — `mkdir(parents=True, exist_ok=True)` is idempotent."""
    root = _cache_root_path()
    root.mkdir(parents=True, exist_ok=True)
    return root


def cache_warn_threshold() -> int:
    """Resolve the soft-warn threshold for total cache size, in bytes.

    Reads `MGZ_PKMN_CACHE_WARN_BYTES` (an integer byte count) when set;
    unset / empty / unparseable values fall back to `DEFAULT_CACHE_WARN_BYTES`
    (50 MB). Only an explicit non-positive integer (`0` or negative) disables
    the warning — callers treat `<= 0` as "do not warn"."""
    raw = os.environ.get(_WARN_BYTES_ENV, "").strip()
    if not raw:
        return DEFAULT_CACHE_WARN_BYTES
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_CACHE_WARN_BYTES


def cache_size_bytes() -> int:
    """Total on-disk cache size in bytes (API + URL overrides + images).

    Stat-only — no payload reads, no JSON parsing, and no side effects: the
    cache directory is not created if it doesn't exist yet. Safe to call at
    every CLI startup as a cheap pre-flight check. Returns 0 when the cache
    root is missing (fresh install, post-`rm -rf`, read-only $HOME, etc.)."""
    root = _cache_root_path()
    if not root.exists():
        return 0
    total = 0
    api_dir = root / "api"
    if api_dir.exists():
        try:
            entries = list(api_dir.iterdir())
        except OSError:
            entries = []
        for entry in entries:
            if not entry.is_file() or entry.suffix != ".json":
                continue
            with contextlib.suppress(OSError):
                total += entry.stat().st_size
    overrides = root / _OVERRIDES_FILE
    with contextlib.suppress(OSError):
        total += overrides.stat().st_size
    images_dir = root / _IMAGES_SUBDIR
    if images_dir.exists():
        # Image cache is one level deeper than `api/`: `images/<category>/...`.
        # `rglob("*")` is fine here because the dir tree is shallow (categories
        # + leaf files) and the stat-only walk costs O(entries).
        try:
            entries = [p for p in images_dir.rglob("*") if p.is_file()]
        except OSError:
            entries = []
        for entry in entries:
            with contextlib.suppress(OSError):
                total += entry.stat().st_size
    return total


# ---------------------------------------------------------------------------
# API response cache (per URL).
# ---------------------------------------------------------------------------


def _api_path(key: str) -> Path:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    api_dir = cache_root() / "api"
    api_dir.mkdir(parents=True, exist_ok=True)
    return api_dir / f"{digest}.json"


def read_api(key: str, ttl_seconds: float = DEFAULT_API_TTL_SECONDS) -> Any | None:
    """Return the cached payload for `key` if it exists and isn't past its TTL.

    `key` is expected to be a fully-qualified request URL — same URL hashes
    to the same path. Returns None on miss, expiry, or any I/O / JSON error
    (caller falls through to a network fetch). A successful return bumps the
    per-run hit counter (see `api_counters()`)."""
    if _disabled():
        return None
    p = _api_path(key)
    if not p.exists():
        return None
    if time.time() - p.stat().st_mtime > ttl_seconds:
        return None
    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    global _api_hits
    _api_hits += 1
    return payload


def clear_api_cache() -> int:
    """Remove every cached API response. Returns the number of files deleted.

    URL overrides are intentionally preserved — they're user-supplied
    PriceCharting URLs that take the user real effort to find, while API
    responses are regenerable on the next run. Use this when a normalizer
    schema changes (a new field on cards, a tweak to the language detector,
    etc.) and the cached payloads no longer reflect the current code.

    Honoured even when `MGZ_PKMN_NO_CACHE=1` is set: the user explicitly
    asked for a wipe, and a no-op surprise would defeat the purpose."""
    api_dir = cache_root() / "api"
    if not api_dir.exists():
        return 0
    count = 0
    for entry in api_dir.iterdir():
        if entry.is_file() and entry.suffix == ".json":
            try:
                entry.unlink()
                count += 1
            except OSError:
                continue
    return count


def write_api(key: str, data: Any) -> None:
    """Persist `data` (any JSON-serialisable value) to the cache under `key`.

    Atomic write: payload goes to a sibling `.tmp` file and then renames.
    A failed serialisation or rename is silently ignored — caching is best
    effort, never a hard requirement. A successful write bumps the per-run
    fetch counter (see `api_counters()`); callers only invoke this after a
    successful network fetch, so it doubles as the fetch tally."""
    if _disabled():
        return
    try:
        p = _api_path(key)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(p)
    except (OSError, TypeError, ValueError):
        return
    global _api_fetches
    _api_fetches += 1


def reset_api_counters() -> None:
    """Zero the per-run hit/fetch counters. Called at `pkmn lookup` start so
    the summary reflects only the current run, not any prior in-process state
    (matters for the test suite, where many runs share an interpreter)."""
    global _api_hits, _api_fetches
    _api_hits = 0
    _api_fetches = 0


def api_counters() -> tuple[int, int]:
    """Return `(hits, fetches)` accumulated since the last `reset_api_counters`.

    `hits` is the number of `read_api` calls that served a cached payload;
    `fetches` is the number of `write_api` calls that successfully persisted
    a freshly-fetched payload. The CLI summary reads this snapshot to render
    the `· N cached / M fetched` tail."""
    return (_api_hits, _api_fetches)


# ---------------------------------------------------------------------------
# URL overrides (sticky PriceCharting hints).
# ---------------------------------------------------------------------------


def _overrides_path() -> Path:
    return cache_root() / _OVERRIDES_FILE


def _override_key(name: str, set_hint: str | None) -> str:
    """Normalise (name, set) into a single case-insensitive key.

    The user may write the same card slightly differently across runs
    (`Penny | S&V Base` vs `Penny | s&v base`). Lower-casing collapses
    those into a single override; the `|` separator avoids collisions
    between e.g. `Mew Two | Set` and `Mew | Two | Set`."""
    return f"{name.lower().strip()}|{(set_hint or '').lower().strip()}"


def _extract_overrides(data: Any) -> dict[str, str]:
    """Pull the `name|set → URL` map out of a parsed overrides document.

    Recognises two on-disk shapes:

    - **Versioned** (current): `{"schema_version": N, "overrides": {...}}`.
      Future schema bumps will key off `schema_version` to drive migrations;
      for now any integer version is accepted and the `overrides` payload is
      read as-is.
    - **Legacy** (pre-#18): a bare `{name|set: url, ...}` flat dict. Read
      transparently so existing user caches keep working — the next write
      upgrades the file to the versioned shape.

    Anything else (non-dict, missing `overrides` key, non-dict payload)
    returns `{}` so a corrupt file doesn't take down a lookup run."""
    if not isinstance(data, dict):
        return {}
    if isinstance(data.get("schema_version"), int):
        payload = data.get("overrides")
        return payload if isinstance(payload, dict) else {}
    return data


def _load_overrides() -> dict[str, str]:
    if _disabled():
        return {}
    p = _overrides_path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return _extract_overrides(data)


def _save_overrides(data: dict[str, str]) -> None:
    if _disabled():
        return
    try:
        p = _overrides_path()
        tmp = p.with_suffix(".tmp")
        document = {
            "schema_version": OVERRIDES_SCHEMA_VERSION,
            "overrides": data,
        }
        tmp.write_text(json.dumps(document, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(p)
    except (OSError, TypeError, ValueError):
        return


def record_url_override(name: str, set_hint: str | None, url: str) -> None:
    """Remember that the user once provided `url` for `(name, set_hint)`.

    Idempotent: a re-record of the same value is a no-op (no disk write).
    Replacing an existing value is allowed — the user's most recent input
    wins, on the assumption that they're correcting a stale URL."""
    if _disabled() or not url:
        return
    data = _load_overrides()
    key = _override_key(name, set_hint)
    if data.get(key) == url:
        return
    data[key] = url
    _save_overrides(data)


def find_url_override(name: str, set_hint: str | None) -> str | None:
    """Return a previously-recorded URL for `(name, set_hint)`, if any."""
    if _disabled():
        return None
    return _load_overrides().get(_override_key(name, set_hint))


def list_url_overrides() -> dict[str, str]:
    """Return a copy of every recorded `(name|set) → URL` override.

    Public counterpart to `_load_overrides`, intended for callers (e.g. the
    HTTP API) that want to enumerate the override map without reaching into
    private helpers. Returns an empty dict if the cache is disabled or empty.
    """
    return dict(_load_overrides())


# ---------------------------------------------------------------------------
# Image cache (indefinite TTL — set logos, set symbols, card art).
# ---------------------------------------------------------------------------


def _safe_image_key(key: str) -> str:
    """Sanitise an arbitrary key (e.g. a set id like `sv8`) into a filename.

    Set ids from the upstream sources are already mostly safe, but a handful
    use slashes or punctuation; we collapse anything outside `[A-Za-z0-9_-]`
    to a single underscore so the filesystem layout stays predictable."""
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", key.strip())
    return safe or "image"


def _normalise_image_extension(url_or_ext: str) -> str:
    """Return an allowed extension (`.png` by default) for a URL or raw ext.

    The cache only stores formats we can serve back as-is to the writers
    (PIL + reportlab). Anything outside `_IMAGE_EXTENSIONS` falls back to
    `.png` — the writers handle PNG universally and the original bytes
    survive intact, so a wrong extension just hurts content-type guessing,
    not correctness."""
    candidate = url_or_ext.strip().lower()
    if "?" in candidate:
        candidate = candidate.split("?", 1)[0]
    if "/" in candidate:
        candidate = Path(candidate).suffix
    if not candidate.startswith("."):
        candidate = f".{candidate}" if candidate else ".png"
    return candidate if candidate in _IMAGE_EXTENSIONS else ".png"


def _image_dir(category: str) -> Path:
    """Return the directory holding cached images for `category`, creating it.

    `category` is a slash-delimited category path: each `/`-separated
    segment becomes a subdirectory under `cache/images/`. So `"sets/logo"`
    maps onto `cache/images/sets/logo/` and `"sets/symbol"` onto
    `cache/images/sets/symbol/`. Empty segments (leading/trailing/double
    slashes) are dropped, and a single-segment category like `"avatars"`
    is just as valid as a nested one."""
    parts = [p for p in category.split("/") if p]
    target = cache_root().joinpath(_IMAGES_SUBDIR, *parts)
    target.mkdir(parents=True, exist_ok=True)
    return target


def read_image(category: str, key: str) -> Path | None:
    """Return the path of a cached image for `(category, key)` if present.

    No TTL check: presence on disk is sufficient. Discovers any allowed
    extension so callers don't have to know whether the original was PNG
    vs. JPG — the first match wins. Returns None when the cache is disabled
    via `MGZ_PKMN_NO_CACHE`, when the directory doesn't exist yet, or when
    no file matches.

    TOCTOU-safe: the file may be deleted between the existence check and
    the size check (concurrent `clear_image_cache`, external cleanup,
    network filesystem hiccup), so we swallow `OSError` from the stat and
    treat a vanished file the same as a missing one."""
    if _disabled():
        return None
    parts = [p for p in category.split("/") if p]
    target_dir = _cache_root_path().joinpath(_IMAGES_SUBDIR, *parts)
    if not target_dir.exists():
        return None
    safe = _safe_image_key(key)
    for ext in _IMAGE_EXTENSIONS:
        candidate = target_dir / f"{safe}{ext}"
        try:
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
        except OSError:
            # File vanished between the check and the stat (or stat itself
            # failed transiently). Treat as miss and try the next extension.
            continue
    return None


def write_image(category: str, key: str, content: bytes, *, ext: str = ".png") -> Path | None:
    """Persist `content` bytes for `(category, key)` and return the written path.

    Atomic write: bytes go to a sibling `.tmp` file and rename into place,
    so a partial download never produces a half-written cache entry. A
    failing write is silently dropped (returns None) — the caller treats
    the cache as best-effort.

    `ext` is the file extension; pass the original URL extension when
    available so the on-disk layout mirrors the source format. Unknown
    extensions are normalised to `.png` (see `_normalise_image_extension`).
    """
    if _disabled() or not content:
        return None
    safe = _safe_image_key(key)
    safe_ext = _normalise_image_extension(ext)
    target = _image_dir(category) / f"{safe}{safe_ext}"
    tmp = target.with_suffix(target.suffix + ".tmp")
    try:
        tmp.write_bytes(content)
        tmp.replace(target)
    except OSError:
        with contextlib.suppress(OSError):
            tmp.unlink()
        return None
    return target


def download_and_cache_image(
    category: str,
    key: str,
    url: str,
    session: requests.Session,
    *,
    timeout: float = 30.0,
) -> Path | None:
    """Return a cached image path, downloading via `session` on a miss.

    Cache-aside: a hit returns immediately without touching the network;
    a miss fetches the URL, persists the bytes through `write_image`, and
    returns the new path. A network failure logs to stderr (consistent
    with `images.download_image`) and returns None, leaving the cache
    untouched. The extension is derived from the URL so PNGs stay PNGs."""
    cached = read_image(category, key)
    if cached is not None:
        return cached
    if _disabled():
        return None
    # Local import to keep `requests` out of the cache module's import-time
    # surface — callers already depend on it, and tests can mock it out.
    import requests as _requests

    try:
        resp = session.get(url, timeout=timeout)
        resp.raise_for_status()
    except _requests.RequestException as exc:
        print(f"  ! image download failed for {url}: {exc}", file=sys.stderr)
        return None
    return write_image(category, key, resp.content, ext=url)


def clear_image_cache() -> int:
    """Remove every cached image. Returns the number of files deleted.

    Honoured even when `MGZ_PKMN_NO_CACHE=1` is set — same rationale as
    `clear_api_cache`: the user explicitly asked for a wipe.

    Distinct from `clear_api_cache` on purpose. Image entries are indefinite
    and tend to dominate disk usage once a catalog has been warmed; the user
    should opt into evicting them rather than losing them every time stale
    API payloads need clearing."""
    images_dir = _cache_root_path() / _IMAGES_SUBDIR
    if not images_dir.exists():
        return 0
    count = 0
    for entry in images_dir.rglob("*"):
        if not entry.is_file():
            continue
        try:
            entry.unlink()
            count += 1
        except OSError:
            continue
    # Best-effort prune of now-empty category directories so subsequent
    # `stats()` doesn't show ghost entries.
    for sub in sorted(images_dir.rglob("*"), reverse=True):
        if sub.is_dir():
            with contextlib.suppress(OSError):
                sub.rmdir()
    return count


def image_cache_size() -> tuple[int, int]:
    """Return `(entry_count, total_bytes)` for the image cache.

    Stat-only walk, mirrors `cache_size_bytes` for the API slice. Used by
    `stats()` to populate the dataclass and by `cache warm-sets` to report
    how much the warm pass cost on disk."""
    images_dir = _cache_root_path() / _IMAGES_SUBDIR
    if not images_dir.exists():
        return 0, 0
    count = 0
    total = 0
    for entry in images_dir.rglob("*"):
        if not entry.is_file():
            continue
        with contextlib.suppress(OSError):
            total += entry.stat().st_size
            count += 1
    return count, total


# ---------------------------------------------------------------------------
# Concept-warm manifest — small JSON file that records when `warm-concepts`
# last ran and how many names it warmed. Powers both the once-per-day
# startup gate (`MGZ_PKMN_WARM_ON_STARTUP=1`) and the concept-warm slice in
# `pkmn cache stats`. Honoured even when `MGZ_PKMN_NO_CACHE=1` is set:
# operators reading stats want real on-disk state, not a silent zero.
# ---------------------------------------------------------------------------


def _concept_warm_path() -> Path:
    return _cache_root_path() / _CONCEPT_WARM_FILE


def read_concept_warm() -> dict[str, Any] | None:
    """Return the parsed concept-warm manifest, or None when absent/malformed.

    Schema (v1):
        {
            "version": 1,
            "timestamp": <unix float>,
            "names_warmed": <int>,
            "names_failed": [<str>, ...],
            "source": "pokemontcg" | "tcgdex" | "all"
        }

    Treats a malformed/legacy file as "no manifest" so a corrupted write
    doesn't poison the freshness gate."""
    path = _concept_warm_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("version") != CONCEPT_WARM_SCHEMA_VERSION:
        return None
    return data


def write_concept_warm(
    *,
    names_warmed: int,
    names_failed: list[str],
    source: str,
) -> None:
    """Persist the concept-warm manifest. Best-effort — failures are silent
    so a read-only filesystem doesn't crash a successful warm pass."""
    payload = {
        "version": CONCEPT_WARM_SCHEMA_VERSION,
        "timestamp": time.time(),
        "names_warmed": names_warmed,
        "names_failed": names_failed,
        "source": source,
    }
    root = cache_root()
    with contextlib.suppress(OSError):
        (root / _CONCEPT_WARM_FILE).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def concept_warm_is_fresh(*, now: float | None = None) -> bool:
    """True when a manifest exists, its timestamp is within the staleness
    window (default 24 h, configurable via `CONCEPT_WARM_STALE_SECONDS`),
    AND it recorded at least one successful name warm.

    The `names_warmed > 0` guard exists because `write_concept_warm` is
    called unconditionally after every warm pass — including ones that
    failed every name (a transient upstream outage, for example). Without
    this guard a single failed run would suppress the startup retry for a
    full 24 h while the cache stays cold.

    Used by the FastAPI startup hook to decide whether to re-warm. `now`
    parameter is for tests — production callers omit it and use wall time."""
    manifest = read_concept_warm()
    if manifest is None:
        return False
    ts = manifest.get("timestamp")
    if not isinstance(ts, int | float):
        return False
    names_warmed = manifest.get("names_warmed")
    if not isinstance(names_warmed, int) or names_warmed <= 0:
        return False
    current = now if now is not None else time.time()
    return (current - ts) < CONCEPT_WARM_STALE_SECONDS


# ---------------------------------------------------------------------------
# Set-cards-warm manifest — records the most recent `warm-set-cards` run.
# Same shape as the concept manifest (timestamp, count, failed list) so the
# stats projection and freshness gate can share their mental model. Lives
# alongside `concept_warm.json` in the cache root.
# ---------------------------------------------------------------------------


def _set_cards_warm_path() -> Path:
    return _cache_root_path() / _SET_CARDS_WARM_FILE


def read_set_cards_warm() -> dict[str, Any] | None:
    """Return the parsed set-cards-warm manifest, or None when absent/malformed.

    Schema (v1):
        {
            "version": 1,
            "timestamp": <unix float>,
            "sets_warmed": <int>,
            "sets_failed": [<set_id>, ...]
        }

    Same defence-in-depth as `read_concept_warm`: corrupt files / wrong
    schema versions are treated as "no manifest" so a bad write doesn't
    poison the freshness gate."""
    path = _set_cards_warm_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("version") != SET_CARDS_WARM_SCHEMA_VERSION:
        return None
    return data


def write_set_cards_warm(
    *,
    sets_warmed: int,
    sets_failed: list[str],
) -> None:
    """Persist the set-cards-warm manifest. Best-effort write — failures
    are silent so a read-only filesystem doesn't crash a successful
    warm pass that's about to return its result to the caller."""
    payload = {
        "version": SET_CARDS_WARM_SCHEMA_VERSION,
        "timestamp": time.time(),
        "sets_warmed": sets_warmed,
        "sets_failed": sets_failed,
    }
    root = cache_root()
    with contextlib.suppress(OSError):
        (root / _SET_CARDS_WARM_FILE).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def set_cards_warm_is_fresh(*, now: float | None = None) -> bool:
    """True when a manifest exists, its timestamp is within the staleness
    window (1 week, see `SET_CARDS_WARM_STALE_SECONDS`), and it recorded
    at least one successful set warm.

    Same `sets_warmed > 0` guard as the concept gate — a manifest written
    after a fully-failed pass (e.g. transient upstream outage) must not
    suppress the next retry for a full week with the cache still cold."""
    manifest = read_set_cards_warm()
    if manifest is None:
        return False
    ts = manifest.get("timestamp")
    if not isinstance(ts, int | float):
        return False
    sets_warmed = manifest.get("sets_warmed")
    if not isinstance(sets_warmed, int) or sets_warmed <= 0:
        return False
    current = now if now is not None else time.time()
    return (current - ts) < SET_CARDS_WARM_STALE_SECONDS


# ---------------------------------------------------------------------------
# Sets-warm manifest — records the most recent `warm-sets` (logos+symbols)
# run. Mirrors the set-cards manifest shape so the stats projection and the
# freshness gate stay uniform across the three warm slices.
#
# This manifest exists because we moved set-image warming from a one-shot
# build-time step in the Dockerfile to a runtime lifespan bootstrap (see
# `api.main._warm_sets_in_background` and #369). Without a freshness gate,
# every container start would re-walk ~200 sets x 2 images — wasted work
# when the previous pass landed an hour ago. The week-long stale window
# matches the set-cards slice; both are stable upstream data that only
# moves when new sets ship.
# ---------------------------------------------------------------------------


def _sets_warm_path() -> Path:
    return _cache_root_path() / _SETS_WARM_FILE


def read_sets_warm() -> dict[str, Any] | None:
    """Return the parsed sets-warm manifest, or None when absent/malformed.

    Schema (v1):
        {
            "version": 1,
            "timestamp": <unix float>,
            "sets_warmed": <int>,
            "logos_cached": <int>,
            "symbols_cached": <int>,
            "failures": <int>
        }

    Same defence-in-depth as the other warm manifests: corrupt files or
    wrong schema versions are treated as "no manifest" so a bad write
    doesn't poison the freshness gate."""
    path = _sets_warm_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("version") != SETS_WARM_SCHEMA_VERSION:
        return None
    return data


def write_sets_warm(
    *,
    sets_warmed: int,
    logos_cached: int,
    symbols_cached: int,
    failures: int,
) -> None:
    """Persist the sets-warm manifest. Best-effort write — failures are
    silent so a read-only filesystem doesn't crash a successful warm pass
    that's about to return its result to the caller."""
    payload = {
        "version": SETS_WARM_SCHEMA_VERSION,
        "timestamp": time.time(),
        "sets_warmed": sets_warmed,
        "logos_cached": logos_cached,
        "symbols_cached": symbols_cached,
        "failures": failures,
    }
    root = cache_root()
    with contextlib.suppress(OSError):
        (root / _SETS_WARM_FILE).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def sets_warm_is_fresh(*, now: float | None = None) -> bool:
    """True when a manifest exists, its timestamp is within the staleness
    window (1 week, see `SETS_WARM_STALE_SECONDS`), and it recorded at
    least one successful set walk.

    Same `sets_warmed > 0` guard as the other warm gates — a manifest
    written after a fully-failed pass (e.g. transient upstream outage)
    must not suppress the next retry for a full week with no logos on
    disk."""
    manifest = read_sets_warm()
    if manifest is None:
        return False
    ts = manifest.get("timestamp")
    if not isinstance(ts, int | float):
        return False
    sets_warmed = manifest.get("sets_warmed")
    if not isinstance(sets_warmed, int) or sets_warmed <= 0:
        return False
    current = now if now is not None else time.time()
    return (current - ts) < SETS_WARM_STALE_SECONDS


# ---------------------------------------------------------------------------
# Card-warm manifest — records the most recent `warm-cards` run (the
# Phase 1 #370 catalog-warm pass that fan-out-writes per-card cache entries
# from each set's payload). Mirrors the other warm manifests' shape so
# the stats projection, freshness gate, and CLI rendering stay uniform.
# Phase 1 of the pre-Scrydex catalog-warm epic (#368).
# ---------------------------------------------------------------------------


def _card_warm_path() -> Path:
    return _cache_root_path() / _CARD_WARM_FILE


def read_card_warm() -> dict[str, Any] | None:
    """Return the parsed card-warm manifest, or None when absent/malformed.

    Schema (v1):
        {
            "version": 1,
            "timestamp": <unix float>,
            "cards_warmed": <int>,
            "cards_failed": <int>,
            "sets_attempted": <int>,
            "sets_failed": [<set_id>, ...]
        }

    Same defence-in-depth as the other warm manifests: corrupt files or
    wrong schema versions are treated as "no manifest" so a bad write
    doesn't poison the freshness gate."""
    path = _card_warm_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("version") != CARD_WARM_SCHEMA_VERSION:
        return None
    return data


def write_card_warm(
    *,
    cards_warmed: int,
    cards_failed: int,
    sets_attempted: int,
    sets_failed: list[str],
) -> None:
    """Persist the card-warm manifest. Best-effort write — failures are
    silent so a read-only filesystem doesn't crash a successful warm pass
    that's about to return its result to the caller."""
    payload = {
        "version": CARD_WARM_SCHEMA_VERSION,
        "timestamp": time.time(),
        "cards_warmed": cards_warmed,
        "cards_failed": cards_failed,
        "sets_attempted": sets_attempted,
        "sets_failed": sets_failed,
    }
    root = cache_root()
    with contextlib.suppress(OSError):
        (root / _CARD_WARM_FILE).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def card_warm_is_fresh(*, now: float | None = None) -> bool:
    """True when a manifest exists, its timestamp is within the staleness
    window (1 week, see `CARD_WARM_STALE_SECONDS`), and it recorded at
    least one successful card warm.

    Same `cards_warmed > 0` guard as the other warm gates — a manifest
    written after a fully-failed pass (e.g. transient upstream outage)
    must not suppress the next retry for a full week with the cache
    cold."""
    manifest = read_card_warm()
    if manifest is None:
        return False
    ts = manifest.get("timestamp")
    if not isinstance(ts, int | float):
        return False
    cards_warmed = manifest.get("cards_warmed")
    if not isinstance(cards_warmed, int) or cards_warmed <= 0:
        return False
    current = now if now is not None else time.time()
    return (current - ts) < CARD_WARM_STALE_SECONDS


# ---------------------------------------------------------------------------
# Stats — health snapshot for `pkmn cache stats`.
# ---------------------------------------------------------------------------


def stats() -> CacheStats:
    """Summarise on-disk cache usage without touching `MGZ_PKMN_NO_CACHE`.

    Honoured even when `MGZ_PKMN_NO_CACHE=1` is set: the user is asking
    about real on-disk state, and silently reporting zeros would defeat
    the purpose. For API entries we only call `stat()` — no payload reads
    — so cost scales with the number of files, not their aggregate bytes.
    The overrides file is parsed once (a single JSON document) to count
    keys."""
    root = cache_root()

    api_dir = root / "api"
    api_count = 0
    api_bytes = 0
    api_oldest: float | None = None
    if api_dir.exists():
        for entry in api_dir.iterdir():
            if not entry.is_file() or entry.suffix != ".json":
                continue
            try:
                st = entry.stat()
            except OSError:
                continue
            api_count += 1
            api_bytes += st.st_size
            if api_oldest is None or st.st_mtime < api_oldest:
                api_oldest = st.st_mtime

    overrides_path = _overrides_path()
    override_count = 0
    override_bytes = 0
    if overrides_path.exists():
        try:
            override_bytes = overrides_path.stat().st_size
            data = json.loads(overrides_path.read_text(encoding="utf-8"))
            override_count = len(_extract_overrides(data))
        except (OSError, json.JSONDecodeError):
            # Malformed file — report bytes (if we got them) but no entries.
            pass

    image_count, image_bytes = image_cache_size()

    concept_warm_timestamp: float | None = None
    concept_warm_names = 0
    manifest = read_concept_warm()
    if manifest is not None:
        ts = manifest.get("timestamp")
        if isinstance(ts, int | float):
            concept_warm_timestamp = float(ts)
        n = manifest.get("names_warmed")
        if isinstance(n, int):
            concept_warm_names = n

    set_cards_warm_timestamp: float | None = None
    set_cards_warm_count = 0
    sc_manifest = read_set_cards_warm()
    if sc_manifest is not None:
        ts = sc_manifest.get("timestamp")
        if isinstance(ts, int | float):
            set_cards_warm_timestamp = float(ts)
        n = sc_manifest.get("sets_warmed")
        if isinstance(n, int):
            set_cards_warm_count = n

    sets_warm_timestamp: float | None = None
    sets_warm_count = 0
    sw_manifest = read_sets_warm()
    if sw_manifest is not None:
        ts = sw_manifest.get("timestamp")
        if isinstance(ts, int | float):
            sets_warm_timestamp = float(ts)
        n = sw_manifest.get("sets_warmed")
        if isinstance(n, int):
            sets_warm_count = n

    card_warm_timestamp: float | None = None
    card_warm_count = 0
    card_warm_failed_count = 0
    cw_manifest = read_card_warm()
    if cw_manifest is not None:
        ts = cw_manifest.get("timestamp")
        if isinstance(ts, int | float):
            card_warm_timestamp = float(ts)
        n = cw_manifest.get("cards_warmed")
        if isinstance(n, int):
            card_warm_count = n
        f = cw_manifest.get("cards_failed")
        if isinstance(f, int):
            card_warm_failed_count = f

    return CacheStats(
        root=root,
        api_entry_count=api_count,
        api_bytes=api_bytes,
        api_oldest_mtime=api_oldest,
        override_count=override_count,
        override_bytes=override_bytes,
        image_entry_count=image_count,
        image_bytes=image_bytes,
        concept_warm_timestamp=concept_warm_timestamp,
        concept_warm_names=concept_warm_names,
        set_cards_warm_timestamp=set_cards_warm_timestamp,
        set_cards_warm_count=set_cards_warm_count,
        sets_warm_timestamp=sets_warm_timestamp,
        sets_warm_count=sets_warm_count,
        card_warm_timestamp=card_warm_timestamp,
        card_warm_count=card_warm_count,
        card_warm_failed_count=card_warm_failed_count,
    )
