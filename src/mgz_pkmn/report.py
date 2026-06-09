"""Report generation module for mgz-pkmn."""

import json
from typing import Any, Dict, List, Optional

from mgz_pkmn.models import CardRow, RunCounters


def _build_price_info(rows: List[CardRow]) -> Dict[str, Any]:
    """Build the max price information from rows."""
    max_price = 0.0
    max_price_card = None
    for row in rows:
        if row.price and row.price > max_price:
            max_price = row.price
            max_price_card = row.name
    return {
        "max_price": max_price,
        "max_price_card": max_price_card,
    }


def _deduplicate_and_sort_rows(
    rows: List[CardRow], dedupe_key: Optional[str], sort_key: Optional[str]
) -> List[CardRow]:
    """Deduplicate and sort rows based on provided keys."""
    if dedupe_key:
        seen = set()
        deduped = []
        for row in rows:
            key = getattr(row, dedupe_key, None)
            if key not in seen:
                seen.add(key)
                deduped.append(row)
        rows = deduped

    if sort_key:
        rows = sorted(rows, key=lambda r: getattr(r, sort_key, "") or "")

    return rows


def _build_summary_section(
    run_counters: RunCounters,
    total_rows: int,
    dedupe_key: Optional[str],
    sort_key: Optional[str],
) -> Dict[str, Any]:
    """Build the summary section of the report."""
    return {
        "total_cards": total_rows,
        "total_price": run_counters.total_price,
        "average_price": run_counters.average_price,
        "unique_sets": run_counters.unique_sets,
        "unique_types": run_counters.unique_types,
        "dedupe_key": dedupe_key,
        "sort_key": sort_key,
    }


def _build_counters_section(run_counters: RunCounters) -> Dict[str, int]:
    """Build the counters section with category counts."""
    return {
        "by_rarity": run_counters.by_rarity,
        "by_type": run_counters.by_type,
        "by_set": run_counters.by_set,
    }


def _build_queries_section(queries: List[str]) -> List[Dict[str, str]]:
    """Build the queries section from a list of query strings."""
    return [{"query": q} for q in queries]


def _build_warnings_section(warnings: List[str]) -> List[Dict[str, str]]:
    """Build the warnings section from a list of warning strings."""
    return [{"warning": w} for w in warnings]


def build_json_report(
    rows: List[CardRow],
    run_counters: RunCounters,
    queries: List[str],
    warnings: List[str],
    dedupe_key: Optional[str] = None,
    sort_key: Optional[str] = None,
) -> str:
    """Build a structured JSON report from rows and run context.

    Args:
        rows: List of CardRow objects to include in the report.
        run_counters: RunCounters object with aggregated statistics.
        queries: List of query strings used in the run.
        warnings: List of warning messages generated during the run.
        dedupe_key: Optional field name to deduplicate rows by.
        sort_key: Optional field name to sort rows by.

    Returns:
        A JSON string representing the complete report.
    """
    rows = _deduplicate_and_sort_rows(rows, dedupe_key, sort_key)

    report = {
        "summary": _build_summary_section(
            run_counters, len(rows), dedupe_key, sort_key
        ),
        "counters": _build_counters_section(run_counters),
        "price_info": _build_price_info(rows),
        "queries": _build_queries_section(queries),
        "warnings": _build_warnings_section(warnings),
        "cards": [row.to_dict() for row in rows],
    }

    return json.dumps(report, indent=2, default=str)