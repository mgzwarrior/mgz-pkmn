"""Render printable set identification cards for binder section dividers.

Each set in the input list becomes one card-sized cutout (2.5"x3.5"), laid
out 3x3 on a Letter page — i.e. one full 9-pocket binder sheet per page.
Cut a row out, slot it into the first pocket of that set's section, and the
binder is self-labelling.

The CLI subcommand `pkmn set-cards` fetches the full set catalog from
pokemontcg.io and emits a cutout for every one of them. The API route
`GET /api/v1/set-cards.pdf` uses the same code path.

Set images (logos + symbols) flow through the unified disk image cache
(`mgz_pkmn.cache.download_and_cache_image`) under category `sets/logo` /
`sets/symbol`. They have no TTL — set art doesn't change once a set ships
and re-downloading 200+ logos every time someone hits this endpoint is the
single most painful path in the tool. `pkmn cache warm-sets` primes the
cache in one pass so the first export request after install is fast.
"""

from __future__ import annotations

import datetime as _dt
import re
import shutil
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import requests
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from . import branding
from . import cache as disk_cache
from .images import download_image
from .sources import TCGClient

# Unified cache categories for set art. Two slots per set — the logo is the
# big wordmark used in cutouts and the picker UI; the symbol is the tiny
# corner glyph reserved for future surfaces (e.g. the per-row set chip in
# the results table).
_LOGO_CATEGORY = "sets/logo"
_SYMBOL_CATEGORY = "sets/symbol"

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


@dataclass(frozen=True)
class WarmResult:
    """Outcome of a `warm_set_images` run.

    `sets` is the number of sets walked; `logos_cached` / `symbols_cached`
    are the per-kind success counts (already-cached entries count as
    successes — they did not need a new fetch); `failures` is the number
    of image URLs the warm pass could not download (logged to stderr by
    `download_and_cache_image`). Returned by the CLI's `pkmn cache warm-sets`
    for the summary line."""

    sets: int
    logos_cached: int
    symbols_cached: int
    failures: int


def fetch_all_sets(client: TCGClient) -> list[dict[str, Any]]:
    """Return every Pokémon TCG set on pokemontcg.io, sorted oldest → newest.

    Each dict has at minimum: id, name. Optionally: series, total,
    printedTotal, releaseDate, images.{logo,symbol}.

    The raw response is routed through the API disk cache (same path the
    per-card lookup uses), so repeated `pkmn set-cards` invocations within
    a week reuse the cached catalog instead of re-fetching the full list."""
    url = "https://api.pokemontcg.io/v2/sets?orderBy=releaseDate&pageSize=250"
    raw = disk_cache.read_api(url)
    if raw is None:
        resp = client.session.get(url, timeout=30)
        resp.raise_for_status()
        raw = resp.json().get("data", [])
        disk_cache.write_api(url, raw)
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


def filter_sets_by_ids(
    sets: list[dict[str, Any]],
    set_ids: Sequence[str] | None,
) -> list[dict[str, Any]]:
    """Restrict `sets` to entries whose `id` appears in `set_ids`.

    Returns `sets` unchanged when `set_ids` is `None` or empty — "no filter"
    is the default. `set_ids` is typed `Sequence` rather than `Iterable` so
    the emptiness check is well-defined (a one-shot generator would be
    truthy-but-empty and silently filter everything out). The match is
    case-sensitive (pokemontcg.io set ids are lowercase by convention, and
    an unintended typo should produce an empty selection rather than a
    too-clever fuzzy match the user can't reason about). The input order
    is preserved so the rendered PDF tracks the catalog's oldest → newest
    ordering."""
    if not set_ids:
        return sets
    wanted = set(set_ids)
    return [s for s in sets if s.get("id") in wanted]


def write_set_cards_pdf(
    sets: list[dict[str, Any]],
    out_path: Path,
    *,
    logos_dir: Path | None = None,
    session: requests.Session | None = None,
    today: _dt.date | None = None,
) -> int:
    """Render one cutout per set to a PDF. Returns the count written.

    `session` is the canonical "fetch images" switch. When provided, the
    writer resolves each set's logo through the unified disk image cache
    (`cache/images/sets/logo/<id>.<ext>`) — already-cached logos are
    served from disk; misses fetch via `session` and persist there.

    `logos_dir` is optional. When passed alongside `session`, the cached
    logo is mirrored into that directory as a writable sidecar (legacy
    back-compat with the CLI's `--logos-dir` flag). When omitted, the
    cache is the only on-disk store, which is what the FastAPI route
    wants.

    Passing `session=None` renders the cutouts text-only (no logo
    fetches, no cache writes) — used by tests and by the CLI's
    `--no-images` mode."""
    if not sets:
        return 0

    today = today or _dt.date.today()
    cutouts = [_normalize(s, today) for s in sets]

    # `session is not None` is the canonical "fetch images" switch — the
    # unified disk cache covers the storage half, so a caller can drop
    # `logos_dir` entirely and still get cache-hit images. `logos_dir` is
    # kept as an optional sidecar mirror for users who want a writable
    # directory of logos alongside the PDF.
    if session is not None:
        for co in cutouts:
            co["logo_path"] = _fetch_logo(co["logo_url"], co["set_id"], logos_dir, session)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(out_path), pagesize=letter)
    branding.apply_pdf_metadata(c, out_path.stem)
    tracker = branding.PageTracker(c, letter)

    for page_start in range(0, len(cutouts), CUTOUTS_PER_PAGE):
        if page_start > 0:
            tracker.show_page()
        if tracker.page_num == 1:
            _draw_page_one_logo(c)
        page = cutouts[page_start : page_start + CUTOUTS_PER_PAGE]
        for i, co in enumerate(page):
            col = i % COLS
            row = i // COLS
            x = MARGIN_X + col * CARD_W
            y = PAGE_H - MARGIN_Y - (row + 1) * CARD_H
            _draw_cutout(c, x, y, co)

    tracker.finish()
    return len(cutouts)


