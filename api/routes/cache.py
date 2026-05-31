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


@router.get("/cache/stats")
def get_cache_stats(response: Response) -> dict:
    """Return on-disk cache stats in the same shape as `pkmn cache stats --json`.

    `root` is stringified (the dataclass holds a `Path`) so the response
    serializes cleanly; every other field is already a primitive.
    """
    payload = asdict(disk_cache.stats())
    payload["root"] = str(payload["root"])
    response.headers["Cache-Control"] = "no-store"
    return payload
