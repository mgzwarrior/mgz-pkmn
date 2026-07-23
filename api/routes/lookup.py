"""POST /api/v1/lookup and POST /api/v1/bulk (SSE) — card lookup routes.

`/bulk` also persists a `Run` row + N `RunRow`s when the stream completes
successfully (see ADR-0013 and `api.db`). Client disconnects mid-stream
do not write — the persistence call is the last thing in the generator,
so an early close stops the iteration before commit."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import Callable
from functools import lru_cache
from typing import Any

import requests as req_lib
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from mgz_pkmn.lookup import find_card, find_top_cards
from mgz_pkmn.parser import CardQuery, parse_line
from mgz_pkmn.pricing import Pricing, extract_pricing
from mgz_pkmn.sources import EbayClient, PriceChartingClient, TCGClient, TCGDexClient
from mgz_pkmn.sources.base import worse_cache_status
from mgz_pkmn.spreadsheet import Row

from ..auth.session import CurrentUserOptional, auth_enabled
from ..cache_mode import cache_only_enabled
from ..db.models import DEFAULT_USER_ID, Run, User
from ..db.serialize import build_run_summary, row_to_run_row
from ..db.session import get_session_factory
from .cards import rewrite_card_image_urls

logger = logging.getLogger(__name__)

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


@lru_cache(maxsize=1)
def _sessions_for() -> tuple[req_lib.Session, req_lib.Session, req_lib.Session, req_lib.Session]:
    """One warm, header-light ``requests.Session`` per upstream (#302).

    Sharing the session across requests keeps its connection pool warm, so
    every upstream hit reuses a kept-alive connection instead of paying a
    fresh TLS handshake. Each upstream gets its *own* session so connections
    (and any default headers) don't cross hosts.

    Crucially the sessions carry **no per-request secret**: a caller-supplied
    pokemontcg.io api_key is applied per request as an ``X-Api-Key`` header by
    ``TCGClient`` itself, never stored on the pooled session or used as a
    cache key — so BYO credentials stay request-scoped rather than lingering
    in process-global state.

    We also memoize the session, not the client: the clients carry an
    instance-local L1 ``_cache`` with no TTL, written on STALE/MISS reads and
    keyed without ``cache_only``. Reusing a client across requests would pin
    those entries process-wide — serving stale or empty results and
    suppressing the disk SWR refresh until restart. Fresh clients per request
    keep that L1 cache request-scoped (its original contract) while the shared
    session still delivers the connection-reuse win. ``lru_cache`` and
    ``Session.get``/``post`` are both safe for the concurrent FastAPI
    threadpool.
    """
    return (
        req_lib.Session(),
        req_lib.Session(),
        req_lib.Session(),
        req_lib.Session(),
    )


def _make_clients(
    settings: Settings,
) -> tuple[TCGClient, TCGDexClient, PriceChartingClient, EbayClient]:
    pkmn_s, tcgdex_s, pc_s, ebay_s = _sessions_for()
    return (
        TCGClient(api_key=settings.api_key, session=pkmn_s),
        TCGDexClient(session=tcgdex_s),
        PriceChartingClient(session=pc_s),
        EbayClient(session=ebay_s),
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
        "condition": p.condition,
        "condition_multiplier": p.condition_multiplier,
        "adjusted_market": p.adjusted_market,
        "ebay_sold_median": p.ebay_sold_median,
        "ebay_active_floor": p.ebay_active_floor,
        "pricing_override": p.pricing_override,
    }


def _terminal_stage(matched: bool, reason: str) -> str:
    """Map a resolved row's (matched, reason) onto a terminal pipeline stage.

    Mirrors the `LOOKUP_STAGES` vocabulary so the SPA can render the final
    chip from the same field it uses for intermediate progress: a hard
    failure (network / scrape / unparseable) is `error`, a match is
    `resolved`, and every "looked but found nothing" reason
    (`no_candidates`, `set_mismatch`, `no_results`, `price_mismatch`) is
    `no_match`."""
    if reason in ("error", "scrape_failed", "unparseable"):
        return "error"
    return "resolved" if matched else "no_match"


def _row_to_dict(row: Row, reason: str) -> dict[str, Any]:
    card = row.card or {}
    matched = row.card is not None
    # Rewrite cached image URLs to our self-hosted route (#371). Cache
    # miss leaves the upstream URL in place so the SPA still renders.
    serialised_card = rewrite_card_image_urls(card if card else None)
    # Other plausible matches for an ambiguous name-only query (#948), so the
    # SPA can offer a picklist instead of silently committing to `card`.
    serialised_candidates = (
        [rewrite_card_image_urls(c) for c in row.candidates] if row.candidates else None
    )
    return {
        "query": _query_to_dict(row.query),
        "card": serialised_card,
        "candidates": serialised_candidates,
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
    *,
    cache_only: bool = False,
    ebay: EbayClient | None = None,
) -> tuple[list[tuple[Row, str]], str]:
    """Run a blocking card lookup and return `(pairs, cache_status)`.

    `pairs` is a list of (Row, reason) tuples; `reason` mirrors
    `MatchResult.reason` for single lookups
    ("matched" | "no_candidates" | "set_mismatch") and uses synthetic values
    for bulk / error paths ("matched" | "no_results" | "error").

    `cache_status` aggregates the worst split-cache outcome
    (`HIT` / `STALE` / `MISS`) across every disk-cache read this lookup
    touched. Threaded up so the `/lookup` route can attach an `X-Cache`
    response header (#310 / #372). MISS dominates STALE dominates HIT.

    `on_stage`, when provided, is forwarded into the lookup coordinator so the
    caller can stream finer-grained per-line progress (see `LOOKUP_STAGES`).
    It runs synchronously on this worker thread; the SSE route hops each call
    back onto the event loop.
    """
    out: list[tuple[Row, str]] = []
    # Aggregate the worst cache status observed across the lookup via
    # `worse_cache_status` (MISS > STALE > HIT). Seed at "HIT" — every
    # branch below calls `_bump_status` at least once, so the seed is
    # immediately overwritten by the first observation; it just makes
    # the aggregate well-defined if a future refactor adds a branch
    # that doesn't bump. Sources without a disk cache (PriceCharting,
    # TCGdex today) default their MatchResult.cache_status to "MISS",
    # which correctly surfaces as MISS — those calls *did* hit upstream.
    status_acc: list[str] = ["HIT"]

    def _bump_status(s: str) -> None:
        status_acc[0] = worse_cache_status(status_acc[0], s)

    def _with_ebay(pricing: Pricing, card: dict[str, Any]) -> Pricing:
        """Fold eBay comps into `pricing` when the source is configured.

        Auto-on when credentials are present; a no-op (eBay fields stay None)
        otherwise, so an unconfigured deploy behaves exactly as before with no
        extra network call.
        """
        if ebay is not None and ebay.auth.configured:
            pricing.ebay_sold_median, pricing.ebay_active_floor = ebay.comps_for_card(card)
        return pricing

    if q.bulk_top or q.bulk_all:
        try:
            effective_limit = None if q.bulk_all else q.bulk_top
            top = find_top_cards(
                pkmn,
                q,
                limit=effective_limit,
                max_price=settings.max_price,
                on_stage=on_stage,
                on_cache_status=_bump_status,
                cache_only=cache_only,
            )
            err = False
        except req_lib.RequestException:
            top = []
            err = True
        for card in top:
            pricing = _with_ebay(extract_pricing(card, q.variant_hint), card)
            out.append((Row(query=q, card=card, pricing=pricing, tag=settings.tag), "matched"))
        if not top:
            reason = "error" if err else "no_results"
            out.append((Row(query=q, card=None, pricing=Pricing(), tag=settings.tag), reason))
    else:
        try:
            result = find_card(
                pkmn,
                tcgdex,
                pc,
                q,
                default_lang=settings.lang,
                on_stage=on_stage,
                cache_only=cache_only,
            )
        except req_lib.RequestException:
            from mgz_pkmn.sources.base import MatchResult

            result = MatchResult(None, "error")
        _bump_status(result.cache_status)
        if result.card:
            if on_stage is not None:
                on_stage("pricing")
            pricing = _with_ebay(extract_pricing(result.card, q.variant_hint), result.card)
            out.append(
                (
                    Row(
                        query=q,
                        card=result.card,
                        pricing=pricing,
                        tag=settings.tag,
                        candidates=result.candidates,
                    ),
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

    return out, status_acc[0]


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


def _cache_only_for_user(current_user: User | None) -> bool:
    # `MGZ_PKMN_CACHE_ONLY` pins the whole surface offline (e2e determinism,
    # see `api.cache_mode`); otherwise anonymous traffic on an auth-enabled
    # deploy stays cache-only so it can't drive upstream fetches.
    return cache_only_enabled() or (auth_enabled() and current_user is None)


@router.post("/lookup")
async def lookup(req: LookupRequest, current_user: CurrentUserOptional) -> JSONResponse:
    """Look up a single card line and return resolved rows.

    A bulk query (top-N) expands into multiple rows. A regular query returns
    exactly one row (matched or unmatched). Blank / comment lines return
    no rows.

    Sets an `X-Cache` response header (`HIT` / `STALE` / `MISS`) per #372 /
    #310: HIT means every disk-cache lookup was within TTL; STALE means at
    least one read served stale pricing and kicked off a background
    refresh; MISS means at least one read hit upstream. The skippable /
    unparseable branches default to MISS — there was no L2 lookup to
    grade.
    """
    if _is_skippable(req.line):
        return JSONResponse(content={"rows": []}, headers={"X-Cache": "MISS"})

    q = parse_line(req.line)
    if q is None:
        row = _unparseable_row(req.line, req.settings.tag)
        return JSONResponse(
            content={"rows": [_row_to_dict(row, "unparseable")]},
            headers={"X-Cache": "MISS"},
        )

    pkmn, tcgdex, pc, ebay = _make_clients(req.settings)
    pairs, cache_status = await run_in_threadpool(
        _do_lookup,
        pkmn,
        tcgdex,
        pc,
        q,
        req.settings,
        cache_only=_cache_only_for_user(current_user),
        ebay=ebay,
    )
    return JSONResponse(
        content={"rows": [_row_to_dict(r, reason) for r, reason in pairs]},
        headers={"X-Cache": cache_status},
    )


_BULK_CONCURRENCY_ENV = "MGZ_PKMN_BULK_CONCURRENCY"
_DEFAULT_BULK_CONCURRENCY = 8


def _bulk_concurrency() -> int:
    """Max number of /bulk lines looked up at once (#303).

    Bounded by `MGZ_PKMN_BULK_CONCURRENCY` (default 8) — high enough to mask
    upstream latency, low enough that a burst stays within pokemontcg.io's
    30 rpm free tier. The upstream client's 429 backoff (`pokemontcg.py`)
    absorbs any transient overshoot. A value below 1 (or unparseable) falls
    back to the default."""
    try:
        n = int(os.environ.get(_BULK_CONCURRENCY_ENV, "").strip())
    except ValueError:
        return _DEFAULT_BULK_CONCURRENCY
    return n if n >= 1 else _DEFAULT_BULK_CONCURRENCY


# Sentinel pushed onto the shared frame queue once every line's lookup has
# resolved, so the async drain loop knows the stream is complete.
_STREAM_DONE = object()


@router.post("/bulk")
async def bulk(req: BulkRequest, current_user: CurrentUserOptional) -> StreamingResponse:
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

    pkmn, tcgdex, pc, ebay = _make_clients(req.settings)
    cache_only = _cache_only_for_user(current_user)

    async def event_stream():
        loop = asyncio.get_running_loop()
        started = time.monotonic()

        # Fan the lines out with bounded concurrency (#303): each line runs as
        # its own task gated by a semaphore, so at most `_bulk_concurrency()`
        # lookups hit upstream at once instead of walking the list strictly
        # serially. Every frame (progress + resolved row) is pushed onto one
        # shared queue that the generator drains and yields as events complete
        # — *not* in input order. Clients key on `index`, so arrival order
        # doesn't matter to the SPA's per-line `ProcessingQueue`.
        sem = asyncio.Semaphore(_bulk_concurrency())
        frames: asyncio.Queue = asyncio.Queue()
        # Per-line resolved Rows keyed by stream index, so we can persist in
        # input order even though lookups finish out of order.
        resolved_by_idx: dict[int, list[Row]] = {}
        # Per-line split-cache outcomes, aggregated into the `done` event so the
        # SPA can render a single run-level source chip (#310). Appended from the
        # loop thread once each `run_in_threadpool` resolves — no lock needed.
        cache_statuses: list[str] = []

        async def process_line(stream_idx: int, line: str) -> None:
            async with sem:
                q = parse_line(line)
                if q is None:
                    # Deliberately *not* appended to `cache_statuses`: an
                    # unparseable line performs no cache read, so it can't be
                    # graded HIT/STALE/MISS. The run-level chip reports where the
                    # actual results came from, and folding a synthetic MISS in
                    # here would make an all-cache-hit run with one typo claim it
                    # went upstream. An all-unparseable run still reports MISS via
                    # the empty-list default below, matching the /lookup route.
                    row = _unparseable_row(line, req.settings.tag)
                    resolved_by_idx[stream_idx] = [row]
                    await frames.put(
                        {"index": stream_idx, "total": total, **_row_to_dict(row, "unparseable")}
                    )
                    return

                # The line is in the pipeline before any upstream call goes out.
                await frames.put({"index": stream_idx, "total": total, "stage": "parsed"})

                # Bridge the synchronous `on_stage` callback (invoked on the
                # threadpool worker) onto the shared frame queue from the loop
                # thread, so stage frames interleave with the blocking lookup
                # in real time.
                def on_stage(name: str, _idx: int = stream_idx) -> None:
                    loop.call_soon_threadsafe(
                        frames.put_nowait,
                        {"index": _idx, "total": total, "stage": name},
                    )

                # `_do_lookup` returns (pairs, cache_status). The per-row pairs
                # stream out as events; the aggregate status feeds the run-level
                # source chip carried on the `done` event (#310).
                pairs, line_status = await run_in_threadpool(
                    _do_lookup,
                    pkmn,
                    tcgdex,
                    pc,
                    q,
                    req.settings,
                    on_stage,
                    cache_only=cache_only,
                    ebay=ebay,
                )
                cache_statuses.append(line_status)
                resolved_by_idx[stream_idx] = [row for row, _reason in pairs]
                for row, reason in pairs:
                    await frames.put(
                        {"index": stream_idx, "total": total, **_row_to_dict(row, reason)}
                    )

        tasks = [
            asyncio.ensure_future(process_line(stream_idx, line))
            for stream_idx, (_orig_idx, line) in enumerate(indexed)
        ]

        async def _signal_when_done() -> None:
            # `return_exceptions=True` guarantees the done sentinel is always
            # queued (a raising task can't deadlock the drain loop). `_do_lookup`
            # already swallows upstream RequestExceptions into error rows, so a
            # task exception here is unexpected — log it and carry on.
            for result in await asyncio.gather(*tasks, return_exceptions=True):
                if isinstance(result, Exception):
                    logger.error("A /bulk line task failed", exc_info=result)
            await frames.put(_STREAM_DONE)

        runner = asyncio.ensure_future(_signal_when_done())

        # Drain frames as they land and stream them out. ADR-0013:
        # failures-during-stream don't write — the persistence call is after
        # this loop, so a client disconnect stops iteration before the commit.
        try:
            while True:
                item = await frames.get()
                if item is _STREAM_DONE:
                    break
                yield f"data: {json.dumps(item)}\n\n"
            await runner  # surface bookkeeping errors from the done-signal task
        except BaseException:
            # Client disconnect (the Stop button aborts the fetch, raising
            # GeneratorExit here) or a mid-stream error: cancel the fan-out so
            # queued lookups stop hitting upstream into a queue nobody reads
            # (#303). In-flight threadpool calls can't be force-killed, but on
            # a large pasted list the bulk of the work is still parked on the
            # semaphore and cancels immediately. Persistence below is skipped —
            # the re-raise exits the generator before the commit (ADR-0013).
            for task in tasks:
                task.cancel()
            runner.cancel()
            await asyncio.gather(*tasks, runner, return_exceptions=True)
            raise

        resolved: list[Row] = [
            row for idx in sorted(resolved_by_idx) for row in resolved_by_idx[idx]
        ]
        elapsed = time.monotonic() - started
        run_id: int | None = None
        try:
            run_id = _persist_run(
                req.lines,
                resolved,
                elapsed,
                user_id=current_user.id if current_user is not None else DEFAULT_USER_ID,
            )
        except Exception:  # pragma: no cover — defensive, persistence is best-effort
            logger.exception("Failed to persist run after /bulk completion")

        # Aggregate the per-line outcomes into one run-level signal (MISS
        # dominates STALE dominates HIT). No real lookup ran (all lines blank
        # or unparseable) → MISS, matching the /lookup route's default.
        run_cache_status = worse_cache_status(*cache_statuses) if cache_statuses else "MISS"
        # `run_id` surfaces so the SPA can offer a "Save this search" action
        # against the just-completed run without re-querying the list;
        # `cache_status` feeds the lookup-timer source chip (#310).
        yield (
            "data: "
            + json.dumps(
                {
                    "done": True,
                    "total": total,
                    "run_id": run_id,
                    "cache_status": run_cache_status,
                }
            )
            + "\n\n"
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _persist_run(
    lines: list[str],
    rows: list[Row],
    elapsed_seconds: float,
    *,
    user_id: int = DEFAULT_USER_ID,
) -> int | None:
    """Write a `runs` record + N `run_rows` for a completed /bulk stream.

    Returns the new run id, or None if persistence fell through (engine
    not built, table missing, etc. — persistence is best-effort and never
    fails the request)."""
    session = get_session_factory()()
    try:
        run = Run(
            user_id=user_id,
            input_text="\n".join(lines),
            elapsed_seconds=elapsed_seconds,
            summary_json=build_run_summary(rows),
            rows=[row_to_run_row(r, position=i) for i, r in enumerate(rows)],
        )
        session.add(run)
        session.commit()
        return run.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