def _draw_page_one_logo(c: canvas.Canvas) -> None:
    """Page-1 only wordmark above the 3x3 cutout grid. Painted on its
    own dark slate chip so the light-grey wordmark reads — the
    set-cards layout has no shared header band to ride on, unlike the
    binder and checklist writers."""
    logo_h = 11.0
    logo_y = PAGE_H - MARGIN_Y / 2 - logo_h / 2
    branding.draw_pdf_logo(c, MARGIN_X + 4, logo_y, logo_h, draw_panel=True)


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
    url: str | None,
    set_id: str,
    logos_dir: Path | None,
    session: requests.Session,
) -> Path | None:
    """Resolve a usable on-disk path for the set's logo image.

    Cache-aside: the canonical store is the unified image cache
    (`cache/images/sets/logo/<set_id>.<ext>`). On a hit we return the
    cached path; on a miss we download once and persist there.

    `logos_dir` is kept for back-compat with the CLI's `--logos-dir`
    option (and a few existing tests that expect a writable sidecar
    directory): when callers pass one, we copy the cached file into it
    after the cache resolves. That keeps `output/images/set-logos/` a
    usable artifact for archival without making it the source of truth."""
    if not url:
        return None
    cached = disk_cache.download_and_cache_image(_LOGO_CATEGORY, set_id, url, session)
    if cached is None:
        # Cache is disabled (MGZ_PKMN_NO_CACHE=1) or the download itself
        # failed. Fall back to the legacy per-output `logos_dir` path so
        # `--no-cache` runs still produce art when they can.
        if logos_dir is None:
            return None
        safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", set_id) or "set"
        # Strip the query string before deriving the extension — a URL
        # like `…/logo.png?x=1` otherwise yields a `.png?x=1` suffix and
        # an unusable filename in `logos_dir`.
        ext = Path(urlsplit(url).path).suffix or ".png"
        dest = logos_dir / f"{safe}{ext}"
        return dest if download_image(url, dest, session) else None
    if logos_dir is not None:
        try:
            logos_dir.mkdir(parents=True, exist_ok=True)
            sidecar = logos_dir / cached.name
            if not sidecar.exists() or sidecar.stat().st_size == 0:
                shutil.copyfile(cached, sidecar)
        except OSError as exc:
            print(f"  ! logos_dir mirror failed for {set_id}: {exc}", file=sys.stderr)
    return cached


def warm_set_images(
    client: TCGClient,
    *,
    sets: list[dict[str, Any]] | None = None,
    on_progress: Any | None = None,
) -> WarmResult:
    """Pre-download every set's logo + symbol into the unified image cache.

    Walks `pokemontcg.io`'s set catalog (or the supplied `sets` list, useful
    for tests) and fetches every available image into the cache under
    `sets/logo` and `sets/symbol`. Already-cached entries are short-circuited
    by `download_and_cache_image` so a second warm pass is effectively free.

    `on_progress`, when provided, is invoked once per set with
    `(index, total, set_id)` for callers that want to render a progress
    bar. The function is otherwise quiet (the underlying download helper
    logs failures to stderr)."""
    sets_list = sets if sets is not None else fetch_all_sets(client)
    total = len(sets_list)
    logos_cached = 0
    symbols_cached = 0
    failures = 0
    for index, s in enumerate(sets_list, start=1):
        set_id = s.get("id") or s.get("name") or ""
        if not set_id:
            continue
        if on_progress is not None:
            on_progress(index, total, set_id)
        images = s.get("images") or {}
        symbol_url = images.get("symbol")
        # Mirror `_normalize`'s logo→symbol fallback so the writer's
        # `_fetch_logo` lookup against `sets/logo` lands a cache hit for
        # sets that only ship a symbol image. Without this fallback, a
        # warmed cache could still trigger a re-download in
        # `write_set_cards_pdf` for those sets.
        logo_url = images.get("logo") or symbol_url
        if logo_url:
            if disk_cache.download_and_cache_image(
                _LOGO_CATEGORY, set_id, logo_url, client.session
            ):
                logos_cached += 1
            else:
                failures += 1
        if symbol_url:
            if disk_cache.download_and_cache_image(
                _SYMBOL_CATEGORY, set_id, symbol_url, client.session
            ):
                symbols_cached += 1
            else:
                failures += 1
    return WarmResult(
        sets=total,
        logos_cached=logos_cached,
        symbols_cached=symbols_cached,
        failures=failures,
    )


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
    except Exception as exc:
        print(f"  ! logo render failed for {path}: {exc}", file=sys.stderr)
        _draw_placeholder(c, x, y, w, h, "image error")


def _draw_placeholder(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str) -> None:
    c.saveState()
    c.setFillColorRGB(0.95, 0.95, 0.95)
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.rect(x, y, w, h, stroke=1, fill=1)
    c.setFillColorRGB(0.55, 0.55, 0.55)
    c.setFont("Helvetica-Oblique", 9)
    c.drawCentredString(x + w / 2, y + h / 2 - 3, label)
    c.restoreState()


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
