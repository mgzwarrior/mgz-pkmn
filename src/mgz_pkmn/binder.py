"""Render lookup results into a 3x3 PDF binder layout for vendors to scan."""

from __future__ import annotations

import io
from itertools import groupby
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .parser import (
    _CJK_IDEOGRAPH_RE,
    _HANGUL_RE,
    _HIRAGANA_KATAKANA_RE,
)
from .pricing import COMP_PERCENTS
from .spreadsheet import Row

# Target horizontal pixel resolution per card image. ~200 dpi at the cell
# width — sharp on screen and binder-print-ready while keeping PDFs small.
PDF_IMAGE_TARGET_W_PX = 400
PDF_IMAGE_QUALITY = 85

# Layout constants. US Letter portrait, 3x3 grid.
PAGE_W, PAGE_H = letter  # 612 x 792 pt
MARGIN = 0.35 * inch
HEADER_BAND_H = 22  # height of the per-section "tag" banner (pt)
COLS = 3
ROWS_PER_PAGE = 3
CARDS_PER_PAGE = COLS * ROWS_PER_PAGE
GUTTER = 6  # pt between cells

# Card image aspect ratio (width/height) — the standard Pokemon TCG ratio.
CARD_ASPECT = 2.5 / 3.5

# Uniform shrink applied to the image after geometry is computed. < 1.0 leaves
# breathing room around each card so the cell looks less cramped and the
# caption block reads more comfortably.
IMAGE_SCALE = 0.71

# Caption lines (top-down, under each image):
#   1. Name (bold)
#   2. (#X/Y)            — card number / set printed total
#   3. Set name
#   4. MP $market        — slightly emphasized; "MP" tag so the figure is unambiguous
#   5. 80% $A
#   6. 85% $B
#   7. 90% $C
#   8. 95% $D
CAPTION_LINES = 8
CAPTION_LEADING = 11.5  # pt — extra breathing room between caption lines

# Per-cell language banner. Drawn ABOVE the card image (full image width) for
# non-English cards so vendors spot them at a glance. Reserved space is
# applied to every cell — English cards just leave the area blank — so the
# 3x3 grid stays aligned regardless of which cells carry a banner.
LANG_BANNER_H = 14
LANG_BANNER_GAP = 4

# Map TCGdex language codes to the user-facing label printed on the banner.
# Falls back to the code itself uppercased ("PT-BR") when not listed here.
LANG_LABELS: dict[str, str] = {
    "ja": "Japanese",
    "ko": "Korean",
    "zh-cn": "Chinese",
    "zh-tw": "Chinese",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "pt-br": "Portuguese",
    "th": "Thai",
    "id": "Indonesian",
    "pl": "Polish",
    "nl": "Dutch",
}

# CJK fonts are registered lazily the first time we render a binder PDF —
# ReportLab ships them as built-in metadata (no font file shipped) and the
# PDF reader handles glyph substitution. Without this, names like
# `ナッシー[Exeggutor]` render as tofu blocks under Helvetica.
_CJK_FONTS: dict[str, str] = {}


def _ensure_cjk_fonts() -> dict[str, str]:
    """Register ReportLab's built-in CID Asian fonts on first use.

    Returns a `script → font name` map. Best-effort: if registration fails
    (older ReportLab, missing optional pieces), we silently fall back to
    Helvetica for that script — broken glyphs are no worse than the
    pre-CJK status quo, and the rest of the PDF still renders."""
    if _CJK_FONTS:
        return _CJK_FONTS
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont

        for face, slot in (
            ("HeiseiKakuGo-W5", "ja"),  # Japanese gothic — pairs with Helvetica
            ("STSong-Light", "zh"),  # Chinese simplified
            ("HYSMyeongJo-Medium", "ko"),  # Korean serif
        ):
            try:
                pdfmetrics.registerFont(UnicodeCIDFont(face))
                _CJK_FONTS[slot] = face
            except Exception:
                continue
    except ImportError:
        pass
    return _CJK_FONTS


