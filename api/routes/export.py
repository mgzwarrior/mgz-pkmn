"""POST /api/v1/export — generate and stream an .xlsx, binder PDF, condensed
binder PDF, or set-completion checklist PDF."""

from __future__ import annotations

import io
import re
import tempfile
from pathlib import Path
from typing import Any

import requests
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mgz_pkmn import palette
from mgz_pkmn.binder import CONDENSED_LAYOUT, STANDARD_LAYOUT, write_binder_pdf
from mgz_pkmn.checklist import write_checklist_pdf
from mgz_pkmn.export_fields import THUMBNAIL, resolve_fields
from mgz_pkmn.images import download_image
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.sorting import DEFAULT_SORT, SORT_MODES, sort_rows
from mgz_pkmn.spreadsheet import Row, write_spreadsheet

router = APIRouter()


# ---------------------------------------------------------------------------
# Request models (mirrors the JSON emitted by the bulk SSE stream)
# ---------------------------------------------------------------------------


class PricingIn(BaseModel):
    market: float | None = None
    variant: str | None = None
    source: str | None = None
    url: str | None = None
    currency: str = "USD"
    condition: str | None = None
    condition_multiplier: float | None = None
    adjusted_market: float | None = None
    ebay_sold_median: float | None = None
    ebay_active_floor: float | None = None
    pricing_override: float | None = None


class CardQueryIn(BaseModel):
    raw: str
    name: str
    set_hint: str | None = None
    number: str | None = None
    variant_hint: str | None = None
    url_hint: str | None = None
    bulk_top: int | None = None
    bulk_all: bool = False
    price_min: float | None = None
    price_max: float | None = None


class RowIn(BaseModel):
    query: CardQueryIn
    card: dict[str, Any] | None = None
    pricing: PricingIn
    tag: str = ""


class ExportRequest(BaseModel):
    rows: list[RowIn]
    format: str = "xlsx"  # "xlsx" | "pdf" | "condensed-pdf" | "checklist"
    sort: str = DEFAULT_SORT
    max_price: float | None = None
    title: str = "cards"
    no_images: bool = True  # mirrors the lookup Settings default
    # Which of mgz_pkmn.export_fields.SUPPORTED_FIELDS[format] to render
    # (#262) — omitted or null means "everything this format supports",
    # matching pre-#262 behavior.
    fields: list[str] | None = None
    # #788 — lead each tag section of a "pdf"/"condensed-pdf" export with a
    # divider cutout identifying it. Ignored by xlsx/checklist.
    lead_with_id_card: bool = False
    # #598 — color theme the artifact renders in. The SPA sends its app
    # theme for the xlsx (a screen artifact) and light for the PDFs unless
    # the user opts in; light is the wire default so old clients are
    # unaffected.
    theme: str = "light"


