"""Pokédex-organised card surface — every printing of one species across every set.

`GET /api/v1/pokedex/{number}/cards` returns a **trimmed** list of every
card whose `nationalPokedexNumbers` includes `{number}` — the data behind
Browse's pokedex-# view, where the organisation flips from "cards in a
set" to "every Charizard ever printed" (issue #577).

The payload reuses the slim set-card trim (`sets._trim_card`) and adds the
per-card set context — id, name, release date — that set view leaves
implicit in its single-set grid. Because printings span sets, each row
needs to know which set it came from to label and sort itself.

Rows arrive pre-sorted newest-first: release date desc, then set name,
then collector number. A 1-day `Cache-Control` matches `/sets/{id}/cards`
— a species' printing list is stable within a prep session; only market
prices drift."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Response
from fastapi import Path as PathParam
from fastapi.concurrency import run_in_threadpool

from mgz_pkmn.sources import TCGClient

from .sets import _SET_CARDS_BROWSER_TTL, _trim_card

router = APIRouter()

# National dex numbers are positive integers; the catalog tops out at 1025
# today. `le` is generous headroom for future generations while bounding
# pathological inputs — FastAPI 422s anything out of range before the
# handler runs.
_DEX_NUMBER_PATH = PathParam(ge=1, le=20000)


def _collector_sort_key(number: str) -> tuple[int, str]:
    """Sort collector numbers numerically when possible, else lexically.

    Numbers like `6` sort ahead of `25`; promo/trainer-gallery numbers
    like `TG12` or `SV107` fall back to a string compare in a second
    bucket so they don't crash the int parse and cluster together."""
    head = (number or "").split("/")[0]
    try:
        return (0, f"{int(head):08d}")
    except ValueError:
        return (1, head)


def _trim_pokedex_card(card: dict[str, Any]) -> dict[str, Any]:
    """Slim set-card shape plus the set context a cross-set row needs."""
    set_obj = card.get("set") or {}
    trimmed = _trim_card(card)
    trimmed.update(
        {
            "setId": set_obj.get("id"),
            "setName": set_obj.get("name"),
            "releaseDate": set_obj.get("releaseDate"),
        }
    )
    return trimmed


def _fetch_pokedex_cards(number: int, api_key: str | None) -> list[dict[str, Any]]:
    """Fetch every printing of a species via pokemontcg.io, newest first.

    `q=nationalPokedexNumbers:{n}` is the canonical filter for "every card
    of this Pokémon". Flows through `search_all` so the request shares the
    on-disk API cache with the rest of the app. Sorted server-side so the
    SPA renders the response verbatim."""
    client = TCGClient(api_key=api_key)
    cards, _status = client.search_all(f"nationalPokedexNumbers:{number}")
    trimmed = [_trim_pokedex_card(c) for c in cards]
    # Two stable passes: the secondary keys (set name, then collector
    # number) ascending, then release date descending on top. Python's
    # stable sort preserves the ascending tie-break within each release
    # date — so the order is newest set first, ties broken set A→Z, number low→high.
    trimmed.sort(key=lambda c: (c.get("setName") or "", _collector_sort_key(c.get("number") or "")))
    trimmed.sort(key=lambda c: c.get("releaseDate") or "", reverse=True)
    return trimmed


@router.get("/pokedex/{number}/cards")
async def get_pokedex_cards(
    response: Response,
    number: Annotated[int, _DEX_NUMBER_PATH],
    api_key: str | None = None,
) -> dict:
    """Return every printing of one species, trimmed and newest-first.

    Each entry carries the Browse-grid fields plus `setId` / `setName` /
    `releaseDate`. 404 when no card carries that national dex number —
    either an out-of-range species or one the TCG has never printed. The
    SPA surfaces the detail message as an empty state."""
    cards = await run_in_threadpool(_fetch_pokedex_cards, number, api_key)
    if not cards:
        raise HTTPException(
            status_code=404,
            detail=f"no printings found for national dex #{number}",
        )
    response.headers["Cache-Control"] = f"public, max-age={_SET_CARDS_BROWSER_TTL}"
    return {"number": number, "cards": cards}