def _font_for_name(name: str | None, language: str | None, *, bold: bool) -> str:
    """Pick a font that can render `name`. Falls back to Helvetica.

    The script of the actual name is the strongest signal — the language tag
    can be wrong (e.g. an EN-tagged card carrying a Japanese name) but the
    glyphs don't lie. If no CJK script appears in the name we use Helvetica
    (bold or regular per the caller). CID Asian fonts ship in a single
    weight; bold falls back to regular for those — readable but unstyled."""
    bold_helv = "Helvetica-Bold" if bold else "Helvetica"
    if not name:
        return bold_helv
    if _HIRAGANA_KATAKANA_RE.search(name):
        return _CJK_FONTS.get("ja", bold_helv)
    if _HANGUL_RE.search(name):
        return _CJK_FONTS.get("ko", bold_helv)
    if _CJK_IDEOGRAPH_RE.search(name):
        return _CJK_FONTS.get("zh", bold_helv)
    lang = (language or "").lower()
    if lang.startswith("ja"):
        return _CJK_FONTS.get("ja", bold_helv)
    if lang.startswith("ko"):
        return _CJK_FONTS.get("ko", bold_helv)
    if lang.startswith("zh"):
        return _CJK_FONTS.get("zh", bold_helv)
    return bold_helv


def write_binder_pdf(
    rows: list[Row],
    out_path: Path,
    title: str | None = None,
    max_price: float | None = None,
) -> None:
    """Render `rows` into a 9-pocket-style binder PDF.

    Rows are grouped by `Row.tag` (the originating input file) so that each
    list shows up as its own section with a header banner and starts on a
    fresh page. Each card cell shows: image, bold name, "(#num/total)", set
    name, market price (labelled "MP"), and one comp tier per line at
    80/85/90/95%."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_cjk_fonts()
    c = canvas.Canvas(str(out_path), pagesize=letter)
    c.setTitle(title or out_path.stem)

    layout = _layout()

    # Group rows by tag, preserving the order they came in. Each group prints
    # on its own set of pages, prefixed by a one-line section banner.
    sections = [(tag, list(group)) for tag, group in groupby(rows, key=lambda r: r.tag or "")]

    is_first_section = True
    for tag, section_rows in sections:
        if not is_first_section:
            c.showPage()
        is_first_section = False
        _draw_section(c, tag, section_rows, layout, max_price=max_price)

    c.save()


def _layout() -> dict:
    """Compute the cell + image geometry once per PDF render."""
    usable_w = PAGE_W - 2 * MARGIN
    grid_top_y = PAGE_H - MARGIN - HEADER_BAND_H  # cards sit below the section banner
    usable_h = grid_top_y - MARGIN
    cell_w = (usable_w - GUTTER * (COLS - 1)) / COLS
    cell_h = (usable_h - GUTTER * (ROWS_PER_PAGE - 1)) / ROWS_PER_PAGE
    # Reserve ~58 pt for the caption block (5 lines @ 10pt leading + padding)
    # plus the language banner area (banner + gap) above each image. Banner
    # space is reserved for every cell — English cells leave it blank — so
    # the 3x3 grid stays aligned regardless of which cards are non-English.
    caption_h = CAPTION_LEADING * CAPTION_LINES + 8
    banner_reserve = LANG_BANNER_H + LANG_BANNER_GAP
    image_h = cell_h - caption_h - banner_reserve
    image_w = image_h * CARD_ASPECT
    if image_w > cell_w * 0.92:
        image_w = cell_w * 0.92
        image_h = image_w / CARD_ASPECT
    image_w *= IMAGE_SCALE
    image_h *= IMAGE_SCALE
    return {
        "cell_w": cell_w,
        "cell_h": cell_h,
        "image_w": image_w,
        "image_h": image_h,
        "grid_top_y": grid_top_y,
    }


def _draw_section(
    c: canvas.Canvas,
    tag: str,
    rows: list[Row],
    layout: dict,
    max_price: float | None = None,
) -> None:
    """Render one tag's worth of cards across as many pages as needed."""
    for i, row in enumerate(rows):
        idx_on_page = i % CARDS_PER_PAGE
        if i > 0 and idx_on_page == 0:
            c.showPage()
        if idx_on_page == 0:
            _draw_section_header(c, tag, len(rows))

        col = idx_on_page % COLS
        rrow = idx_on_page // COLS
        cell_x = MARGIN + col * (layout["cell_w"] + GUTTER)
        cell_top_y = layout["grid_top_y"] - rrow * (layout["cell_h"] + GUTTER)
        cell_bottom_y = cell_top_y - layout["cell_h"]

        _draw_cell(
            c,
            row,
            cell_x,
            cell_bottom_y,
            layout["cell_w"],
            layout["cell_h"],
            layout["image_w"],
            layout["image_h"],
            max_price=max_price,
        )


