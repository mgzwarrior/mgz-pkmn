"""Disk-backed caches for mgz-pkmn.

Two stores live under `$XDG_CACHE_HOME/mgz-pkmn` (or `~/.cache/mgz-pkmn`):

- **api/<sha1>.json** — one file per upstream API request URL. TTL is enforced
  via mtime; reads older than `DEFAULT_API_TTL_SECONDS` miss and force a
  re-fetch. Saves bandwidth and API quota across consecutive runs since most
  users iterate over the same card lists with small tweaks.

- **url_overrides.json** — single-file map of `(name, set_hint)` →
  PriceCharting URL. Populated whenever the user pastes a PC URL on a line.
  On future runs, a line with the same `(name, set_hint)` but no URL picks
  up the previously-recorded one automatically. Lets the user paste a URL
  once and forget it.

Disk persistence is opt-out via `MGZ_PKMN_NO_CACHE=1` (the CLI's `--no-cache`
flag sets this) so a clean run skips both stores entirely. There is no LRU
eviction — the cache is small (KB per query) and clearing is a manual
`rm -rf ~/.cache/mgz-pkmn` away."""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_API_TTL_SECONDS = 7 * 24 * 60 * 60  # one week
DEFAULT_CACHE_WARN_BYTES = 50 * 1024 * 1024  # 50 MB
_NO_CACHE_ENV = "MGZ_PKMN_NO_CACHE"
_WARN_BYTES_ENV = "MGZ_PKMN_CACHE_WARN_BYTES"
_OVERRIDES_FILE = "url_overrides.json"


@dataclass(frozen=True)
class CacheStats:
    """Snapshot of disk-cache usage. Returned by `stats()` for the CLI to render.

    `api_oldest_mtime` is None when the API cache holds no entries — callers
    should treat that as "no oldest" rather than an unfilled field."""

    root: Path
    api_entry_count: int
    api_bytes: int
    api_oldest_mtime: float | None
    override_count: int
    override_bytes: int


def _disabled() -> bool:
    """Honour `MGZ_PKMN_NO_CACHE=1` — when set, every cache read misses and
    every write is a no-op. Used by the `--no-cache` CLI flag for clean runs."""
    return os.environ.get(_NO_CACHE_ENV, "").strip() not in ("", "0", "false", "False")


def cache_root() -> Path:
    """Resolve the cache directory, creating it lazily.

    Honours `XDG_CACHE_HOME` so users with a custom cache layout aren't
    overridden, and falls back to `~/.cache/mgz-pkmn` otherwise. Safe to
    call repeatedly — `mkdir(parents=True, exist_ok=True)` is idempotent."""
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    root = Path(base) / "mgz-pkmn"
    root.mkdir(parents=True, exist_ok=True)
    return root


def cache_warn_threshold() -> int:
    """Resolve the soft-warn threshold for total cache size, in bytes.

    Reads `MGZ_PKMN_CACHE_WARN_BYTES` (an integer byte count) when set; falls
    back to `DEFAULT_CACHE_WARN_BYTES` (50 MB). A non-positive value disables
    the warning entirely, which is how an unparseable env var also lands —
    callers should treat `<= 0` as "do not warn"."""
    raw = os.environ.get(_WARN_BYTES_ENV, "").strip()
    if not raw:
        return DEFAULT_CACHE_WARN_BYTES
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_CACHE_WARN_BYTES


def cache_size_bytes() -> int:
    """Total on-disk cache size in bytes (API responses + URL overrides file).

    Stat-only — no payload reads, no JSON parsing — so it's safe to call at
    every CLI startup as a cheap pre-flight check. Returns 0 when the cache
    has no contents yet (fresh install, post-`rm -rf`, etc.)."""
    root = cache_root()
    total = 0
    api_dir = root / "api"
    if api_dir.exists():
        for entry in api_dir.iterdir():
            if not entry.is_file() or entry.suffix != ".json":
                continue
            try:
                total += entry.stat().st_size
            except OSError:
                continue
    overrides = _overrides_path()
    with contextlib.suppress(OSError):
        total += overrides.stat().st_size
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
    (caller falls through to a network fetch)."""
    if _disabled():
        return None
    p = _api_path(key)
    if not p.exists():
        return None
    if time.time() - p.stat().st_mtime > ttl_seconds:
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


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
    effort, never a hard requirement."""
    if _disabled():
        return
    try:
        p = _api_path(key)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(p)
    except (OSError, TypeError, ValueError):
        return


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


def _load_overrides() -> dict[str, str]:
    if _disabled():
        return {}
    p = _overrides_path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_overrides(data: dict[str, str]) -> None:
    if _disabled():
        return
    try:
        p = _overrides_path()
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
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
            if isinstance(data, dict):
                override_count = len(data)
        except (OSError, json.JSONDecodeError):
            # Malformed file — report bytes (if we got them) but no entries.
            pass

    return CacheStats(
        root=root,
        api_entry_count=api_count,
        api_bytes=api_bytes,
        api_oldest_mtime=api_oldest,
        override_count=override_count,
        override_bytes=override_bytes,
    )
