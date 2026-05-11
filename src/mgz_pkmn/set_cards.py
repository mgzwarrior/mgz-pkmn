"""Render printable set identification cards for binder section dividers.

Each set in the input list becomes one card-sized cutout (2.5"x3.5"), laid
out 3x3 on a Letter page — i.e. one full 9-pocket binder sheet per page.
Cut a row out, slot it into the first pocket of that set's section, and the
binder is self-labelling.

The CLI subcommand `pkmn set-cards` fetches the full set catalog from
pokemontcg.io and emits a cutout for every one of them. The API route
`GET /api/v1/set-cards.pdf` uses the same code path.
"""

from __future__ import annotations

import datetime as _dt
import re
from pathlib import Path
from typing import Any

import requests
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .images import download_image
from .sources import TCGClient

PAGE_W, PAGE_H = letter  # 612 x 792 pt
CARD_W = 2.5 * inch
CARD_H = 3.5 * inch
COLS = 3
ROWS = 3
GRID_W = COLS * CARD_W
GRID_H = ROWS * CARD_H
MARGIN_X = (PAGE_W - GRID_W) / 2
MARGIN_Y = (PAGE_H - GRID_H) / 2
CUTOUTS_PER_PAGE = COLS * ROWS

CELL_PADDING = 10
LOGO_BOX_RATIO = 0.50  # share of cell height reserved for logo art
TEXT_BLOCK_GAP = 8


def fetch_all_sets(client: TCGClient) -> list[dict[str, Any]]:
    """Return every Pokémon TCG set on pokemontcg.io, sorted oldest → newest.

    Each dict has at minimum: id, name. Optionally: series, total,
    printedTotal, releaseDate, images.{logo,symbol}."""
    url = "https://api.pokemontcg.io/v2/sets?orderBy=releaseDate&pageSize=250"
    resp = client.session.get(url, timeout=30)
    resp.raise_for_status()
    raw = resp.json().get("data", [])
    return [
        {
            "id": s.get("id"),
            "name": s.get("name"),
            "series": s.get("series"),
            "total": s.get("total"),
            "printedTotal": s.get("printedTotal"),
            "releaseDate": s.get("releaseDate"),
            "images": s.get("images") or {},
        }
        for s in raw
        if s.get("id") and s.get("name")
    ]


def write_set_cards_pdf(
    sets: list[dict[str, Any]],
    out_path: Path,
    *,
    logos_dir: Path | None = None,
    session: requests.Session | None = None,
    today: _dt.date | None = None,
) -> int:
    """Render one cutout per set to a PDF. Returns the count written.

    `logos_dir` + `session` enable set-logo downloading & caching to disk.
    Pass both as None to render the cutouts text-only (used in tests, and
    by the CLI's `--no-images` mode)."""
    if not sets:
        return 0

    today = today or _dt.date.today()
    cutouts = [_normalize(s, today) for s in sets]

    if logos_dir is not None and session is not None:
        for co in cutouts:
            co["logo_path"] = _fetch_logo(co["logo_url"], co["set_id"], logos_dir, session)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(out_path), pagesize=letter)
    c.setTitle(out_path.stem)

    for page_start in range(0, len(cutouts), CUTOUTS_PER_PAGE):
        if page_start > 0:
            c.showPage()
        page = cutouts[page_start : page_start + CUTOUTS_PER_PAGE]
        for i, co in enumerate(page):
            col = i % COLS
            row = i // COLS
            x = MARGIN_X + col * CARD_W
            y = PAGE_H - MARGIN_Y - (row + 1) * CARD_H
            _draw_cutout(c, x, y, co)

    c.save()
    return len(cutouts)


def _normalize(set_obj: dict[str, Any], today: _dt.date) -> dict[str, Any]:
    images = set_obj.get("images") or {}
    total = set_obj.get("printedTotal") or set_obj.get("total")
    return {
        "set_id": set_obj.get("id") or set_obj.get("name") or "?",
        "set_name": set_obj.get("name") or "?",
        "series": set_obj.get("series"),
        "release_year": _release_year(set_obj.get("releaseDate")),
        "total": total,
        "logo_url": images.get("logo") or images.get("symbol"),
        "logo_path": None,
        "generated": today.isoformat(),
    }


