"""GET /api/v1/sets — return a cached list of known Pokémon TCG set names."""

from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from mgz_pkmn.sources import TCGClient

router = APIRouter()

_SETS_CACHE_PATH = Path("~/.cache/mgz-pkmn/sets.json").expanduser()
_SETS_TTL = 7 * 24 * 60 * 60  # refresh weekly


def _load_sets_cache() -> list[dict] | None:
    if not _SETS_CACHE_PATH.exists():
        return None
    if time.time() - _SETS_CACHE_PATH.stat().st_mtime > _SETS_TTL:
        return None
    try:
        data = json.loads(_SETS_CACHE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else None
    except (OSError, json.JSONDecodeError):
        return None


def _save_sets_cache(sets: list[dict]) -> None:
    try:
        _SETS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _SETS_CACHE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(sets, indent=2), encoding="utf-8")
        tmp.replace(_SETS_CACHE_PATH)
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
