"""Render a printable checklist PDF for the front of the binder.

For each input file (tag), every matched card lookup returned is listed in a
3-column layout with an empty checkbox — meant to be checked off by hand as
you acquire / verify cards at the show. Row order is whatever the CLI's
`--sort` produced upstream; this module does no re-sorting.
"""

from __future__ import annotations

from itertools import groupby
from pathlib import Path
from typing import Any

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

from . import branding, palette
from .export_fields import CHECKLIST_FIELDS
from .pricing import Pricing
from .spreadsheet import Row

PAGE_W, PAGE_H = letter  # 612 x 792 pt
MARGIN = 0.5 * inch
HEADER_BAND_H = 32
HEADER_GAP = 8
COLUMNS = 3
COL_GUTTER = 0.18 * inch
ROW_HEIGHT = 13
CHECKBOX_SIZE = 8


def write_checklist_pdf(
    rows: list[Row], out_path: Path, fields: frozenset[str] | None = None
) -> int:
    """Render `rows` as a per-tag checklist PDF.

    Returns the number of sections written. Sections with zero matched cards
    are skipped, and if every tag is empty no file is created. `fields`
    restricts which of name/set/number/rarity/market render per row (#262)
    — `None` (the CLI default) renders everything, matching pre-#262
    behavior."""
    active = CHECKLIST_FIELDS if fields is None else fields
    sections = _build_sections(rows)
    if not sections:
        return 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(out_path), pagesize=letter)
    branding.apply_pdf_metadata(c, out_path.stem)
    tracker = branding.PageTracker(c, letter)
    for i, section in enumerate(sections):
        if i > 0:
            tracker.show_page()
        _draw_section(c, section, tracker, active)
    tracker.finish()
    return len(sections)


def _build_sections(rows: list[Row]) -> list[dict[str, Any]]:
    """One section per tag, in first-appearance order. Only matched rows
    appear — unmatched lines have no card data to render meaningfully.

    Order within a section is the order rows arrive in (set by the CLI's
    `--sort` choice); we don't re-sort here."""
    sections: list[dict[str, Any]] = []
    for tag, group in groupby(rows, key=lambda r: r.tag or ""):
        matched = [r for r in group if r.card]
        if not matched:
            continue
        sections.append({"tag": tag, "rows": matched})
    return sections


