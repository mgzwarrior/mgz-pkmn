"""GET /api/v1/cache/stats — inspect on-disk cache state of a deployed instance.

Mirrors the shape of `pkmn cache stats --json` so users can pipe between
the CLI and the API without translating field names. Answers operational
questions the CLI tool can't on a remote deploy: did the warm-on-startup
pass actually land, how many entries are cached, when was the last warm
pass.

The payload is operational, not sensitive — entry counts and timestamps
don't expose anything an attacker could exploit — so the route is public
read with no auth. The response carries `Cache-Control: no-store` because
the underlying state changes whenever the warm passes or a cache write
runs; a stale value would defeat the "is the deploy warmed *right now*?"
question this endpoint exists to answer.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Response

from mgz_pkmn import cache as disk_cache

router = APIRouter()


def _zeroed_snapshot() -> disk_cache.CacheStats:
    """Best-effort fallback when `disk_cache.stats()` can't read the cache.

    `cache_root()` does an `mkdir`, which raises `OSError` on read-only or
    misconfigured filesystems. A diagnostics endpoint shouldn't 500 just
    because nothing is cacheable; return the same schema with everything
    zeroed (and `root` resolved without the mkdir side effect) so the
    operator gets the "nothing to see" answer instead of an opaque error.
    """
    return disk_cache.CacheStats(
        root=disk_cache._cache_root_path(),
        api_entry_count=0,
        api_bytes=0,
        api_oldest_mtime=None,
        override_count=0,
        override_bytes=0,
        image_entry_count=0,
        image_bytes=0,
        concept_warm_timestamp=None,
        concept_warm_names=0,
        set_cards_warm_timestamp=None,
        set_cards_warm_count=0,
        sets_warm_timestamp=None,
        sets_warm_count=0,
    )


@router.get("/cache/stats")
def get_cache_stats(response: Response) -> dict:
    """Return on-disk cache stats in the same shape as `pkmn cache stats --json`.

    `root` is stringified (the dataclass holds a `Path`) so the response
    serializes cleanly; every other field is already a primitive. Swallows
    `OSError` from the underlying filesystem reads — see `_zeroed_snapshot`
    for the rationale.
    """
    try:
        snapshot = disk_cache.stats()
    except OSError:
        snapshot = _zeroed_snapshot()
    payload = asdict(snapshot)
    payload["root"] = str(payload["root"])
    response.headers["Cache-Control"] = "no-store"
    return payload
