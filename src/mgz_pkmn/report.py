"""Build the structured JSON digest emitted by `--report-json`.

Pure dataclass-style transformation of a list of `Row` into the shape
described in the README — no I/O. The CLI is responsible for serializing
and writing the dict; tests can assemble fixtures and assert on the output
without touching the filesystem.
"""

from __future__ import annotations

from datetime import UTC, datetime
from statistics import median
from typing import Any

from . import __version__
from .pricing import COMP_PERCENTS
from .spreadsheet import Row


def _card_summary(r: Row) -> dict[str, Any]:
    """Compact card identity used in highlights / per-tag winners."""
    card = r.card or {}
    return {
        "tag": r.tag,
        "name": card.get("name"),
        "set": (card.get("set") or {}).get("name"),
        "number": card.get("number"),
        "rarity": card.get("rarity"),
        "market": r.pricing.market_or_override,
        "currency": r.pricing.currency,
        "variant": r.pricing.variant,
        "url": r.pricing.url,
    }


def _totals_by_currency(rs: list[Row]) -> dict[str, dict[str, Any]]:
    """Sum market + comps per currency. Mixed-currency runs stay separable."""
    out: dict[str, dict[str, Any]] = {}
    for r in rs:
        if r.pricing.market_or_override is None:
            continue
        bucket = out.setdefault(
            r.pricing.currency,
            {"row_count": 0, "market": 0.0, **{f"{p}%": 0.0 for p in COMP_PERCENTS}},
        )
        bucket["row_count"] += 1
        bucket["market"] += r.pricing.market_or_override
        for p in COMP_PERCENTS:
            bucket[f"{p}%"] += r.pricing.market_or_override * p / 100
    for bucket in out.values():
        for k in ("market", *(f"{p}%" for p in COMP_PERCENTS)):
            bucket[k] = round(bucket[k], 2)
    return out


def _stats_by_currency(rs: list[Row]) -> dict[str, dict[str, float]]:
    """Avg / median / min / max market price per currency."""
    prices: dict[str, list[float]] = {}
    for r in rs:
        if r.pricing.market_or_override is None:
            continue
        prices.setdefault(r.pricing.currency, []).append(r.pricing.market_or_override)
    return {
        cur: {
            "average": round(sum(vs) / len(vs), 2),
            "median": round(median(vs), 2),
            "min": round(min(vs), 2),
            "max": round(max(vs), 2),
        }
        for cur, vs in prices.items()
    }


def _highest_value(rs: list[Row]) -> dict[str, Any] | None:
    """Highest market within a row group. Caveat: mixes currencies arithmetically;
    intended as a quick "what's the headline card here?" hint, not a comparator."""
    priced = [r for r in rs if r.pricing.market_or_override is not None]
    if not priced:
        return None
    return _card_summary(max(priced, key=lambda r: r.pricing.market_or_override or 0.0))


def _count_by(rs: list[Row], key_fn) -> dict[str, int]:
    """Frequency table sorted high-to-low. Skips None keys."""
    out: dict[str, int] = {}
    for r in rs:
        k = key_fn(r)
        if k is None:
            continue
        out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _comps(market: float | None) -> dict[str, float] | None:
    if market is None:
        return None
    return {f"{p}%": round(market * p / 100, 2) for p in COMP_PERCENTS}


def _is_over_cap(r: Row, max_price: float | None) -> bool:
    market = r.pricing.market_or_override
    return max_price is not None and market is not None and market > max_price


def _tags_section(rows: list[Row]) -> list[dict[str, Any]]:
    """Per-tag aggregates, preserving first-appearance order."""
    tag_order: list[str] = []
    tag_buckets: dict[str, list[Row]] = {}
    for r in rows:
        if r.tag not in tag_buckets:
            tag_order.append(r.tag)
            tag_buckets[r.tag] = []
        tag_buckets[r.tag].append(r)

    tags_payload = []
    for tag in tag_order:
        bucket = tag_buckets[tag]
        bucket_matched = [r for r in bucket if r.card is not None]
        bucket_priced = [r for r in bucket_matched if r.pricing.market_or_override is not None]
        tags_payload.append(
            {
                "tag": tag,
                "rows": len(bucket),
                "matched": len(bucket_matched),
                "missed": len(bucket) - len(bucket_matched),
                "priced": len(bucket_priced),
                "totals_by_currency": _totals_by_currency(bucket),
                "stats_by_currency": _stats_by_currency(bucket),
                "highest_value_card": _highest_value(bucket),
            }
        )
    return tags_payload