def _draw_section(
    c: canvas.Canvas, section: dict[str, Any], tracker: branding.PageTracker, fields: frozenset[str]
) -> None:
    """Render one tag's checklist across as many pages as it needs."""
    matched = section["rows"]
    total = len(matched)

    col_w = (PAGE_W - 2 * MARGIN - COL_GUTTER * (COLUMNS - 1)) / COLUMNS
    grid_top_y = PAGE_H - MARGIN - HEADER_BAND_H - HEADER_GAP
    rows_per_col = max(1, int((grid_top_y - MARGIN) // ROW_HEIGHT))
    cards_per_page = rows_per_col * COLUMNS

    for page_idx, chunk_start in enumerate(range(0, total, cards_per_page), start=1):
        if chunk_start > 0:
            tracker.show_page()
        _draw_header(c, tag=section["tag"], total=total, page_idx=page_idx)
        chunk = matched[chunk_start : chunk_start + cards_per_page]
        for j, row in enumerate(chunk):
            col = j // rows_per_col
            row_in_col = j % rows_per_col
            x = MARGIN + col * (col_w + COL_GUTTER)
            y = grid_top_y - row_in_col * ROW_HEIGHT - ROW_HEIGHT
            _draw_row(c, x, y, col_w, row.card or {}, row.pricing, fields)


def _draw_header(c: canvas.Canvas, *, tag: str, total: int, page_idx: int) -> None:
    c.saveState()
    band_y = PAGE_H - MARGIN - HEADER_BAND_H
    c.setFillColorRGB(*branding.HEADER_PANEL_RGB)
    c.rect(MARGIN, band_y, PAGE_W - 2 * MARGIN, HEADER_BAND_H, fill=1, stroke=0)

    logo_h = HEADER_BAND_H * 0.55
    logo_y = band_y + (HEADER_BAND_H - logo_h) / 2
    logo_x = MARGIN + 6
    branding.draw_pdf_logo(c, logo_x, logo_y, logo_h)
    text_x = logo_x + logo_h * branding.LOGO_ASPECT + 10

    c.setFillColorRGB(*palette.rgb01("fg-on-dark"))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(text_x, band_y + 16, tag or "(untagged)")
    c.setFont("Helvetica", 9)
    c.drawString(text_x, band_y + 4, "Checklist")
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(PAGE_W - MARGIN - 8, band_y + 16, f"{total} cards")
    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - MARGIN - 8, band_y + 4, f"p.{page_idx}")
    c.restoreState()


def _draw_row(
    c: canvas.Canvas,
    x: float,
    y: float,
    col_w: float,
    card: dict[str, Any],
    pricing: Pricing,
    fields: frozenset[str],
) -> None:
    cb_x = x + 2
    cb_y = y + 2
    c.saveState()
    c.setStrokeColorRGB(*palette.rgb01("border-strong"))
    c.setLineWidth(0.6)
    c.setFillColorRGB(*palette.rgb01("bg-surface"))
    c.rect(cb_x, cb_y, CHECKBOX_SIZE, CHECKBOX_SIZE, stroke=1, fill=1)
    c.restoreState()

    text_x = cb_x + CHECKBOX_SIZE + 4
    mp_str = _format_mp(pricing) if "market" in fields else ""

    if "number" in fields:
        set_obj = card.get("set") or {}
        total_printed = set_obj.get("printedTotal") or set_obj.get("total")
        num = card.get("number") or "?"
        num_str = f"#{num}/{total_printed}" if total_printed else f"#{num}"
        c.setFillColorRGB(*palette.rgb01("fg-1"))
        c.setFont("Helvetica", 8)
        c.drawString(text_x, y + 3, num_str)
        num_w = c.stringWidth(num_str, "Helvetica", 8)
        name_x = text_x + max(num_w + 6, 38)
    else:
        name_x = text_x

    mp_w = c.stringWidth(mp_str, "Helvetica-Bold", 8) + 4 if mp_str else 0
    name_max_w = (x + col_w - 4) - name_x - mp_w
    label = _row_label(card, fields)
    name = _truncate_to_width(c, label, "Helvetica", 8, name_max_w)
    c.setFillColorRGB(*palette.rgb01("fg-1"))
    c.setFont("Helvetica", 8)
    c.drawString(name_x, y + 3, name)

    if mp_str:
        c.setFont("Helvetica-Bold", 8)
        c.setFillColorRGB(*palette.rgb01("success-fg"))
        c.drawRightString(x + col_w - 4, y + 3, mp_str)


def _row_label(card: dict[str, Any], fields: frozenset[str]) -> str:
    """Build the name cell's text: name, plus optional " · Rarity" and
    " · Set" segments when those fields are enabled. Truncation (by the
    caller) always keeps the name itself over trailing segments, since
    `_truncate_to_width` shortens from the end of the string."""
    parts = [card.get("name") or "?"] if "name" in fields else []
    if "rarity" in fields and card.get("rarity"):
        parts.append(card["rarity"])
    if "set" in fields:
        set_name = (card.get("set") or {}).get("name")
        if set_name:
            parts.append(set_name)
    return " · ".join(parts)


def _format_mp(pricing: Pricing) -> str:
    market = pricing.effective_market
    if market is None:
        return ""
    sym = "€" if pricing.currency == "EUR" else "$"
    prefix = (
        f"{pricing.condition} " if pricing.condition and pricing.adjusted_market is not None else ""
    )
    return f"{prefix}{sym}{market:,.2f}"


def _truncate_to_width(c: canvas.Canvas, text: str, font: str, size: int, max_w: float) -> str:
    if max_w <= 0:
        return ""
    while c.stringWidth(text, font, size) > max_w and len(text) > 3:
        text = text[:-2] + "…"
    return text
