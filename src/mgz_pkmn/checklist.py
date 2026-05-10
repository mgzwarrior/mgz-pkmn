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


def write_checklist_pdf(rows: list[Row], out_path: Path) -> int:
    """Render `rows` as a per-tag checklist PDF.

    Returns the number of sections written. Sections with zero matched cards
    are skipped, and if every tag is empty no file is created."""
    sections = _build_sections(rows)
    if not sections:
        return 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(out_path), pagesize=letter)
    c.setTitle(out_path.stem)
    for i, section in enumerate(sections):
        if i > 0:
            c.showPage()
        _draw_section(c, section)
    c.save()
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


def _draw_section(c: canvas.Canvas, section: dict[str, Any]) -> None:
    """Render one tag's checklist across as many pages as it needs."""
    matched = section["rows"]
    total = len(matched)

    col_w = (PAGE_W - 2 * MARGIN - COL_GUTTER * (COLUMNS - 1)) / COLUMNS
    grid_top_y = PAGE_H - MARGIN - HEADER_BAND_H - HEADER_GAP
    rows_per_col = max(1, int((grid_top_y - MARGIN) // ROW_HEIGHT))
    cards_per_page = rows_per_col * COLUMNS

    for page_idx, chunk_start in enumerate(range(0, total, cards_per_page), start=1):
        if chunk_start > 0:
            c.showPage()
        _draw_header(c, tag=section["tag"], total=total, page_idx=page_idx)
        chunk = matched[chunk_start : chunk_start + cards_per_page]
        for j, row in enumerate(chunk):
            col = j // rows_per_col
            row_in_col = j % rows_per_col
            x = MARGIN + col * (col_w + COL_GUTTER)
            y = grid_top_y - row_in_col * ROW_HEIGHT - ROW_HEIGHT
            _draw_row(c, x, y, col_w, row.card or {}, row.pricing)


def _draw_header(c: canvas.Canvas, *, tag: str, total: int, page_idx: int) -> None:
    c.saveState()
    band_y = PAGE_H - MARGIN - HEADER_BAND_H
    c.setFillColorRGB(0.16, 0.21, 0.30)
    c.rect(MARGIN, band_y, PAGE_W - 2 * MARGIN, HEADER_BAND_H, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(MARGIN + 8, band_y + 16, tag or "(untagged)")
    c.setFont("Helvetica", 9)
    c.drawString(MARGIN + 8, band_y + 4, "Checklist")
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
) -> None:
    cb_x = x + 2
    cb_y = y + 2
    c.saveState()
    c.setStrokeColorRGB(0.3, 0.3, 0.3)
    c.setLineWidth(0.6)
    c.setFillColorRGB(1, 1, 1)
    c.rect(cb_x, cb_y, CHECKBOX_SIZE, CHECKBOX_SIZE, stroke=1, fill=1)
    c.restoreState()

    text_x = cb_x + CHECKBOX_SIZE + 4
    set_obj = card.get("set") or {}
    total_printed = set_obj.get("printedTotal") or set_obj.get("total")
    num = card.get("number") or "?"
    num_str = f"#{num}/{total_printed}" if total_printed else f"#{num}"
    mp_str = _format_mp(pricing)

    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.setFont("Helvetica", 8)
    c.drawString(text_x, y + 3, num_str)
    num_w = c.stringWidth(num_str, "Helvetica", 8)
    name_x = text_x + max(num_w + 6, 38)

    mp_w = c.stringWidth(mp_str, "Helvetica-Bold", 8) + 4 if mp_str else 0
    name_max_w = (x + col_w - 4) - name_x - mp_w
    name = _truncate_to_width(c, card.get("name") or "?", "Helvetica", 8, name_max_w)
    c.drawString(name_x, y + 3, name)

    if mp_str:
        c.setFont("Helvetica-Bold", 8)
        c.setFillColorRGB(0.05, 0.35, 0.15)
        c.drawRightString(x + col_w - 4, y + 3, mp_str)


def _format_mp(pricing: Pricing) -> str:
    if pricing.market is None:
        return ""
    sym = "€" if pricing.currency == "EUR" else "$"
    return f"{sym}{pricing.market:,.2f}"


def _truncate_to_width(c: canvas.Canvas, text: str, font: str, size: int, max_w: float) -> str:
    if max_w <= 0:
        return ""
    while c.stringWidth(text, font, size) > max_w and len(text) > 3:
        text = text[:-2] + "…"
    return text
