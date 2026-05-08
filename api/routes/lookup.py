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
    lang: str | None = None  # default TCGdex language code (e.g. "ja", "fr")


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


def _row_to_dict(row: Row, reason: str) -> dict[str, Any]:
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
) -> list[tuple[Row, str]]:
    """Run a blocking card lookup and return (Row, reason) pairs.

    `reason` mirrors `MatchResult.reason` for single lookups
    ("matched" | "no_candidates" | "set_mismatch") and uses synthetic values
    for bulk / error paths ("matched" | "no_results" | "error").
    """
    out: list[tuple[Row, str]] = []

    if q.bulk_top:
        try:
            top = find_top_cards(pkmn, q, limit=q.bulk_top, max_price=settings.max_price)
            err = False
        except req_lib.RequestException:
            top = []
            err = True
        for card in top:
            pricing = extract_pricing(card, q.variant_hint)
            out.append((Row(query=q, card=card, pricing=pricing, tag=settings.tag), "matched"))
        if not top:
            reason = "error" if err else "no_results"
            out.append((Row(query=q, card=None, pricing=Pricing(), tag=settings.tag), reason))
    else:
        try:
            result = find_card(pkmn, tcgdex, pc, q, default_lang=settings.lang)
        except req_lib.RequestException:
            from mgz_pkmn.sources.base import MatchResult

            result = MatchResult(None, "error")
        if result.card:
            pricing = extract_pricing(result.card, q.variant_hint)
            out.append(
                (
                    Row(query=q, card=result.card, pricing=pricing, tag=settings.tag),
                    "matched",
                )
            )
        else:
            out.append(
                (
                    Row(query=q, card=None, pricing=Pricing(), tag=settings.tag),
                    result.reason,
                )
            )

    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def _is_skippable(line: str) -> bool:
    """Blank or `#`-comment lines are intentionally ignored (matches CLI)."""
    s = line.strip()
    return not s or s.startswith("#")


def _unparseable_row(line: str, tag: str) -> Row:
    """Synthesize a Row for a non-blank line that the parser couldn't decode."""
    placeholder = CardQuery(raw=line, name=line.strip())
    return Row(query=placeholder, card=None, pricing=Pricing(), tag=tag)


@router.post("/lookup")
async def lookup(req: LookupRequest) -> dict:
    """Look up a single card line and return resolved rows.

    A bulk query (top-N) expands into multiple rows. A regular query returns
    exactly one row (matched or unmatched). Blank / comment lines return
    no rows.
    """
    if _is_skippable(req.line):
        return {"rows": []}

    q = parse_line(req.line)
    if q is None:
        row = _unparseable_row(req.line, req.settings.tag)
        return {"rows": [_row_to_dict(row, "unparseable")]}

    pkmn, tcgdex, pc = _make_clients(req.settings)
    pairs = await run_in_threadpool(_do_lookup, pkmn, tcgdex, pc, q, req.settings)
    return {"rows": [_row_to_dict(r, reason) for r, reason in pairs]}


@router.post("/bulk")
async def bulk(req: BulkRequest) -> StreamingResponse:
    """Stream row-by-row results for a multi-line lookup via Server-Sent Events.

    Each SSE event is a JSON object:
      `{ index, total, query, card, pricing, tag, matched, reason }`

    Blank / `#`-comment lines are silently skipped (matching CLI behavior),
    so they don't appear in the stream and don't count toward `total`. Lines
    that fail to parse are emitted as a single unmatched event with
    `reason: "unparseable"`, so the client never silently loses input.

    A final `{ done: true, total }` event is emitted when all lines are done.
    """
    # Filter out skippable lines, but keep originals (parseable or not) in
    # order so client progress matches user-submitted intent.
    indexed: list[tuple[int, str]] = [
        (i, line) for i, line in enumerate(req.lines) if not _is_skippable(line)
    ]
    total = len(indexed)

    pkmn, tcgdex, pc = _make_clients(req.settings)

    async def event_stream():
        for stream_idx, (_orig_idx, line) in enumerate(indexed):
            q = parse_line(line)
            if q is None:
                row = _unparseable_row(line, req.settings.tag)
                payload = {
                    "index": stream_idx,
                    "total": total,
                    **_row_to_dict(row, "unparseable"),
                }
                yield f"data: {json.dumps(payload)}\n\n"
                continue

            pairs = await run_in_threadpool(_do_lookup, pkmn, tcgdex, pc, q, req.settings)
            for row, reason in pairs:
                payload = {
                    "index": stream_idx,
                    "total": total,
                    **_row_to_dict(row, reason),
                }
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
