"""Set-catalog HTTP surface — list of every set, the cards in a set, plus cached logos.

`GET /api/v1/sets` returns the full pokemontcg.io catalog (id, name,
series, total, release date). Used by the SPA's set picker modal and
the Browse surface to populate the grouped set list. The response
carries a short-TTL `Cache-Control` header so the browser can skip
the round-trip when the user re-opens Browse within the hour.

`GET /api/v1/sets/{set_id}/cards` returns a **trimmed** card list for
one set — just the fields Browse renders (id, name, number, rarity,
supertype, subtypes, thumb, market). Keeping the payload tight is
critical: a set like Surging Sparks has 250+ cards, and the raw
pokemontcg.io shape (legalities, ancientTrait, attacks, weaknesses,
resistances, tcgplayer/cardmarket sub-objects) blows the wire size up
~10x. The trim happens server-side so every Browse client pays the
slim cost. A 1-day `Cache-Control` lets the browser keep the response
for the duration of a typical prep session.

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
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Response
from fastapi import Path as PathParam
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.card_images import SMALL_CATEGORY
from mgz_pkmn.pricing import extract_pricing
from mgz_pkmn.sources import TCGClient

router = APIRouter()

# Pokemon TCG set ids are short alphanumeric strings (e.g. `sv8`, `base1`,
# `swsh4`). FastAPI rejects anything outside the pattern with a 422 before
# the handler runs; `max_length=64` is well above any real id (longest in
# the current catalog is 8 chars) while still bounding pathological inputs.
_SET_ID_PATH = PathParam(pattern=r"^[A-Za-z0-9_-]{1,64}$", max_length=64)

_SETS_TTL = 7 * 24 * 60 * 60  # refresh weekly

# Browser-cache TTL for `GET /api/v1/sets`. The disk cache already pins the
# upstream response for a week; the Cache-Control header is the cheap
# additional win — a Browse re-open within an hour skips the round-trip
# entirely. Kept conservative (1h, not 1d) so a freshly-released set shows
# up in the picker within an hour without the user having to hard-refresh.
_SETS_BROWSER_TTL = 60 * 60

# `stale-while-revalidate` window for `GET /api/v1/sets`. After the
# `max-age` window expires, the browser can serve the cached response
# **immediately** for up to this many seconds while it asynchronously
# revalidates in the background. The user never sees a loading state
# on the catalog endpoint as long as they've hit it within the last
# day — the new data lands on the *next* render. Pairs with the
# SPA-side baked catalog in `web/src/data/sets.json`, which covers the
# very-first-visit case.
_SETS_BROWSER_SWR = 24 * 60 * 60

# Browser-cache TTL for `GET /api/v1/sets/{set_id}/cards`. Card data within a
# released set is effectively immutable (rarity / number / images don't change
# once the set ships); only market prices drift, and a 1-day cache keeps
# typical day-of-show prep snappy without going stale on negotiating numbers.
_SET_CARDS_BROWSER_TTL = 24 * 60 * 60


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
async def get_sets(response: Response, api_key: str | None = None) -> dict:
    """Return a cached list of Pokémon TCG set names.

    Results are cached on disk for one week (server-side) **and** in the
    browser for an hour via the `Cache-Control` header. The browser cache
    is the load-bearing optimisation for repeated Browse opens — without
    it, every modal open re-hits FastAPI even when the upstream data
    hasn't moved. Pass `api_key` as a query parameter to authenticate the
    upstream refresh request.
    """
    response.headers["Cache-Control"] = (
        f"public, max-age={_SETS_BROWSER_TTL}, stale-while-revalidate={_SETS_BROWSER_SWR}"
    )
    cached = _load_sets_cache()
    if cached is not None:
        return {"sets": cached}

    sets = await run_in_threadpool(_fetch_sets, api_key)
    _save_sets_cache(sets)
    return {"sets": sets}


# ---------------------------------------------------------------------------
# /sets/{set_id}/cards — trimmed card list for one set, browser-cacheable.
# ---------------------------------------------------------------------------


def _trim_card(card: dict[str, Any]) -> dict[str, Any]:
    """Project a pokemontcg.io card into the slim shape Browse renders.

    The raw card object carries dozens of fields the SPA never reads
    (legalities, attacks, weaknesses, resistances, full tcgplayer /
    cardmarket sub-objects, etc.). Stripping them server-side keeps
    a 250-card set response in the tens of KB instead of hundreds of
    KB — measurable on slow networks and on the JSON parse hot path.

    Kept deliberately narrow: every field here is something the Browse
    grid, filter chips, or add-to-list bridge actually uses."""
    images = card.get("images") or {}
    pricing = extract_pricing(card, None)
    card_id = card.get("id")
    # `images.small` is the thumbnail-sized variant pokemontcg.io
    # exposes (~245x342). The grid uses it directly — no extra
    # server-side resize. `large` is intentionally omitted; the
    # full-size art lives behind a single-card hover/click.
    thumb = images.get("small")
    # Phase 2 (#371): rewrite to our self-hosted route when the image
    # is cached on disk. Cache miss leaves the upstream URL in place
    # so a cold cache still renders a working thumb.
    if thumb and card_id and disk_cache.read_image(SMALL_CATEGORY, card_id) is not None:
        thumb = f"/api/v1/cards/{card_id}/image/small"
    return {
        "id": card_id,
        "name": card.get("name"),
        "number": card.get("number"),
        "rarity": card.get("rarity"),
        "supertype": card.get("supertype"),
        "subtypes": card.get("subtypes") or [],
        "thumb": thumb,
        "market": pricing.market,
        # National Pokédex numbers (usually one; a couple for multi-species
        # cards). Lets the SPA match a card to a favorite species (#742) for
        # swipe weighting without re-deriving the species from the name.
        # camelCase to match the rest of the SPA-facing card shape (the SPA
        # casts the JSON straight to `SetCard`, no key remap).
        "dexNumbers": card.get("nationalPokedexNumbers") or [],
    }


def _fetch_set_cards(set_id: str, api_key: str | None) -> tuple[list[dict[str, Any]], str]:
    """Fetch every card in `set_id` via pokemontcg.io and return slim shapes.

    Uses `TCGClient.search_all` so the request flows through the existing
    on-disk API cache (7-day TTL). Once one user warms a set, every other
    Browse open of that set is a disk-cache hit upstream, plus the trim
    is microseconds. `q=set.id:{id}` is the canonical pokemontcg.io
    filter; ids are short alnum so quoting isn't strictly needed but
    we include it for defence against future ids with special chars.

    Returns `(cards, cache_status)`; the status is the worst split-cache
    outcome across the paged walk (#372), surfaced as `X-Cache` by the
    route handler so a contributor can tell a warm-cache open from an
    upstream round-trip (#310)."""
    client = TCGClient(api_key=api_key)
    cards, status = client.search_all(f'set.id:"{set_id}"')
    return [_trim_card(c) for c in cards], status


@router.get("/sets/{set_id}/cards")
async def get_set_cards(
    response: Response,
    set_id: Annotated[str, _SET_ID_PATH],
    api_key: str | None = None,
) -> dict:
    """Return a trimmed card list for one set, browser-cacheable for a day.

    Each entry carries the fields Browse renders: id, name, number,
    rarity, supertype, subtypes, thumb URL, and market price. The full
    pokemontcg.io card shape is **not** included — see `_trim_card`
    for the rationale.

    404 when the set is unknown / empty (the upstream catalog returned
    nothing for `set.id:{set_id}`). The SPA surfaces the detail message
    to the user.

    Sets an `X-Cache` header (`HIT` / `STALE` / `MISS`) mirroring the disk
    cache freshness of the underlying pokemontcg.io read (#310).
    """
    cards, cache_status = await run_in_threadpool(_fetch_set_cards, set_id, api_key)
    if not cards:
        raise HTTPException(
            status_code=404,
            detail=f"no cards found for set '{set_id}'",
        )
    response.headers["Cache-Control"] = f"public, max-age={_SET_CARDS_BROWSER_TTL}"
    response.headers["X-Cache"] = cache_status
    return {"set_id": set_id, "cards": cards}


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