def _release_year(release_date: str | None) -> str | None:
    if not release_date:
        return None
    m = re.match(r"(\d{4})", release_date)
    return m.group(1) if m else None


def _fetch_logo(
    url: str | None, set_id: str, logos_dir: Path, session: requests.Session
) -> Path | None:
    if not url:
        return None
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", set_id) or "set"
    ext = Path(url).suffix or ".png"
    dest = logos_dir / f"{safe}{ext}"
    if download_image(url, dest, session):
        return dest
    return None


def _draw_cutout(c: canvas.Canvas, x: float, y: float, co: dict[str, Any]) -> None:
    """Render one cutout in the cell whose bottom-left is (x, y).

    Dashed cell border = cut line. Logo on top half, text block underneath."""
    c.saveState()
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.setLineWidth(0.4)
    c.setDash(2, 2)
    c.rect(x, y, CARD_W, CARD_H, stroke=1, fill=0)
    c.setDash()
    c.restoreState()

    inner_x = x + CELL_PADDING
    inner_y = y + CELL_PADDING
    inner_w = CARD_W - 2 * CELL_PADDING
    inner_h = CARD_H - 2 * CELL_PADDING

    logo_h = inner_h * LOGO_BOX_RATIO
    logo_bottom = inner_y + inner_h - logo_h
    _draw_logo(c, co.get("logo_path"), inner_x, logo_bottom, inner_w, logo_h)

    text_top = logo_bottom - TEXT_BLOCK_GAP
    text_bottom = inner_y
    _draw_text_block(c, co, inner_x, text_bottom, inner_w, text_top - text_bottom)


def _draw_logo(c: canvas.Canvas, path: Path | None, x: float, y: float, w: float, h: float) -> None:
    if not path or not path.exists():
        return
    try:
        c.drawImage(
            ImageReader(str(path)),
            x,
            y,
            w,
            h,
            preserveAspectRatio=True,
            mask="auto",
        )
    except Exception:
        return


def _draw_text_block(
    c: canvas.Canvas, co: dict[str, Any], x: float, y: float, w: float, h: float
) -> None:
    """Set name (wrapped, up to 2 lines), series, year, total cards, gen date."""
    name = co["set_name"]
    series = co.get("series")
    year = co.get("release_year")
    total = co.get("total")
    generated = co["generated"]

    name_lines = _wrap_two_lines(c, name, "Helvetica-Bold", 13, w)
    name_size = 13
    cur_y = y + h - name_size
    c.setFont("Helvetica-Bold", name_size)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    for line in name_lines:
        c.drawCentredString(x + w / 2, cur_y, line)
        cur_y -= name_size + 1

    if series:
        c.setFont("Helvetica", 9)
        c.setFillColorRGB(0.35, 0.35, 0.35)
        cur_y -= 2
        c.drawCentredString(x + w / 2, cur_y, series)
        cur_y -= 11

    if year:
        c.setFont("Helvetica", 9)
        c.setFillColorRGB(0.5, 0.5, 0.5)
        c.drawCentredString(x + w / 2, cur_y, year)
        cur_y -= 11

    if total:
        cur_y -= 4
        c.setFont("Helvetica-Bold", 11)
        c.setFillColorRGB(0.16, 0.21, 0.30)
        c.drawCentredString(x + w / 2, cur_y, f"{total} cards")

    c.setFont("Helvetica", 7)
    c.setFillColorRGB(0.55, 0.55, 0.55)
    c.drawCentredString(x + w / 2, y + 2, f"generated {generated}")


def _wrap_two_lines(c: canvas.Canvas, text: str, font: str, size: float, max_w: float) -> list[str]:
    """Greedy word-wrap to at most two lines, ellipsizing the tail if needed."""
    if c.stringWidth(text, font, size) <= max_w:
        return [text]
    words = text.split()
    line1_words: list[str] = []
    rest = words[:]
    while rest:
        candidate = " ".join([*line1_words, rest[0]])
        if c.stringWidth(candidate, font, size) > max_w and line1_words:
            break
        line1_words.append(rest.pop(0))
    line1 = " ".join(line1_words) if line1_words else words[0]
    if not rest:
        return [line1]
    line2 = " ".join(rest)
    while c.stringWidth(line2, font, size) > max_w and len(line2) > 3:
        line2 = line2[:-2] + "…"
    return [line1, line2]
