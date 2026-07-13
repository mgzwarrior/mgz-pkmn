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

Classes are much bigger than a single species (Supporter alone is well
past a thousand cards), so the fetch pages at the API's max page size with
generous page headroom. A 1-day `Cache-Control` matches the other browse
surfaces — class membership only changes when a set releases."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from fastapi.concurrency import run_in_threadpool

from mgz_pkmn.sources import TCGClient

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


def _fetch_class_cards(class_id: str, api_key: str | None) -> list[dict[str, Any]]:
    """Fetch every card in a class via pokemontcg.io, newest first.

    Flows through `search_all` so the request shares the on-disk API cache
    with the rest of the app. Sorted server-side with the pokedex view's
    contract: release date desc, then set name, then collector number."""
    client = TCGClient(api_key=api_key)
    cards, _status = client.search_all(
        CARD_CLASS_QUERIES[class_id],
        page_size=_CLASS_PAGE_SIZE,
        max_pages=_CLASS_MAX_PAGES,
    )
    trimmed = [_trim_pokedex_card(c) for c in cards]
    trimmed.sort(key=lambda c: (c.get("setName") or "", _collector_sort_key(c.get("number") or "")))
    trimmed.sort(key=lambda c: c.get("releaseDate") or "", reverse=True)
    return trimmed


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
    cards = await run_in_threadpool(_fetch_class_cards, class_id, api_key)
    if not cards:
        raise HTTPException(status_code=404, detail=f"no cards found for class {class_id!r}")
    response.headers["Cache-Control"] = f"public, max-age={_SET_CARDS_BROWSER_TTL}"
    return {"classId": class_id, "cards": cards}
