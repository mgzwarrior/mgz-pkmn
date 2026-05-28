#!/usr/bin/env python3
"""Render a faithful spreadsheet-style preview for the OutputGallery section.

Why this exists
---------------
LibreOffice's headless `convert-to pdf` route can't render the embedded /
referenced card thumbnails in `output/cards.xlsx` — the resulting PDF has
empty image columns and clipped headers, which doesn't communicate what
the spreadsheet looks like in practice. Rather than fight that, render
directly from the structured `output/summary.json` (same data the xlsx
writer uses) and the on-disk thumbnails in `output/images/`.

Output: site/public/screenshots/cards-xlsx.webp — a styled PNG that
mirrors the workbook's per-tag section layout: header band, ~8 data
rows with thumbnails, name, set, number, market price, comps.

Driven by `site/scripts/refresh-screenshots.sh`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("missing dependency: Pillow (already in mgz-pkmn's uv env)")

REPO_ROOT = Path(__file__).resolve().parents[2]
SUMMARY = REPO_ROOT / "output" / "summary.json"
IMAGES_DIR = REPO_ROOT / "output" / "images"
OUT_PATH = REPO_ROOT / "site" / "public" / "screenshots" / "cards-xlsx.webp"

ROW_COUNT = 8
ROW_HEIGHT = 110
HEADER_HEIGHT = 64
TAG_BAND_HEIGHT = 44
COL_PAD = 18
CANVAS_WIDTH = 1600

# Columns rendered in the preview. The full xlsx has 17; the preview
# keeps the operationally-important ones so the gallery card reads as
# "this is the spreadsheet" at a glance.
COLUMNS = [
    ("image", 130),
    ("Name", 320),
    ("Set", 220),
    ("№", 90),
    ("Rarity", 200),
    ("Market", 130),
    ("80%", 110),
    ("90%", 110),
]

# Dark-mode palette tuned to feel close to the workbook header's slate
# tone but with enough contrast to read on a marketing card.
BG = (15, 17, 21)
HEADER_BG = (43, 56, 76)
HEADER_TEXT = (245, 247, 251)
TAG_BG = (28, 32, 39)
TAG_TEXT = (165, 173, 188)
ROW_ALT = (22, 25, 31)
TEXT = (228, 231, 237)
TEXT_MUTED = (148, 156, 169)
ACCENT = (96, 165, 250)
PRICE = (74, 222, 128)


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNS.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size, index=1 if bold else 0)
    return ImageFont.load_default(size=size)


def thumbnail_for(row: dict[str, Any]) -> Path | None:
    """Derive `<set-id>-<number>.png` from the row's pricing URL.

    The xlsx writer uses URLs like
    `https://prices.pokemontcg.io/tcgplayer/ex15-100` whose tail matches
    the local thumbnail filename. Falls back to None if the URL doesn't
    fit that shape — the caller renders a neutral placeholder."""
    url = row.get("url") or ""
    if not url:
        return None
    tail = url.rstrip("/").rsplit("/", 1)[-1]
    candidate = IMAGES_DIR / f"{tail}.png"
    return candidate if candidate.exists() else None


def truncate(draw: ImageDraw.ImageDraw, text: str, fnt, max_width: int) -> str:
    if not text:
        return ""
    if draw.textlength(text, font=fnt) <= max_width:
        return text
    ellipsis = "…"
    while text and draw.textlength(text + ellipsis, font=fnt) > max_width:
        text = text[:-1]
    return text + ellipsis


def format_currency(value: Any) -> str:
    if value is None:
        return ""
    try:
        return f"${float(value):,.2f}"
    except (TypeError, ValueError):
        return str(value)


def main() -> None:
    if not SUMMARY.exists():
        sys.exit(f"summary.json not found: {SUMMARY}")
    data = json.loads(SUMMARY.read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = data.get("rows", [])[:ROW_COUNT]
    if not rows:
        sys.exit("no rows in summary.json")

    # Group the visible rows by tag so the preview mirrors the workbook's
    # per-tag section layout (header band + matching rows underneath).
    tag = rows[0].get("tag", "")
    canvas_height = HEADER_HEIGHT + TAG_BAND_HEIGHT + ROW_HEIGHT * len(rows) + 24
    img = Image.new("RGB", (CANVAS_WIDTH, canvas_height), BG)
    draw = ImageDraw.Draw(img)

    fnt_header = font(22, bold=True)
    fnt_tag = font(18, bold=True)
    fnt_body = font(22)
    fnt_body_bold = font(22, bold=True)
    fnt_small = font(18)

    # Header row
    draw.rectangle((0, 0, CANVAS_WIDTH, HEADER_HEIGHT), fill=HEADER_BG)
    x = COL_PAD
    for label, width in COLUMNS:
        if label != "image":
            draw.text(
                (x, HEADER_HEIGHT // 2 - 12),
                label,
                fill=HEADER_TEXT,
                font=fnt_header,
            )
        x += width

    # Tag band
    y = HEADER_HEIGHT
    draw.rectangle((0, y, CANVAS_WIDTH, y + TAG_BAND_HEIGHT), fill=TAG_BG)
    draw.text(
        (COL_PAD, y + 10),
        f"▸ {tag}",
        fill=TAG_TEXT,
        font=fnt_tag,
    )
    y += TAG_BAND_HEIGHT

    # Data rows
    for idx, row in enumerate(rows):
        if idx % 2 == 1:
            draw.rectangle((0, y, CANVAS_WIDTH, y + ROW_HEIGHT), fill=ROW_ALT)

        x = COL_PAD
        # Thumbnail
        thumb_path = thumbnail_for(row)
        if thumb_path:
            try:
                thumb = Image.open(thumb_path).convert("RGBA")
                # Scale to fit row height with margin
                target_h = ROW_HEIGHT - 16
                ratio = target_h / thumb.height
                thumb = thumb.resize((int(thumb.width * ratio), target_h), Image.LANCZOS)
                img.paste(thumb, (x, y + 8), thumb)
            except Exception:
                pass
        x += COLUMNS[0][1]

        # Name (bold)
        name = truncate(draw, row.get("name", ""), fnt_body_bold, COLUMNS[1][1] - 16)
        draw.text((x, y + ROW_HEIGHT // 2 - 12), name, fill=TEXT, font=fnt_body_bold)
        x += COLUMNS[1][1]

        # Set
        set_name = truncate(draw, row.get("set", ""), fnt_body, COLUMNS[2][1] - 16)
        draw.text((x, y + ROW_HEIGHT // 2 - 12), set_name, fill=TEXT_MUTED, font=fnt_body)
        x += COLUMNS[2][1]

        # Number
        draw.text(
            (x, y + ROW_HEIGHT // 2 - 12), row.get("number", ""), fill=TEXT_MUTED, font=fnt_body
        )
        x += COLUMNS[3][1]

        # Rarity
        rarity = truncate(draw, row.get("rarity", "") or "", fnt_small, COLUMNS[4][1] - 16)
        draw.text((x, y + ROW_HEIGHT // 2 - 10), rarity, fill=TEXT_MUTED, font=fnt_small)
        x += COLUMNS[4][1]

        # Market (highlighted)
        draw.text(
            (x, y + ROW_HEIGHT // 2 - 12),
            format_currency(row.get("market")),
            fill=PRICE,
            font=fnt_body_bold,
        )
        x += COLUMNS[5][1]

        # Comps
        comps = row.get("comps") or {}
        draw.text(
            (x, y + ROW_HEIGHT // 2 - 12),
            format_currency(comps.get("80%")),
            fill=ACCENT,
            font=fnt_body,
        )
        x += COLUMNS[6][1]
        draw.text(
            (x, y + ROW_HEIGHT // 2 - 12),
            format_currency(comps.get("90%")),
            fill=ACCENT,
            font=fnt_body,
        )

        y += ROW_HEIGHT

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Write WebP at marketing quality. PIL's WebP encoder defaults to
    # quality=80, which matches the rest of the gallery's pipeline.
    img.save(OUT_PATH, format="WEBP", quality=82, method=6)
    print(f"✓ wrote {OUT_PATH.relative_to(REPO_ROOT)} ({OUT_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
