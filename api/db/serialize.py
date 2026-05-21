"""Convert in-memory `Row`s to the persisted column shape and back.

Single source of truth for the wire-↔-storage mapping. Used by:

- `routes/lookup.py` after a streaming `/bulk` completes, to write rows.
- `routes/runs.py` to reconstruct rows for `GET /runs/{id}` and re-export.

Stays separate from `models.py` so the model definitions don't carry the
serialisation logic, which keeps the Alembic autogenerate diffs clean."""

from __future__ import annotations

from typing import Any

from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.spreadsheet import Row

from .models import RunRow

# ---------------------------------------------------------------------------
# Row → RunRow
# ---------------------------------------------------------------------------


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


def row_to_run_row(row: Row, position: int) -> RunRow:
    """Build a `RunRow` ORM instance from an in-memory `Row`.

    `market_price` and `currency` are promoted out of `pricing_json` per
    ADR-0013 so list filters are real SQL. `card_json` is NULL on miss
    (rather than `{}`) so `WHERE card_json IS NULL` finds unmatched rows
    natively."""
    return RunRow(
        position=position,
        tag=row.tag,
        market_price=row.pricing.market,
        currency=row.pricing.currency or None,
        image_path=str(row.image_path) if row.image_path else None,
        query_json=_query_to_dict(row.query),
        card_json=row.card if row.card else None,
        pricing_json=_pricing_to_dict(row.pricing),
    )


# ---------------------------------------------------------------------------
# RunRow → Row (for re-export and GET /runs/{id})
# ---------------------------------------------------------------------------


def run_row_to_row(rr: RunRow) -> Row:
    """Inverse of `row_to_run_row` — reconstructs the in-memory `Row`.

    The image is left detached (`image_path` carries the original on-disk
    path which may no longer exist on a re-export); callers that want art
    embedded need to download it again. The export path already handles
    this fine — `_download_card_image` is called on the reconstructed Row."""
    q = rr.query_json or {}
    p = rr.pricing_json or {}
    query = CardQuery(
        raw=q.get("raw", ""),
        name=q.get("name", ""),
        set_hint=q.get("set_hint"),
        number=q.get("number"),
        variant_hint=q.get("variant_hint"),
        url_hint=q.get("url_hint"),
        bulk_top=q.get("bulk_top"),
        price_min=q.get("price_min"),
        price_max=q.get("price_max"),
        bulk_all=q.get("bulk_all", False),
    )
    # `pricing_json` is the canonical source; the promoted `market_price` /
    # `currency` columns are derived for SQL filtering only. Reconstructing
    # from JSON avoids a Decimal-vs-float coercion dance and keeps a single
    # round-trip path.
    pricing = Pricing(
        market=p.get("market"),
        variant=p.get("variant"),
        source=p.get("source"),
        url=p.get("url"),
        currency=p.get("currency") or "USD",
    )
    return Row(
        query=query,
        card=rr.card_json,
        pricing=pricing,
        image_path=None,  # disconnected — caller re-downloads if needed
        tag=rr.tag,
    )


# ---------------------------------------------------------------------------
# Summary — lightweight aggregate stored on the `runs` row itself
# ---------------------------------------------------------------------------


def build_run_summary(rows: list[Row]) -> dict[str, Any]:
    """Compute the per-run aggregate stored in `runs.summary_json`.

    Cheap to render in the sidebar without loading `run_rows`. Stays
    intentionally small — the full report payload (`build_json_report`)
    is reconstructable from `run_rows` on demand."""
    matched = [r for r in rows if r.card is not None]
    priced = [r for r in matched if r.pricing.market is not None]
    by_currency: dict[str, float] = {}
    for r in priced:
        cur = r.pricing.currency or "USD"
        by_currency[cur] = round(by_currency.get(cur, 0.0) + (r.pricing.market or 0.0), 2)
    tags: dict[str, int] = {}
    for r in rows:
        if r.tag:
            tags[r.tag] = tags.get(r.tag, 0) + 1
    return {
        "total_rows": len(rows),
        "matched": len(matched),
        "missed": len(rows) - len(matched),
        "priced": len(priced),
        "totals_by_currency": by_currency,
        "tag_counts": tags,
    }