def _draw_section_header(c: canvas.Canvas, tag: str, count: int) -> None:
    """Banner across the top of each page in a section: 'Source: <tag>  ·  N cards'."""
    c.saveState()
    band_y = PAGE_H - MARGIN - HEADER_BAND_H
    c.setFillColorRGB(0.16, 0.21, 0.30)  # dark slate
    c.rect(MARGIN, band_y, PAGE_W - 2 * MARGIN, HEADER_BAND_H, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 11)
    label = tag or "(untagged)"
    c.drawString(MARGIN + 8, band_y + 7, f"Source: {label}")
    c.setFont("Helvetica", 9)
    suffix = f"{count} card{'s' if count != 1 else ''}"
    c.drawRightString(PAGE_W - MARGIN - 8, band_y + 7, suffix)
    c.restoreState()


def _draw_cell(
    c: canvas.Canvas,
    row: Row,
    x: float,
    y: float,
    cell_w: float,
    cell_h: float,
    image_w: float,
    image_h: float,
    max_price: float | None = None,
) -> None:
    """Render one card cell. (x, y) is the bottom-left of the cell."""
    # Vertically center the (banner + image + caption) block in the cell. The
    # banner reserve mirrors `_layout()` so cells stay aligned regardless of
    # which ones carry a non-English banner.
    caption_h = CAPTION_LEADING * CAPTION_LINES + 8
    banner_reserve = LANG_BANNER_H + LANG_BANNER_GAP
    content_h = banner_reserve + image_h + caption_h
    top_padding = max(0, (cell_h - content_h) / 2)
    image_x = x + (cell_w - image_w) / 2
    banner_top_y = y + cell_h - top_padding
    image_top_y = banner_top_y - banner_reserve
    image_y = image_top_y - image_h  # bottom of image

    # Light cell border for visual separation (similar to a binder pocket).
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.setLineWidth(0.5)
    c.rect(x, y, cell_w, cell_h, stroke=1, fill=0)

    # Language banner — drawn above the card image, full-image-width, with
    # the human-readable language name. Non-English cards only.
    language = (row.card or {}).get("language") or "en"
    if language and language.lower() != "en":
        _draw_lang_banner(c, image_x, banner_top_y, image_w, language)

    if row.image_path and row.image_path.exists():
        try:
            buf = _shrink_for_pdf(row.image_path)
            c.drawImage(
                ImageReader(buf),
                image_x,
                image_y,
                image_w,
                image_h,
                preserveAspectRatio=True,
                mask="auto",
            )
        except Exception:
            _draw_placeholder(c, image_x, image_y, image_w, image_h, "image error")
    else:
        _draw_placeholder(
            c,
            image_x,
            image_y,
            image_w,
            image_h,
            "no image" if row.card else "(not found)",
        )

    # Caption block. Five lines: name (bold), (#X/Y), set, market, comps.
    card = row.card or {}
    name = card.get("name") or "(not found)"
    card_set = card.get("set") or {}
    set_name = card_set.get("name") or "?"
    number = card.get("number") or "?"
    total = card_set.get("printedTotal") or card_set.get("total")

    # One blank line of vertical space between image and the first caption
    # line, so the name doesn't visually crowd the card art.
    line_y = image_y - 6 - CAPTION_LEADING
    cx = x + cell_w / 2
    max_w = cell_w - 8

    # 1. Name (bold). Pick a CJK-capable font when the name has Japanese /
    # Korean / Chinese characters — otherwise Helvetica-Bold renders them as
    # tofu blocks (■■■■).
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.setFont(_font_for_name(name, language, bold=True), 10.5)
    line_y -= 2
    _draw_truncated(c, cx, line_y, name, max_w)

    # 2. (#X/Y) or just (#X) when total unknown
    line_y -= CAPTION_LEADING
    c.setFont("Helvetica", 9)
    parens = f"(#{number}/{total})" if total else f"(#{number})"
    _draw_truncated(c, cx, line_y, parens, max_w)

    # 3. Set name
    line_y -= CAPTION_LEADING
    c.setFont("Helvetica", 9)
    _draw_truncated(c, cx, line_y, set_name, max_w)

    # 4. Market price labelled "MP" (slightly emphasized). Over-cap rows get
    # a "!" prefix and a dark-red colour so the user can spot them at a glance.
    line_y -= CAPTION_LEADING + 1
    if row.pricing.market is not None:
        sym = "€" if row.pricing.currency == "EUR" else "$"
        is_over_cap = max_price is not None and row.pricing.market > max_price
        c.setFont("Helvetica-Bold", 10)
        if is_over_cap:
            c.setFillColorRGB(0.65, 0.10, 0.10)  # dark red for above-cap
            label = f"! MP {sym}{row.pricing.market:,.2f}"
        else:
            c.setFillColorRGB(0.05, 0.35, 0.15)  # dark green for in-budget
            label = f"MP {sym}{row.pricing.market:,.2f}"
        _draw_truncated(c, cx, line_y, label, max_w)
    else:
        c.setFont("Helvetica-Oblique", 9)
        c.setFillColorRGB(0.5, 0.5, 0.5)
        _draw_truncated(c, cx, line_y, "no price", max_w)

    # 5-8. Comp tiers, one per line for visibility.
    c.setFillColorRGB(0.35, 0.35, 0.35)
    c.setFont("Helvetica", 8)
    if row.pricing.market is not None:
        sym = "€" if row.pricing.currency == "EUR" else "$"
        for p in COMP_PERCENTS:
            line_y -= CAPTION_LEADING
            comp_value = round(row.pricing.market * p / 100, 2)
            _draw_truncated(c, cx, line_y, f"{p}% {sym}{comp_value:,.2f}", max_w)


