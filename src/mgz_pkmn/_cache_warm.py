"""Disk-cache warm-manifest slices (concept / set-cards / sets / cards / images).

Each warm pass writes a small JSON manifest recording when it last ran and how
much it primed. Those manifests power the once-per-day / once-per-week startup
freshness gates and the per-slice rows in `pkmn cache stats`.

This module is reached through ``mgz_pkmn.cache`` — every public name here is
re-exported from there, so callers keep importing ``cache.read_concept_warm``,
``cache.SETS_WARM_SCHEMA_VERSION``, etc. It depends on ``cache`` only for the
``cache_root`` / ``_cache_root_path`` core path helpers, referenced through the
module object at call time so the re-export cycle resolves cleanly."""

from __future__ import annotations

import contextlib
import json
import time
from pathlib import Path
from typing import Any

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
_CONCEPT_WARM_FILE = "concept_warm.json"
_SET_CARDS_WARM_FILE = "set_cards_warm.json"
_SETS_WARM_FILE = "sets_warm.json"
_CARD_WARM_FILE = "card_warm.json"
_CARD_IMAGES_WARM_FILE = "card_images_warm.json"
CONCEPT_WARM_SCHEMA_VERSION = 1
SET_CARDS_WARM_SCHEMA_VERSION = 1
SETS_WARM_SCHEMA_VERSION = 1
CARD_WARM_SCHEMA_VERSION = 1
CARD_IMAGES_WARM_SCHEMA_VERSION = 1


# ---------------------------------------------------------------------------
# Concept-warm manifest — small JSON file that records when `warm-concepts`
# last ran and how many names it warmed. Powers both the once-per-day
# startup gate (`MGZ_PKMN_WARM_ON_STARTUP=1`) and the concept-warm slice in
# `pkmn cache stats`. Honoured even when `MGZ_PKMN_NO_CACHE=1` is set:
# operators reading stats want real on-disk state, not a silent zero.
# ---------------------------------------------------------------------------


def _concept_warm_path() -> Path:
    return _cache._cache_root_path() / _CONCEPT_WARM_FILE


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
    root = _cache.cache_root()
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
    return _cache._cache_root_path() / _SET_CARDS_WARM_FILE


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
    root = _cache.cache_root()
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
    return _cache._cache_root_path() / _SETS_WARM_FILE


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
    root = _cache.cache_root()
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
    return _cache._cache_root_path() / _CARD_WARM_FILE


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
    root = _cache.cache_root()
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
# Card-images warm manifest — Phase 2 of the pre-Scrydex catalog-warm
# epic (#368). Tracks how many per-card image bytes the most recent
# `pkmn cache warm-card-images` pass landed on disk under
# `cache/images/cards/{large,small}/`. Mirrors the other warm manifests'
# shape so the stats projection / freshness gate / CLI rendering stay
# uniform. Shares `CARD_WARM_STALE_SECONDS` as the staleness window —
# card-image bytes are at least as immutable as card structural data.
# ---------------------------------------------------------------------------


def _card_images_warm_path() -> Path:
    return _cache._cache_root_path() / _CARD_IMAGES_WARM_FILE


def read_card_images_warm() -> dict[str, Any] | None:
    """Return the parsed card-images-warm manifest, or None if absent/malformed.

    Schema (v1):
        {
            "version": 1,
            "timestamp": <unix float>,
            "images_warmed": <int>,
            "images_failed": <int>,
            "bytes_written": <int>,
            "budget_reached": <bool>,
            "sets_attempted": <int>,
            "sets_failed": [<set_id>, ...]
        }

    Same defence-in-depth as the other warm manifests."""
    path = _card_images_warm_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("version") != CARD_IMAGES_WARM_SCHEMA_VERSION:
        return None
    return data


def write_card_images_warm(
    *,
    images_warmed: int,
    images_failed: int,
    bytes_written: int,
    budget_reached: bool,
    sets_attempted: int,
    sets_failed: list[str],
) -> None:
    """Persist the card-images-warm manifest. Best-effort write."""
    payload = {
        "version": CARD_IMAGES_WARM_SCHEMA_VERSION,
        "timestamp": time.time(),
        "images_warmed": images_warmed,
        "images_failed": images_failed,
        "bytes_written": bytes_written,
        "budget_reached": budget_reached,
        "sets_attempted": sets_attempted,
        "sets_failed": sets_failed,
    }
    root = _cache.cache_root()
    with contextlib.suppress(OSError):
        (root / _CARD_IMAGES_WARM_FILE).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def card_images_warm_is_fresh(*, now: float | None = None) -> bool:
    """True when a manifest exists, its timestamp is within the staleness
    window (`CARD_WARM_STALE_SECONDS` — one week), and the manifest
    recorded at least one warmed image.

    A `budget_reached=True` manifest is still considered fresh: the
    gate's job is to suppress the next *full* re-walk, not to chase the
    budget tail on every boot."""
    manifest = read_card_images_warm()
    if manifest is None:
        return False
    ts = manifest.get("timestamp")
    if not isinstance(ts, int | float):
        return False
    images_warmed = manifest.get("images_warmed")
    if not isinstance(images_warmed, int) or images_warmed <= 0:
        return False
    current = now if now is not None else time.time()
    return (current - ts) < CARD_WARM_STALE_SECONDS


# Imported at the bottom — after every name above is defined — so this module
# resolves cleanly no matter whether `cache` or `_cache_warm` is imported
# first. The slices only touch `_cache` at call time (for the cache-root path
# helpers), never at import time, so the partially-initialised module bound
# here is always fully ready by the time a slice actually runs.
from . import cache as _cache  # noqa: E402
