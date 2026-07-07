"""Render lookup results into a PDF binder layout for vendors to scan.

Two presets are exposed via the `BinderLayout` config:

* `STANDARD_LAYOUT` — 3x3 grid (9 cards / page). Image-forward; the
  generated cells are the right size to print, cut, and slip into 9-pocket
  binder pages as physical placeholders.
* `CONDENSED_LAYOUT` — 6x4 grid (24 cards / page) with the same eight-line
  caption (name, #X/Y, set, MP, 80/85/90/95% comps). Smaller image and
  tighter type. Same data as standard, packed denser for visual scanning.

The drawing code is shared — the layout constants come from the config
object so adding a new preset is just a third dataclass instance."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from itertools import groupby
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from . import branding, palette
from .export_fields import BINDER_FIELDS
from .parser import (
    _CJK_IDEOGRAPH_RE,
    _HANGUL_RE,
    _HIRAGANA_KATAKANA_RE,
)
from .pricing import COMP_PERCENTS
from .spreadsheet import Row

# Layout constants — page-level, shared by every preset.
PAGE_W, PAGE_H = letter  # 612 x 792 pt
CARD_ASPECT = 2.5 / 3.5  # standard Pokemon TCG card ratio (w/h)


@dataclass(frozen=True)
class BinderLayout:
    """All knobs that distinguish one binder preset from another.

    Drawing code reads everything from this object — module-level constants
    are limited to truly invariant values (page size, card aspect ratio,
    the eight comp / caption lines, the language-label table)."""

    name: str
    margin: float
    header_band_h: float
    cols: int
    rows_per_page: int
    gutter: float
    image_scale: float
    caption_leading: float
    caption_padding: float
    name_font_size: float
    caption_font_size: float
    market_font_size: float
    comp_font_size: float
    lang_banner_h: float
    lang_banner_gap: float
    lang_banner_font_size: float
    image_target_w_px: int
    image_quality: int

    @property
    def cards_per_page(self) -> int:
        return self.cols * self.rows_per_page


# Always 8 caption lines: name, (#X/Y), set, MP, then four comp tiers.
CAPTION_LINES = 8

STANDARD_LAYOUT = BinderLayout(
    name="standard",
    margin=0.35 * inch,
    header_band_h=22,
    cols=3,
    rows_per_page=3,
    gutter=6,
    image_scale=0.71,
    caption_leading=11.5,
    caption_padding=8,
    name_font_size=10.5,
    caption_font_size=9,
    market_font_size=10,
    comp_font_size=8,
    lang_banner_h=14,
    lang_banner_gap=4,
    lang_banner_font_size=8.5,
    image_target_w_px=400,
    image_quality=85,
)

CONDENSED_LAYOUT = BinderLayout(
    name="condensed",
    margin=0.3 * inch,
    header_band_h=18,
    cols=6,
    rows_per_page=4,
    gutter=4,
    image_scale=0.78,
    caption_leading=9,
    caption_padding=4,
    name_font_size=7.5,
    caption_font_size=6.5,
    market_font_size=7,
    comp_font_size=6,
    lang_banner_h=10,
    lang_banner_gap=2,
    lang_banner_font_size=6.5,
    image_target_w_px=300,
    image_quality=85,
)


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
    layout: BinderLayout = STANDARD_LAYOUT,
    fields: frozenset[str] | None = None,
    lead_with_id_card: bool = False,
) -> None:
    """Render `rows` into a binder-style PDF using `layout`.

    Rows are grouped by `Row.tag` (the originating input file) so that each
    list shows up as its own section with a header banner and starts on a
    fresh page. Each card cell shows: image, bold name, "(#num/total)", set
    name, market price (labelled "MP"), and one comp tier per line at
    80/85/90/95% — identical for both presets.

    `fields` restricts which of those pieces render (#262) — `None` (the
    CLI default) renders everything, matching pre-#262 behavior. A field
    that's off leaves its caption line blank rather than reclaiming the
    space, so the fixed eight-line geometry doesn't need to change per
    render.

    `lead_with_id_card` (#788) reserves the first grid cell of each section
    for a divider cutout identifying the set — for a binder holding several
    smaller sets, cutting that card and slotting it first makes the section
    self-labelling. Off by default so a single-set export isn't cluttered
    with a divider it doesn't need."""
    active = BINDER_FIELDS if fields is None else fields
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_cjk_fonts()
    c = canvas.Canvas(str(out_path), pagesize=letter)
    branding.apply_pdf_metadata(c, title or out_path.stem)
    tracker = branding.PageTracker(c, letter)

    geom = _compute_geometry(layout)

    # Group rows by tag, preserving the order they came in. Each group prints
    # on its own set of pages, prefixed by a one-line section banner.
    sections = [(tag, list(group)) for tag, group in groupby(rows, key=lambda r: r.tag or "")]

    is_first_section = True
    for tag, section_rows in sections:
        if not is_first_section:
            tracker.show_page()
        is_first_section = False
        _draw_section(
            c,
            tag,
            section_rows,
            layout,
            geom,
            tracker,
            active,
            max_price=max_price,
            lead_with_id_card=lead_with_id_card,
        )

    tracker.finish()


def _compute_geometry(layout: BinderLayout) -> dict:
    """Compute the cell + image geometry once per PDF render."""
    usable_w = PAGE_W - 2 * layout.margin
    grid_top_y = PAGE_H - layout.margin - layout.header_band_h
    usable_h = grid_top_y - layout.margin
    cell_w = (usable_w - layout.gutter * (layout.cols - 1)) / layout.cols
    cell_h = (usable_h - layout.gutter * (layout.rows_per_page - 1)) / layout.rows_per_page
    caption_h = layout.caption_leading * CAPTION_LINES + layout.caption_padding
    banner_reserve = layout.lang_banner_h + layout.lang_banner_gap
    image_h = cell_h - caption_h - banner_reserve
    image_w = image_h * CARD_ASPECT
    if image_w > cell_w * 0.92:
        image_w = cell_w * 0.92
        image_h = image_w / CARD_ASPECT
    image_w *= layout.image_scale
    image_h *= layout.image_scale
    return {
        "cell_w": cell_w,
        "cell_h": cell_h,
        "image_w": image_w,
        "image_h": image_h,
        "grid_top_y": grid_top_y,
        "caption_h": caption_h,
        "banner_reserve": banner_reserve,
    }


def _draw_section(
    c: canvas.Canvas,
    tag: str,
    rows: list[Row],
    layout: BinderLayout,
    geom: dict,
    tracker: branding.PageTracker,
    fields: frozenset[str],
    max_price: float | None = None,
    lead_with_id_card: bool = False,
) -> None:
    """Render one tag's worth of cards across as many pages as needed.

    When `lead_with_id_card` is on, cell 0 is a divider cutout (`None` in
    `cells`) identifying the section instead of a card — the real cards
    shift one slot later, still filling pages at `cards_per_page`."""
    cells: list[Row | None] = ([None] if lead_with_id_card and rows else []) + list(rows)
    divider_set = ((rows[0].card or {}).get("set") or {}) if rows else {}

    for i, cell in enumerate(cells):
        idx_on_page = i % layout.cards_per_page
        if i > 0 and idx_on_page == 0:
            tracker.show_page()
        if idx_on_page == 0:
            _draw_section_header(c, tag, len(rows), layout)

        col = idx_on_page % layout.cols
        rrow = idx_on_page // layout.cols
        cell_x = layout.margin + col * (geom["cell_w"] + layout.gutter)
        cell_top_y = geom["grid_top_y"] - rrow * (geom["cell_h"] + layout.gutter)
        cell_bottom_y = cell_top_y - geom["cell_h"]

        if cell is None:
            _draw_id_card_divider(
                c, tag, divider_set, len(rows), cell_x, cell_bottom_y, layout, geom
            )
        else:
            _draw_cell(c, cell, cell_x, cell_bottom_y, layout, geom, fields, max_price=max_price)


def _draw_section_header(c: canvas.Canvas, tag: str, count: int, layout: BinderLayout) -> None:
    """Banner across the top of each page in a section: 'Source: <tag>  ·  N cards'.

    The mgz-pkmn wordmark rides on the left edge of the band — the band's
    deep-frond-green background is where the light-wordmark logo reads,
    and putting it here gets branding on every page without inventing a
    fresh chrome strip."""
    c.saveState()
    band_y = PAGE_H - layout.margin - layout.header_band_h
    c.setFillColorRGB(*branding.HEADER_PANEL_RGB)
    c.rect(
        layout.margin, band_y, PAGE_W - 2 * layout.margin, layout.header_band_h, fill=1, stroke=0
    )

    logo_h = layout.header_band_h * 0.65
    logo_y = band_y + (layout.header_band_h - logo_h) / 2
    logo_x = layout.margin + 6
    branding.draw_pdf_logo(c, logo_x, logo_y, logo_h)
    text_x = logo_x + logo_h * branding.LOGO_ASPECT + 10

    c.setFillColorRGB(*palette.rgb01("fg-on-dark"))
    title_size = max(9, layout.header_band_h * 0.5)
    sub_size = max(7, layout.header_band_h * 0.4)
    c.setFont("Helvetica-Bold", title_size)
    label = tag or "(untagged)"
    c.drawString(text_x, band_y + (layout.header_band_h - title_size) / 2, f"Source: {label}")
    c.setFont("Helvetica", sub_size)
    suffix = f"{count} card{'s' if count != 1 else ''}"
    c.drawRightString(
        PAGE_W - layout.margin - 8,
        band_y + (layout.header_band_h - sub_size) / 2,
        suffix,
    )
    c.restoreState()


def _divider_year(release_date: str | None) -> str | None:
    if not release_date:
        return None
    m = re.match(r"(\d{4})", release_date)
    return m.group(1) if m else None


def _draw_id_card_divider(
    c: canvas.Canvas,
    tag: str,
    set_info: dict,
    count: int,
    x: float,
    y: float,
    layout: BinderLayout,
    geom: dict,
) -> None:
    """Divider cutout identifying a section (#788): dashed cut line instead
    of the solid card-cell border, the set (or tag) name, release year when
    known, and the section's card count. Text-only — no image fetch — so
    turning the setting on never adds a network round-trip to the export."""
    cell_w = geom["cell_w"]
    cell_h = geom["cell_h"]

    c.saveState()
    c.setStrokeColorRGB(*palette.rgb01("border-2"))
    c.setLineWidth(0.75)
    c.setDash(3, 3)
    c.rect(x, y, cell_w, cell_h, stroke=1, fill=0)
    c.setDash()
    c.restoreState()

    name = set_info.get("name") or tag or "(untagged)"
    year = _divider_year(set_info.get("releaseDate"))
    max_w = cell_w - 12
    cx = x + cell_w / 2

    c.setFillColorRGB(*palette.rgb01("fg-1"))
    c.setFont("Helvetica-Bold", layout.name_font_size + 2)
    _draw_truncated(c, cx, y + cell_h * 0.58, name, max_w)

    c.setFillColorRGB(*palette.rgb01("fg-3"))
    c.setFont("Helvetica", layout.caption_font_size)
    suffix = f"{count} card{'s' if count != 1 else ''}"
    label = f"{suffix} · {year}" if year else suffix
    _draw_truncated(c, cx, y + cell_h * 0.58 - layout.caption_leading - 4, label, max_w)


def _draw_cell(
    c: canvas.Canvas,
    row: Row,
    x: float,
    y: float,
    layout: BinderLayout,
    geom: dict,
    fields: frozenset[str],
    max_price: float | None = None,
) -> None:
    """Render one card cell. (x, y) is the bottom-left of the cell.

    A layout coordinator: it computes the cell geometry, then hands each
    visual block (border, banner, image, caption text, price, comps) to a
    helper in top-to-bottom order, threading the descending `line_y` cursor
    through the caption stack. `fields` (#262) blanks a line rather than
    reclaiming its space, so the cursor math stays the same regardless of
    which fields are enabled."""
    cell_w = geom["cell_w"]
    cell_h = geom["cell_h"]
    image_w = geom["image_w"]
    image_h = geom["image_h"]
    caption_h = geom["caption_h"]
    banner_reserve = geom["banner_reserve"]

    # Vertically center the (banner + image + caption) block in the cell.
    content_h = banner_reserve + image_h + caption_h
    top_padding = max(0, (cell_h - content_h) / 2)
    image_x = x + (cell_w - image_w) / 2
    banner_top_y = y + cell_h - top_padding
    image_top_y = banner_top_y - banner_reserve
    image_y = image_top_y - image_h  # bottom of image

    # Light cell border for visual separation (similar to a binder pocket).
    c.setStrokeColorRGB(*palette.rgb01("border-1"))
    c.setLineWidth(0.5)
    c.rect(x, y, cell_w, cell_h, stroke=1, fill=0)

    # Language banner — drawn above the card image, full-image-width, with
    # the human-readable language name. Non-English cards only.
    language = (row.card or {}).get("language") or "en"
    if language and language.lower() != "en":
        _draw_lang_banner(c, image_x, banner_top_y, image_w, language, layout)

    if "thumbnail" in fields:
        _draw_cell_image(c, row, image_x, image_y, image_w, image_h, layout)

    cx = x + cell_w / 2
    max_w = cell_w - 8
    line_y = image_y - 6 - layout.caption_leading
    line_y = _draw_cell_caption_text(c, row.card or {}, language, cx, line_y, max_w, layout, fields)
    line_y = _draw_cell_price(c, row, cx, line_y, max_w, layout, max_price, fields)
    _draw_cell_comps(c, row, cx, line_y, max_w, layout, fields)


def _draw_cell_image(
    c: canvas.Canvas,
    row: Row,
    image_x: float,
    image_y: float,
    image_w: float,
    image_h: float,
    layout: BinderLayout,
) -> None:
    """Draw the card image, falling back to a placeholder on a missing file
    or a decode/draw error."""
    if row.image_path and row.image_path.exists():
        try:
            buf = _shrink_for_pdf(row.image_path, layout)
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


def _draw_cell_caption_text(
    c: canvas.Canvas,
    card: dict,
    language: str,
    cx: float,
    line_y: float,
    max_w: float,
    layout: BinderLayout,
    fields: frozenset[str],
) -> float:
    """Name (bold), `(#num/total)`, and set name. Returns the cursor below
    the set-name line, ready for the price block. Each line is gated by its
    #262 field key; a disabled field leaves its line blank rather than
    collapsing the cursor, so the caption block's fixed height doesn't
    depend on which fields are on."""
    name = card.get("name") or "(not found)"
    card_set = card.get("set") or {}
    set_name = card_set.get("name") or "?"
    number = card.get("number") or "?"
    total = card_set.get("printedTotal") or card_set.get("total")

    # 1. Name (bold).
    line_y -= 2
    if "name" in fields:
        c.setFillColorRGB(*palette.rgb01("fg-1"))
        c.setFont(_font_for_name(name, language, bold=True), layout.name_font_size)
        _draw_truncated(c, cx, line_y, name, max_w)

    # 2. (#X/Y) or just (#X) when total unknown
    line_y -= layout.caption_leading
    if "number" in fields:
        c.setFillColorRGB(*palette.rgb01("fg-1"))
        c.setFont("Helvetica", layout.caption_font_size)
        parens = f"(#{number}/{total})" if total else f"(#{number})"
        _draw_truncated(c, cx, line_y, parens, max_w)

    # 3. Set name
    line_y -= layout.caption_leading
    if "set" in fields:
        c.setFillColorRGB(*palette.rgb01("fg-1"))
        c.setFont("Helvetica", layout.caption_font_size)
        _draw_truncated(c, cx, line_y, set_name, max_w)
    return line_y


def _draw_cell_price(
    c: canvas.Canvas,
    row: Row,
    cx: float,
    line_y: float,
    max_w: float,
    layout: BinderLayout,
    max_price: float | None,
    fields: frozenset[str],
) -> float:
    """Market price labelled "MP". Red `! MP` above cap, green in budget,
    oblique "no price" when unpriced. Returns the cursor below the line."""
    line_y -= layout.caption_leading + 1
    if "market" not in fields:
        return line_y
    if row.pricing.market is not None:
        sym = "€" if row.pricing.currency == "EUR" else "$"
        is_over_cap = max_price is not None and row.pricing.market > max_price
        c.setFont("Helvetica-Bold", layout.market_font_size)
        if is_over_cap:
            c.setFillColorRGB(*palette.rgb01("danger-fg"))  # above-cap
            label = f"! MP {sym}{row.pricing.market:,.2f}"
        else:
            c.setFillColorRGB(*palette.rgb01("success-fg"))  # in-budget
            label = f"MP {sym}{row.pricing.market:,.2f}"
        _draw_truncated(c, cx, line_y, label, max_w)
    else:
        c.setFont("Helvetica-Oblique", layout.caption_font_size)
        c.setFillColorRGB(*palette.rgb01("fg-3"))
        _draw_truncated(c, cx, line_y, "no price", max_w)
    return line_y


def _draw_cell_comps(
    c: canvas.Canvas,
    row: Row,
    cx: float,
    line_y: float,
    max_w: float,
    layout: BinderLayout,
    fields: frozenset[str],
) -> None:
    """Comp tiers, one per line at 80/85/90/95% of market."""
    c.setFillColorRGB(*palette.rgb01("fg-2"))
    c.setFont("Helvetica", layout.comp_font_size)
    if row.pricing.market is not None:
        sym = "€" if row.pricing.currency == "EUR" else "$"
        for p in COMP_PERCENTS:
            line_y -= layout.caption_leading
            if f"comp_{p}" not in fields:
                continue
            comp_value = round(row.pricing.market * p / 100, 2)
            _draw_truncated(c, cx, line_y, f"{p}% {sym}{comp_value:,.2f}", max_w)


def _shrink_for_pdf(src: Path, layout: BinderLayout) -> io.BytesIO:
    """Downsample to layout.image_target_w_px wide and re-encode as JPEG to
    keep PDF file size sensible. Original images often exceed 1 MB each."""
    img = PILImage.open(src)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")
    if img.width > layout.image_target_w_px:
        ratio = layout.image_target_w_px / img.width
        new_size = (layout.image_target_w_px, max(1, int(img.height * ratio)))
        img = img.resize(new_size, PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=layout.image_quality, optimize=True)
    buf.seek(0)
    return buf


def _draw_lang_banner(
    c: canvas.Canvas,
    image_x: float,
    banner_top_y: float,
    image_w: float,
    language: str,
    layout: BinderLayout,
) -> None:
    """Draw a full-image-width banner above the card image, labelled with
    the human-readable language name (e.g. 'JAPANESE'). Non-English cards
    only — English is the default and doesn't need calling out."""
    label = LANG_LABELS.get(language.lower(), language.upper().replace("-", " "))
    banner_x = image_x
    banner_w = image_w
    banner_y = banner_top_y - layout.lang_banner_h
    c.saveState()
    c.setFillColorRGB(*palette.rgb01("ember-500"))
    c.setStrokeColorRGB(*palette.rgb01("ember-500"))
    c.setLineWidth(0.5)
    c.rect(banner_x, banner_y, banner_w, layout.lang_banner_h, fill=1, stroke=1)
    c.setFillColorRGB(*palette.rgb01("fg-on-dark"))
    c.setFont("Helvetica-Bold", layout.lang_banner_font_size)
    text_y = banner_y + (layout.lang_banner_h - layout.lang_banner_font_size) / 2 + 1
    c.drawCentredString(banner_x + banner_w / 2, text_y, label.upper())
    c.restoreState()


def _draw_placeholder(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str) -> None:
    c.saveState()
    c.setFillColorRGB(*palette.rgb01("bg-sunken"))
    c.setStrokeColorRGB(*palette.rgb01("border-1"))
    c.rect(x, y, w, h, stroke=1, fill=1)
    c.setFillColorRGB(*palette.rgb01("fg-3"))
    c.setFont("Helvetica-Oblique", 9)
    c.drawCentredString(x + w / 2, y + h / 2, label)
    c.restoreState()


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
