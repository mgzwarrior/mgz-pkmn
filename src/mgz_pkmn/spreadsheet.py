"""Render lookup results into a card-show spreadsheet."""

from __future__ import annotations

import io
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from . import branding
from .images import THUMB_H, THUMB_W, make_thumbnail
from .parser import CardQuery
from .pricing import COMP_PERCENTS, Pricing

HEADERS = [
    "Image",  # A
    "Source",  # B  — the input file's tag
    "Input",  # C
    "Name",  # D
    "Set",  # E
    "Series",  # F
    "Number",  # G
    "Rarity",  # H
    "Variant",  # I
    "Database",  # J
    "Market",  # K
    "80%",  # L
    "85%",  # M
    "90%",  # N
    "95%",  # O
    "Price Source",  # P
    "Listing URL",  # Q
]


@dataclass
class Row:
    query: CardQuery
    card: dict[str, Any] | None
    pricing: Pricing
    image_path: Path | None = None
    tag: str = ""  # input-file stem so rows stay grouped per source list


def _money_format(currency: str) -> str:
    if currency == "EUR":
        return '"€"#,##0.00'
    if currency == "GBP":
        return '"£"#,##0.00'
    return '"$"#,##0.00'


def write_spreadsheet(rows: list[Row], out_path: Path, max_price: float | None = None) -> None:
    wb = Workbook()
    _apply_workbook_branding(wb, out_path)
    ws = wb.active
    ws.title = "Cards"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="2C3E50")
    over_cap_fill = PatternFill("solid", fgColor="FFE9A8")  # soft amber for above-cap rows

    ws.append(HEADERS)
    for col_idx, _ in enumerate(HEADERS, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    widths = {
        "A": 16,  # Image
        "B": 14,  # Source (tag)
        "C": 28,  # Input
        "D": 24,  # Name
        "E": 22,  # Set
        "F": 18,  # Series
        "G": 10,  # Number
        "H": 14,  # Rarity
        "I": 16,  # Variant
        "J": 18,  # Database
        "K": 12,  # Market
        "L": 10,
        "M": 10,
        "N": 10,
        "O": 10,
        "P": 14,  # Price Source
        "Q": 38,  # Listing URL
    }
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    ws.row_dimensions[1].height = 22

    for i, row in enumerate(rows, start=2):
        ws.row_dimensions[i].height = THUMB_H * 0.78  # excel "points", approx px*0.75

        card = row.card or {}
        card_set = card.get("set") or {}
        market = row.pricing.market
        money_fmt = _money_format(row.pricing.currency)

        ws.cell(row=i, column=2, value=row.tag)
        ws.cell(row=i, column=3, value=row.query.raw)
        ws.cell(row=i, column=4, value=card.get("name") or "(not found)")
        ws.cell(row=i, column=5, value=card_set.get("name"))
        ws.cell(row=i, column=6, value=card_set.get("series"))
        ws.cell(row=i, column=7, value=card.get("number"))
        ws.cell(row=i, column=8, value=card.get("rarity"))
        ws.cell(row=i, column=9, value=row.pricing.variant)
        ws.cell(row=i, column=10, value=card.get("_database") or "")

        is_over_cap = max_price is not None and market is not None and market > max_price

        if market is not None:
            market_cell = ws.cell(row=i, column=11, value=market)
            market_cell.number_format = money_fmt
            if is_over_cap:
                market_cell.fill = over_cap_fill
                market_cell.font = Font(bold=True, color="8A4B00")
            for offset, pct in enumerate(COMP_PERCENTS):
                cell = ws.cell(row=i, column=12 + offset, value=round(market * pct / 100, 2))
                cell.number_format = money_fmt
                if is_over_cap:
                    cell.fill = over_cap_fill
        else:
            ws.cell(row=i, column=11, value="—")

        ws.cell(row=i, column=16, value=row.pricing.source or "")
        if row.pricing.url:
            link_cell = ws.cell(row=i, column=17, value=row.pricing.url)
            link_cell.hyperlink = row.pricing.url
            link_cell.font = Font(color="1F4E78", underline="single")

        if row.image_path and row.image_path.exists():
            try:
                thumb_bytes = make_thumbnail(row.image_path, (THUMB_W, THUMB_H))
                xl_img = XLImage(io.BytesIO(thumb_bytes))
                xl_img.width = THUMB_W
                xl_img.height = THUMB_H
                anchor_cell = f"A{i}"
                ws.add_image(xl_img, anchor_cell)
                ws.column_dimensions["A"].width = max(
                    ws.column_dimensions["A"].width or 16, THUMB_W / 7
                )
                ws.row_dimensions[i].height = THUMB_H * 0.78
            except Exception as exc:
                print(f"  ! thumbnail embed failed for {row.query}: {exc}", file=sys.stderr)

    ws.freeze_panes = "C2"

    # Summary footer. Note: SUM aggregates all rows regardless of currency, so
    # mixed-currency runs will produce an arithmetic-but-not-meaningful total.
    last = len(rows) + 2
    ws.cell(row=last + 1, column=10, value="Totals:").font = Font(bold=True)
    for offset, _pct in enumerate([100, *COMP_PERCENTS]):
        col = 11 + offset
        col_letter = get_column_letter(col)
        formula = f"=SUM({col_letter}2:{col_letter}{last - 1})"
        cell = ws.cell(row=last + 1, column=col, value=formula)
        cell.number_format = '"$"#,##0.00'
        cell.font = Font(bold=True)

    # Branding mark in the totals row — clickable link back to the project
    # site so a recipient can trace where the file came from.
    brand_cell = ws.cell(row=last + 1, column=2, value=branding.PROJECT_NAME)
    brand_cell.hyperlink = branding.PROJECT_URL
    brand_cell.font = Font(bold=True, color="1F4E78", underline="single")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)


def _apply_workbook_branding(wb: Workbook, out_path: Path) -> None:
    """Stamp workbook properties + drop the logo into the top-left.

    Workbook properties land in the "Get Info" / "Properties" view of
    Excel and the OS so a recipient can see at a glance where the file
    came from. The logo image is anchored to A1 sized to fit inside the
    header row's existing height — no layout impact on the data rows."""
    props = wb.properties
    props.creator = branding.PROJECT_AUTHOR
    props.lastModifiedBy = branding.PROJECT_AUTHOR
    props.title = out_path.stem
    props.subject = f"Generated by {branding.PROJECT_NAME}"
    props.description = f"{branding.PROJECT_NAME} — {branding.PROJECT_URL}"
    props.keywords = "pokemon, tcg, card-collection, mgz-pkmn"

    ws = wb.active
    try:
        logo = XLImage(str(branding.logo_path()))
        # Header row is 22 pt ≈ 29 px; scale the wordmark to ~24 px tall so it
        # sits flush inside the row without crowding the "Image" header.
        target_h = 24
        logo.height = target_h
        logo.width = int(target_h * branding.LOGO_ASPECT)
        ws.add_image(logo, "A1")
    except Exception:
        return
