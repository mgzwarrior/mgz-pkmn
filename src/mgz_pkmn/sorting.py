"""Row ordering applied once before any output artifact is written.

Tag (input file) is always the outermost group — sort modes only change the
order WITHIN each tag's section so the binder, spreadsheet, and checklist
stay sectioned by source list. Within each tag, matched rows always precede
unmatched ones; the chosen mode determines order among matched rows.
"""

from __future__ import annotations

from typing import Any

from .spreadsheet import Row

SORT_MODES = (
    "number",  # default — group by set (first appearance), then card number asc
    "number-desc",
    "price-asc",
    "price-desc",
    "release-date",  # chronological by set release date, then number asc
    "alpha",  # by card name (case-insensitive)
)
DEFAULT_SORT = "number"


def sort_rows(rows: list[Row], mode: str) -> list[Row]:
    """Sort `rows` in place by `mode`. Returns the same list for convenience.

    Two-pass stable sort: the first pass orders rows by the chosen inner
    key; the second pass groups by tag (and matched-vs-unmatched), preserving
    the inner order within each bucket."""
    if mode not in SORT_MODES:
        raise ValueError(f"unknown sort mode: {mode!r}")

    tag_order: list[str] = []
    for r in rows:
        if r.tag not in tag_order:
            tag_order.append(r.tag)
    tag_rank = {t: i for i, t in enumerate(tag_order)}

    set_first_seen: dict[tuple[str, str], int] = {}
    for r in rows:
        key = (r.tag, _set_name(r))
        if key not in set_first_seen:
            set_first_seen[key] = len(set_first_seen)

    if mode == "number":
        rows.sort(
            key=lambda r: (
                set_first_seen[(r.tag, _set_name(r))],
                _number_key(r.card),
            )
        )
    elif mode == "number-desc":
        rows.sort(
            key=lambda r: (
                set_first_seen[(r.tag, _set_name(r))],
                _number_key(r.card),
            ),
            reverse=True,
        )
    elif mode == "price-asc":
        rows.sort(
            key=lambda r: (
                r.pricing.market_or_override is None,
                r.pricing.market_or_override or 0.0,
            )
        )
    elif mode == "price-desc":
        rows.sort(
            key=lambda r: (
                r.pricing.market_or_override is None,
                -(r.pricing.market_or_override or 0.0),
            )
        )
    elif mode == "release-date":
        rows.sort(
            key=lambda r: (
                _release_date(r) or "9999",
                _number_key(r.card),
            )
        )
    elif mode == "alpha":
        rows.sort(
            key=lambda r: (
                ((r.card or {}).get("name") or "").lower(),
                _number_key(r.card),
            )
        )

    rows.sort(
        key=lambda r: (
            tag_rank.get(r.tag, len(tag_rank)),
            0 if r.card else 1,
        )
    )
    return rows


def _set_name(r: Row) -> str:
    return ((r.card or {}).get("set") or {}).get("name") or ""


def _release_date(r: Row) -> str:
    return ((r.card or {}).get("set") or {}).get("releaseDate") or ""


def _number_key(card: dict[str, Any] | None) -> tuple[int, int, str]:
    """Numeric card numbers sort numerically; alphanumerics ('SWSH286',
    'TG01') sort lexically AFTER the integers. Reversed cleanly via
    `reverse=True` on the whole tuple — both halves flip together."""
    if not card:
        return (1, 0, "")
    num = (card.get("number") or "").strip()
    try:
        return (0, int(num), "")
    except ValueError:
        return (1, 0, num)