def _shrink_for_pdf(src: Path) -> io.BytesIO:
    """Downsample to PDF_IMAGE_TARGET_W_PX wide and re-encode as JPEG to keep
    PDF file size sensible. Original images often exceed 1 MB each."""
    img = PILImage.open(src)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")
    if img.width > PDF_IMAGE_TARGET_W_PX:
        ratio = PDF_IMAGE_TARGET_W_PX / img.width
        new_size = (PDF_IMAGE_TARGET_W_PX, max(1, int(img.height * ratio)))
        img = img.resize(new_size, PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=PDF_IMAGE_QUALITY, optimize=True)
    buf.seek(0)
    return buf


def _draw_lang_banner(
    c: canvas.Canvas,
    image_x: float,
    banner_top_y: float,
    image_w: float,
    language: str,
) -> None:
    """Draw a full-image-width banner above the card image, labelled with
    the human-readable language name (e.g. 'JAPANESE'). Non-English cards
    only — English is the default and doesn't need calling out."""
    label = LANG_LABELS.get(language.lower(), language.upper().replace("-", " "))
    banner_x = image_x
    banner_w = image_w
    banner_y = banner_top_y - LANG_BANNER_H
    c.saveState()
    c.setFillColorRGB(0.65, 0.10, 0.10)
    c.setStrokeColorRGB(0.65, 0.10, 0.10)
    c.setLineWidth(0.5)
    c.rect(banner_x, banner_y, banner_w, LANG_BANNER_H, fill=1, stroke=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawCentredString(banner_x + banner_w / 2, banner_y + 4, label.upper())
    c.restoreState()


def _draw_placeholder(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str) -> None:
    c.saveState()
    c.setFillColorRGB(0.95, 0.95, 0.95)
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.rect(x, y, w, h, stroke=1, fill=1)
    c.setFillColorRGB(0.55, 0.55, 0.55)
    c.setFont("Helvetica-Oblique", 9)
    c.drawCentredString(x + w / 2, y + h / 2, label)
    c.restoreState()


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _draw_truncated(
    c: canvas.Canvas, cx: float, cy: float, text: str, max_w: float, anchor: str = "center"
) -> None:
    """Draw text centered at cx,cy. If it'd exceed max_w, shrink with ellipsis."""
    while c.stringWidth(text) > max_w and len(text) > 3:
        text = text[:-2] + "…"
    if anchor == "center":
        c.drawCentredString(cx, cy, text)
    else:
        c.drawString(cx, cy, text)