# Valid formats and the (filename, media-type) each maps to.
_FORMAT_MAP: dict[str, tuple[str, str]] = {
    "xlsx": (
        "cards.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "pdf": ("binder.pdf", "application/pdf"),
    "condensed-pdf": ("binder-condensed.pdf", "application/pdf"),
    "checklist": ("checklist.pdf", "application/pdf"),
}

# Formats whose writers embed card art. The checklist is text-only.
_IMAGE_FORMATS = frozenset({"xlsx", "pdf", "condensed-pdf"})


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/export")
async def export_file(req: ExportRequest) -> StreamingResponse:
    """Accept the accumulated lookup rows and return a downloadable file.

    `format` is one of `xlsx`, `pdf`, `condensed-pdf`, `checklist`.
    `sort` controls row ordering (see `mgz_pkmn.sorting.SORT_MODES`).
    When `no_images` is false, each matched card's art is downloaded and
    embedded into the xlsx / binder PDFs, mirroring the CLI. The default
    (`no_images: true`) skips downloads for a faster, smaller export.
    """
    if req.format not in _FORMAT_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"format must be one of {list(_FORMAT_MAP)}",
        )
    if req.sort not in SORT_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"sort must be one of {list(SORT_MODES)}",
        )
    if req.theme not in palette.THEMES:
        raise HTTPException(
            status_code=400,
            detail=f"theme must be one of {list(palette.THEMES)}",
        )

    filename, media_type = _FORMAT_MAP[req.format]
    # Image downloads + document rendering are blocking; keep them off the
    # event loop.
    content = await run_in_threadpool(_render, req, filename)

    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _render(req: ExportRequest, filename: str) -> bytes:
    """Build the requested file and return its bytes. Runs in a worker thread."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        active_fields = resolve_fields(req.format, req.fields)

        embed_images = (
            not req.no_images and req.format in _IMAGE_FORMATS and THUMBNAIL in active_fields
        )
        if embed_images:
            images_dir = tmp / "images"
            with requests.Session() as session:
                rows = [_to_row(r, images_dir, session) for r in req.rows]
        else:
            rows = [_to_row(r, None, None) for r in req.rows]
        sort_rows(rows, req.sort)

        out_path = tmp / filename
        with palette.use_theme(req.theme):
            _write_artifact(req, rows, out_path)
        return out_path.read_bytes()


def _write_artifact(req: ExportRequest, rows: list[Row], out_path: Path) -> None:
    """Dispatch to the writer for `req.format`. Runs under the request theme."""
    active_fields = resolve_fields(req.format, req.fields)
    if req.format == "xlsx":
        write_spreadsheet(rows, out_path, max_price=req.max_price, fields=active_fields)
    elif req.format == "pdf":
        write_binder_pdf(
            rows,
            out_path,
            title=req.title,
            max_price=req.max_price,
            layout=STANDARD_LAYOUT,
            fields=active_fields,
            lead_with_id_card=req.lead_with_id_card,
        )
    elif req.format == "condensed-pdf":
        write_binder_pdf(
            rows,
            out_path,
            title=req.title,
            max_price=req.max_price,
            layout=CONDENSED_LAYOUT,
            fields=active_fields,
            lead_with_id_card=req.lead_with_id_card,
        )
    elif req.format == "checklist":
        written = write_checklist_pdf(rows, out_path, fields=active_fields)
        if not written:
            raise HTTPException(
                status_code=400,
                detail="checklist has no matched rows to render",
            )


def _to_row(
    r: RowIn,
    images_dir: Path | None,
    session: requests.Session | None,
) -> Row:
    """Reconstruct an internal Row from the wire payload.

    When `images_dir` and `session` are provided, the matched card's art is
    downloaded into `images_dir` so the writers can embed it — mirroring the
    CLI. Otherwise `image_path` is left None.
    """
    q = CardQuery(
        raw=r.query.raw,
        name=r.query.name,
        set_hint=r.query.set_hint,
        number=r.query.number,
        variant_hint=r.query.variant_hint,
        url_hint=r.query.url_hint,
        bulk_top=r.query.bulk_top,
        price_min=r.query.price_min,
        price_max=r.query.price_max,
        bulk_all=r.query.bulk_all,
    )
    pricing = Pricing(
        market=r.pricing.market,
        variant=r.pricing.variant,
        source=r.pricing.source,
        url=r.pricing.url,
        currency=r.pricing.currency,
        condition=r.pricing.condition,
        condition_multiplier=r.pricing.condition_multiplier,
        adjusted_market=r.pricing.adjusted_market,
        ebay_sold_median=r.pricing.ebay_sold_median,
        ebay_active_floor=r.pricing.ebay_active_floor,
        pricing_override=r.pricing.pricing_override,
    )
    image_path = _download_card_image(r.card, images_dir, session)
    return Row(query=q, card=r.card, pricing=pricing, image_path=image_path, tag=r.tag)


def _download_card_image(
    card: dict[str, Any] | None,
    images_dir: Path | None,
    session: requests.Session | None,
) -> Path | None:
    """Download a matched card's art into `images_dir`, mirroring the CLI.

    Returns the local path, or None when image embedding is off, the card has
    no art, or the download failed.
    """
    if images_dir is None or session is None or not card:
        return None
    images = card.get("images") or {}
    img_url = images.get("large") or images.get("small")
    if not img_url:
        return None
    ext = Path(img_url).suffix or ".png"
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", f"{card.get('id')}")
    dest = images_dir / f"{safe}{ext}"
    download_image(img_url, dest, session)
    return dest if dest.exists() else None
