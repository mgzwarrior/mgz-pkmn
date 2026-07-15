"""Card-class browse surface — every card in one Trainer/Energy class (#911).

`GET /api/v1/classes/{class_id}/cards` returns a **trimmed** list of every
card in one non-Pokémon class — Supporters, Items, Stadiums, Special
Energy, and the vintage mechanics collectors chase (ACE SPEC, Prism Star,
Radiant, BREAK, LEGEND). The data behind Browse's by-class view, where the
organisation flips from "cards in a set" to "every Supporter ever printed".

The class registry maps a stable id (the SPA bakes the same list) to the
pokemontcg.io Lucene filter that defines the class. Rows reuse the pokedex
cross-set trim (`pokedex._trim_pokedex_card`) and sort — newest set first,
ties broken set A→Z, collector number low→high — so the SPA renders the
response verbatim with the same tile it uses for a species' printings.

Trainer classes follow the same card-name grouping used by Bulbapedia's
English Trainer-card index: repeated printings of the same trainer, object,
character, or location stay adjacent instead of being interleaved only by release date.

Classes are much bigger than a single species (Supporter alone is well
past a thousand cards), so the fetch pages at the API's max page size with
generous page headroom. A 1-day `Cache-Control` matches the other browse
surfaces — class membership only changes when a set releases."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from fastapi.concurrency import run_in_threadpool

from mgz_pkmn.sources import TCGClient

from ..cache_mode import cache_only_enabled
from .pokedex import _collector_sort_key, _trim_pokedex_card
from .sets import _SET_CARDS_BROWSER_TTL

router = APIRouter()

# Stable class id → the pokemontcg.io query that defines membership. Ids are
# the SPA-facing contract (baked into `web/src/data/cardClasses.ts`); queries
# key the on-disk API cache, so changing one invalidates that class's cache.
CARD_CLASS_QUERIES: dict[str, str] = {
    "item": "supertype:Trainer subtypes:Item",
    "supporter": "supertype:Trainer subtypes:Supporter",
    "stadium": "supertype:Trainer subtypes:Stadium",
    "tool": 'supertype:Trainer subtypes:"Pokémon Tool"',
    "technical-machine": 'subtypes:"Technical Machine"',
    "special-energy": "supertype:Energy subtypes:Special",
    "basic-energy": "supertype:Energy subtypes:Basic",
    "ace-spec": 'subtypes:"ACE SPEC"',
    "prism-star": 'subtypes:"Prism Star"',
    "radiant": "subtypes:Radiant",
    "break": "subtypes:BREAK",
    "legend": "subtypes:LEGEND",
}

# Item and Supporter both exceed the default search_all envelope
# (12 pages x 50). Max page size with the same page count caps a class at
# 3000 cards — headroom over today's biggest class.
_CLASS_PAGE_SIZE = 250
_CLASS_MAX_PAGES = 12


def _fetch_class_cards(
    class_id: str, api_key: str | None, *, cache_only: bool = False
) -> tuple[list[dict[str, Any]], str]:
    """Fetch every card in a class via pokemontcg.io, grouped by card name.

    Flows through `search_all` so the request shares the on-disk API cache
    with the rest of the app; `cache_only` (driven by `MGZ_PKMN_CACHE_ONLY`,
    see `api.cache_mode`) keeps an uncached class from reaching upstream and
    surfaces as a `MISS-CACHE-ONLY` status instead. Sorted server-side by
    card name first so cards for the same trainer, object, character, or
    location stay together; each name group then uses
    the pokedex view's contract: release date desc, then set name, then
    collector number."""
    client = TCGClient(api_key=api_key)
    cards, status = client.search_all(
        CARD_CLASS_QUERIES[class_id],
        page_size=_CLASS_PAGE_SIZE,
        max_pages=_CLASS_MAX_PAGES,
        cache_only=cache_only,
    )
    trimmed = [_trim_pokedex_card(c) for c in cards]
    # Stable multi-key sort: apply lowest-priority key first so each later
    # pass only breaks ties in the one before it, not overrides it — sorting
    # release date after set name (as this used to) let two printings in
    # differently-named sets land in set-name order instead of newest-first.
    trimmed.sort(key=lambda c: _collector_sort_key(c.get("number") or ""))
    trimmed.sort(key=lambda c: c.get("setName") or "")
    trimmed.sort(key=lambda c: c.get("releaseDate") or "", reverse=True)
    trimmed.sort(key=lambda c: (c.get("name") or "").casefold())
    return trimmed, status


@router.get("/classes/{class_id}/cards")
async def get_class_cards(
    response: Response,
    class_id: str,
    api_key: str | None = None,
) -> dict:
    """Return every card in one class, trimmed and newest-first.

    Each entry carries the Browse-grid fields plus `setId` / `setName` /
    `releaseDate`. 404 for an id outside the registry, and for a registered
    class the upstream returned nothing for — the SPA surfaces the detail
    message as an empty state."""
    if class_id not in CARD_CLASS_QUERIES:
        raise HTTPException(status_code=404, detail=f"unknown card class {class_id!r}")
    cards, cache_status = await run_in_threadpool(
        _fetch_class_cards, class_id, api_key, cache_only=cache_only_enabled()
    )
    if not cards:
        # A `MISS-CACHE-ONLY` empty means "not in the disk cache and we were
        # told not to fetch upstream" (`MGZ_PKMN_CACHE_ONLY`), not "this class
        # has no cards" — mirror `/sets/{id}/cards` and return an empty 200
        # the SPA renders as an empty state. Don't browser-cache it so a
        # later warm cache isn't masked.
        if cache_status == "MISS-CACHE-ONLY":
            response.headers["X-Cache"] = cache_status
            return {"classId": class_id, "cards": []}
        raise HTTPException(status_code=404, detail=f"no cards found for class {class_id!r}")
    response.headers["Cache-Control"] = f"public, max-age={_SET_CARDS_BROWSER_TTL}"
    response.headers["X-Cache"] = cache_status
    return {"classId": class_id, "cards": cards}