def _summary_section(
    rows: list[Row],
    matched_rows: list[Row],
    priced_rows: list[Row],
    counters: dict[str, int],
    input_lines: int,
    deduped_rows: int,
    sort_mode: str | None,
    above_cap_count: int,
) -> dict[str, Any]:
    return {
        "sort_mode": sort_mode,
        "input_lines": input_lines,
        "rows_total": len(rows),
        "rows_deduped": deduped_rows,
        "rows_matched": len(matched_rows),
        "rows_missed": len(rows) - len(matched_rows),
        "rows_bulk_expanded": counters.get("bulk", 0),
        "rows_priced": len(priced_rows),
        "rows_unpriced_matched": len(matched_rows) - len(priced_rows),
        "totals_by_currency": _totals_by_currency(rows),
        "stats_by_currency": _stats_by_currency(rows),
        "by_database": _count_by(matched_rows, lambda r: (r.card or {}).get("_database")),
        "by_price_source": _count_by(matched_rows, lambda r: r.pricing.source),
        "by_rarity": _count_by(matched_rows, lambda r: (r.card or {}).get("rarity")),
        "by_language": _count_by(matched_rows, lambda r: (r.card or {}).get("language")),
        "rows_above_max_price": above_cap_count,
    }


def _above_cap(rows: list[Row], max_price: float | None) -> list[dict[str, Any]]:
    return [
        {
            "tag": r.tag,
            "input": r.query.raw,
            "name": (r.card or {}).get("name"),
            "market": r.pricing.market_or_override,
            "currency": r.pricing.currency,
        }
        for r in rows
        if _is_over_cap(r, max_price)
    ]


def _highlights_section(
    rows: list[Row], priced_rows: list[Row], above_cap: list[dict[str, Any]]
) -> dict[str, Any]:
    top5 = sorted(priced_rows, key=lambda r: r.pricing.market_or_override or 0.0, reverse=True)[:5]
    return {
        "most_valuable": [_card_summary(r) for r in top5],
        "missing": [{"tag": r.tag, "input": r.query.raw} for r in rows if r.card is None],
        "above_max_price": above_cap,
    }


def _rows_section(rows: list[Row], max_price: float | None) -> list[dict[str, Any]]:
    return [
        {
            "tag": r.tag,
            "input": r.query.raw,
            "matched": bool(r.card),
            "name": (r.card or {}).get("name"),
            "set": ((r.card or {}).get("set") or {}).get("name"),
            "number": (r.card or {}).get("number"),
            "rarity": (r.card or {}).get("rarity"),
            "language": (r.card or {}).get("language"),
            "database": (r.card or {}).get("_database"),
            "image_path": str(r.image_path) if r.image_path else None,
            "market": r.pricing.market_or_override,
            "currency": r.pricing.currency,
            "variant": r.pricing.variant,
            "source": r.pricing.source,
            "url": r.pricing.url,
            "comps": _comps(r.pricing.market_or_override),
            "ebay_sold_median": r.pricing.ebay_sold_median,
            "ebay_active_floor": r.pricing.ebay_active_floor,
            "pricing_override": r.pricing.pricing_override,
            "over_max_price": _is_over_cap(r, max_price),
        }
        for r in rows
    ]


def build_json_report(
    rows: list[Row],
    counters: dict[str, int],
    input_lines: int,
    elapsed: float,
    max_price: float | None = None,
    deduped_rows: int = 0,
    sort_mode: str | None = None,
) -> dict[str, Any]:
    """Assemble the full report payload.

    Shape: see the "JSON report" section in the project README.
    """
    matched_rows = [r for r in rows if r.card is not None]
    priced_rows = [r for r in matched_rows if r.pricing.market_or_override is not None]
    above_cap = _above_cap(rows, max_price)

    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version": __version__,
        "elapsed_seconds": round(elapsed, 2),
        "max_price": max_price,
        "summary": _summary_section(
            rows,
            matched_rows,
            priced_rows,
            counters,
            input_lines,
            deduped_rows,
            sort_mode,
            len(above_cap),
        ),
        "tags": _tags_section(rows),
        "highlights": _highlights_section(rows, priced_rows, above_cap),
        "rows": _rows_section(rows, max_price),
    }
