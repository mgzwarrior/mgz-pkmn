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

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

DEFAULT_API_TTL_SECONDS = 7 * 24 * 60 * 60  # one week
_NO_CACHE_ENV = "MGZ_PKMN_NO_CACHE"
_OVERRIDES_FILE = "url_overrides.json"


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
