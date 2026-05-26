"""Set-catalog HTTP surface — list of every set, plus their cached logos.

`GET /api/v1/sets` returns the full pokemontcg.io catalog (id, name,
series, total, release date). Used by the SPA's set picker modal to
populate the grouped multi-select.

`GET /api/v1/sets/{set_id}/logo` streams the cached logo image for a set
out of the unified disk image cache (see `mgz_pkmn.cache.read_image`).
Returns 404 when the requested set isn't in the cache yet — the SPA
falls back to a text-only chip in that case, or the user can run
`pkmn cache warm-sets` to prime everything. Avoids re-downloading the
catalog on every render of the modal."""

from __future__ import annotations

import json
import mimetypes
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException
from fastapi import Path as PathParam
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.sources import TCGClient

router = APIRouter()

# Pokemon TCG set ids are short alphanumeric strings (e.g. `sv8`, `base1`,
# `swsh4`). FastAPI rejects anything outside the pattern with a 422 before
# the handler runs; `max_length=64` is well above any real id (longest in
# the current catalog is 8 chars) while still bounding pathological inputs.
_SET_ID_PATH = PathParam(pattern=r"^[A-Za-z0-9_-]{1,64}$", max_length=64)

_SETS_TTL = 7 * 24 * 60 * 60  # refresh weekly


def _sets_cache_path() -> Path:
    # Lazy lookup so we go through `disk_cache.cache_root()` and honour
    # `XDG_CACHE_HOME` instead of hardcoding `~/.cache`. Resolving at call
    # time also avoids creating the cache dir at import time.
    return disk_cache.cache_root() / "sets.json"


def _load_sets_cache() -> list[dict] | None:
    path = _sets_cache_path()
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > _SETS_TTL:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else None
    except (OSError, json.JSONDecodeError):
        return None


def _save_sets_cache(sets: list[dict]) -> None:
    path = _sets_cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(sets, indent=2), encoding="utf-8")
        tmp.replace(path)
    except (OSError, TypeError, ValueError):
        pass


def _fetch_sets(api_key: str | None = None) -> list[dict]:
    """Fetch all sets from pokemontcg.io and return name/series/total."""
    client = TCGClient(api_key=api_key)
    url = "https://api.pokemontcg.io/v2/sets?orderBy=releaseDate&pageSize=250"
    resp = client.session.get(url, timeout=30)
    resp.raise_for_status()
    raw = resp.json().get("data", [])
    return [
        {
            "id": s.get("id"),
            "name": s.get("name"),
            "series": s.get("series"),
            "total": s.get("total"),
            "releaseDate": s.get("releaseDate"),
        }
        for s in raw
    ]


@router.get("/sets")
async def get_sets(api_key: str | None = None) -> dict:
    """Return a cached list of Pokémon TCG set names.

    Results are cached locally for one week. Pass `api_key` as a query
    parameter to authenticate the upstream refresh request.
    """
    cached = _load_sets_cache()
    if cached is not None:
        return {"sets": cached}

    sets = await run_in_threadpool(_fetch_sets, api_key)
    _save_sets_cache(sets)
    return {"sets": sets}


@router.get("/sets/{set_id}/logo")
async def get_set_logo(
    set_id: Annotated[str, _SET_ID_PATH],
) -> FileResponse:
    """Stream the cached logo image for a set, or 404 if not cached.

    Reads from the unified disk image cache populated by
    `pkmn cache warm-sets` (or any prior `set-cards` run). Returns 404
    when the set hasn't been warmed yet — the SPA picker should treat
    that as a soft fallback (text-only chip) rather than an error, and
    surface a one-liner suggesting `pkmn cache warm-sets` to the user.

    No upstream fetch on miss: this endpoint is strictly a cache reader.
    Fetch + persist is the warm-sets command's job; mixing the two would
    let a single picker render hammer the upstream API for every set."""
    path = disk_cache.read_image("sets/logo", set_id)
    if path is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"no cached logo for set '{set_id}' — "
                "run `pkmn cache warm-sets` to populate the catalog"
            ),
        )
    media_type, _ = mimetypes.guess_type(path.name)
    return FileResponse(
        path,
        media_type=media_type or "application/octet-stream",
        # 30-day immutable browser cache: set logos don't change once a
        # set ships, so a long client-side TTL keeps the picker snappy on
        # repeat opens. 30 days is the practical ceiling — long enough
        # that day-of-show flows never re-fetch, short enough that any
        # future re-skinning of a logo still propagates within a month.
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )
