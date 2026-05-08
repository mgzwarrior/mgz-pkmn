"""POST /api/v1/lookup and POST /api/v1/bulk (SSE) — card lookup routes."""

from __future__ import annotations

import json
from typing import Any

import requests as req_lib
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mgz_pkmn.lookup import find_card, find_top_cards
from mgz_pkmn.parser import CardQuery, parse_line
from mgz_pkmn.pricing import Pricing, extract_pricing
from mgz_pkmn.sources import PriceChartingClient, TCGClient, TCGDexClient
from mgz_pkmn.spreadsheet import Row

router = APIRouter()

# ---------------------------------------------------------------------------
# Shared models
# ---------------------------------------------------------------------------


class Settings(BaseModel):
    api_key: str | None = None
    max_price: float | None = None
    no_images: bool = True
    tag: str = ""


class LookupRequest(BaseModel):
    line: str
    settings: Settings = Settings()


class BulkRequest(BaseModel):
    lines: list[str]
    settings: Settings = Settings()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_clients(settings: Settings) -> tuple[TCGClient, TCGDexClient, PriceChartingClient]:
    return (
        TCGClient(api_key=settings.api_key),
        TCGDexClient(),
        PriceChartingClient(),
    )


def _query_to_dict(q: CardQuery) -> dict[str, Any]:
    return {
        "raw": q.raw,
        "name": q.name,
        "set_hint": q.set_hint,
        "number": q.number,
        "variant_hint": q.variant_hint,
        "url_hint": q.url_hint,
        "bulk_top": q.bulk_top,
        "price_min": q.price_min,
        "price_max": q.price_max,
    }


def _pricing_to_dict(p: Pricing) -> dict[str, Any]:
    return {
        "market": p.market,
        "variant": p.variant,
        "source": p.source,
        "url": p.url,
        "currency": p.currency,
    }


def _row_to_dict(row: Row, reason: str = "matched") -> dict[str, Any]:
    card = row.card or {}
    return {
        "query": _query_to_dict(row.query),
        "card": card if card else None,
        "pricing": _pricing_to_dict(row.pricing),
        "tag": row.tag,
        "matched": row.card is not None,
        "reason": reason,
    }


def _do_lookup(
    pkmn: TCGClient,
    tcgdex: TCGDexClient,
    pc: PriceChartingClient,
    q: CardQuery,
    settings: Settings,
) -> list[Row]:
    """Run a blocking card lookup and return one or more Row objects."""
    rows: list[Row] = []

    if q.bulk_top:
        try:
            top = find_top_cards(pkmn, q, limit=q.bulk_top, max_price=settings.max_price)
        except req_lib.RequestException:
            top = []
        for card in top:
            pricing = extract_pricing(card, q.variant_hint)
            rows.append(Row(query=q, card=card, pricing=pricing, tag=settings.tag))
        if not top:
            rows.append(Row(query=q, card=None, pricing=Pricing(), tag=settings.tag))
    else:
        try:
            result = find_card(pkmn, tcgdex, pc, q)
        except req_lib.RequestException:
            from mgz_pkmn.sources.base import MatchResult

            result = MatchResult(None, "error")
        if result.card:
            pricing = extract_pricing(result.card, q.variant_hint)
            rows.append(
                Row(query=q, card=result.card, pricing=pricing, tag=settings.tag)
            )
        else:
            rows.append(Row(query=q, card=None, pricing=Pricing(), tag=settings.tag))

    return rows


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/lookup")
async def lookup(req: LookupRequest) -> dict:
    """Look up a single card line and return resolved rows.

    A bulk query (top-N) expands into multiple rows. A regular query returns
    exactly one row (matched or unmatched).
    """
    q = parse_line(req.line)
    if q is None:
        return {"rows": []}

    pkmn, tcgdex, pc = _make_clients(req.settings)
    rows = await run_in_threadpool(_do_lookup, pkmn, tcgdex, pc, q, req.settings)
    return {"rows": [_row_to_dict(r) for r in rows]}


@router.post("/bulk")
async def bulk(req: BulkRequest) -> StreamingResponse:
    """Stream row-by-row results for a multi-line lookup via Server-Sent Events.

    Each SSE event is a JSON object:
      `{ index, total, query, card, pricing, tag, matched, reason }`

    A final `{ done: true, total }` event is emitted when all lines are done.
    """
    queries: list[CardQuery] = []
    for line in req.lines:
        q = parse_line(line)
        if q is not None:
            queries.append(q)

    pkmn, tcgdex, pc = _make_clients(req.settings)
    total = len(queries)

    async def event_stream():
        for idx, q in enumerate(queries):
            rows = await run_in_threadpool(_do_lookup, pkmn, tcgdex, pc, q, req.settings)
            for row in rows:
                payload = {"index": idx, "total": total, **_row_to_dict(row)}
                yield f"data: {json.dumps(payload)}\n\n"
        yield f"data: {json.dumps({'done': True, 'total': total})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
