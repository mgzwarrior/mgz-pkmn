"""POST /api/v1/lookup and POST /api/v1/bulk (SSE) — card lookup routes."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
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
        "bulk_all": q.bulk_all,
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


def _terminal_stage(matched: bool, reason: str) -> str:
    """Map a resolved row's (matched, reason) onto a terminal pipeline stage.

    Mirrors the `LOOKUP_STAGES` vocabulary so the SPA can render the final
    chip from the same field it uses for intermediate progress: a hard
    failure (network / unparseable) is `error`, a match is `resolved`, and
    every "looked but found nothing" reason (`no_candidates`, `set_mismatch`,
    `no_results`, `price_mismatch`) is `no_match`."""
    if reason in ("error", "unparseable"):
        return "error"
    return "resolved" if matched else "no_match"


def _row_to_dict(row: Row, reason: str) -> dict[str, Any]:
    card = row.card or {}
    matched = row.card is not None
    return {
        "query": _query_to_dict(row.query),
        "card": card if card else None,
        "pricing": _pricing_to_dict(row.pricing),
        "tag": row.tag,
        "matched": matched,
        "reason": reason,
        "stage": _terminal_stage(matched, reason),
    }


def _do_lookup(
    pkmn: TCGClient,
    tcgdex: TCGDexClient,
    pc: PriceChartingClient,
    q: CardQuery,
    settings: Settings,
    on_stage: Callable[[str], None] | None = None,
) -> list[tuple[Row, str]]:
    """Run a blocking card lookup and return (Row, reason) pairs.

    `reason` mirrors `MatchResult.reason` for single lookups
    ("matched" | "no_candidates" | "set_mismatch") and uses synthetic values
    for bulk / error paths ("matched" | "no_results" | "error").

    `on_stage`, when provided, is forwarded into the lookup coordinator so the
    caller can stream finer-grained per-line progress (see `LOOKUP_STAGES`).
    It runs synchronously on this worker thread; the SSE route hops each call
    back onto the event loop.
    """
    out: list[tuple[Row, str]] = []

    if q.bulk_top or q.bulk_all:
        try:
            effective_limit = None if q.bulk_all else q.bulk_top
            top = find_top_cards(
                pkmn, q, limit=effective_limit, max_price=settings.max_price, on_stage=on_stage
            )
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
            result = find_card(pkmn, tcgdex, pc, q, default_lang=settings.lang, on_stage=on_stage)
        except req_lib.RequestException:
            from mgz_pkmn.sources.base import MatchResult

            result = MatchResult(None, "error")
        if result.card:
            if on_stage is not None:
                on_stage("pricing")
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


def _stage_frame(index: int, total: int, stage: str) -> str:
    """Serialize a progress-only SSE frame (no row payload).

    Distinguishable from a resolved-row frame by the absence of `matched` /
    `query` — the SPA branches on that to update a line's current stage
    without appending a result row."""
    return f"data: {json.dumps({'index': index, 'total': total, 'stage': stage})}\n\n"


# Sentinel pushed onto a line's stage queue once its threadpool lookup
# resolves, so the async drain loop knows to stop waiting for more stages.
_STAGE_DONE = object()


@router.post("/bulk")
async def bulk(req: BulkRequest) -> StreamingResponse:
    """Stream row-by-row results for a multi-line lookup via Server-Sent Events.

    Two kinds of per-line frames are emitted, both carrying `{ index, total }`:

    * **Progress** — `{ stage }` only. Fired as a line moves through the
      pipeline (`parsed` → `looking_up` → `fallback`/`url_hint` → `pricing`).
    * **Resolved row** — the full `{ query, card, pricing, tag, matched,
      reason, stage }` object, where `stage` is the terminal state
      (`resolved` / `no_match` / `error`). A `top:N` line emits several.

    Blank / `#`-comment lines are silently skipped (matching CLI behavior),
    so they don't appear in the stream and don't count toward `total`. Lines
    that fail to parse are emitted as a single unmatched row event with
    `reason: "unparseable"` (terminal stage `error`), so the client never
    silently loses input.

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
        loop = asyncio.get_running_loop()
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

            # The line is in the pipeline before any upstream call goes out.
            yield _stage_frame(stream_idx, total, "parsed")

            # Bridge the synchronous `on_stage` callback (invoked on the
            # threadpool worker) to this async generator. The worker pushes
            # stage names via `call_soon_threadsafe`; a done-callback pushes a
            # sentinel once the lookup returns. We drain in between, so stage
            # frames interleave with the blocking lookup in real time.
            stage_queue: asyncio.Queue = asyncio.Queue()

            def on_stage(name: str, _q: asyncio.Queue = stage_queue) -> None:
                loop.call_soon_threadsafe(_q.put_nowait, name)

            task = asyncio.ensure_future(
                run_in_threadpool(_do_lookup, pkmn, tcgdex, pc, q, req.settings, on_stage)
            )
            task.add_done_callback(lambda _t, _q=stage_queue: _q.put_nowait(_STAGE_DONE))

            while True:
                item = await stage_queue.get()
                if item is _STAGE_DONE:
                    break
                yield _stage_frame(stream_idx, total, item)

            for row, reason in task.result():
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
