"""POST /api/v1/export — generate and stream an .xlsx, binder PDF, condensed
binder PDF, or set-completion checklist PDF."""

from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mgz_pkmn.binder import CONDENSED_LAYOUT, STANDARD_LAYOUT, write_binder_pdf
from mgz_pkmn.checklist import write_checklist_pdf
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


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/export")
async def export_file(req: ExportRequest) -> StreamingResponse:
    """Accept the accumulated lookup rows and return a downloadable file.

    `format` is one of `xlsx`, `pdf`, `condensed-pdf`, `checklist`.
    `sort` controls row ordering (see `mgz_pkmn.sorting.SORT_MODES`).
    Images are not embedded during API export — the export is intentionally
    fast and dependency-free on the server side. Use the CLI for
    image-embedded spreadsheets.
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

    rows = [_to_row(r) for r in req.rows]
    sort_rows(rows, req.sort)

    filename, media_type = _FORMAT_MAP[req.format]

    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / filename
        if req.format == "xlsx":
            write_spreadsheet(rows, out_path, max_price=req.max_price)
        elif req.format == "pdf":
            write_binder_pdf(
                rows, out_path, title=req.title, max_price=req.max_price, layout=STANDARD_LAYOUT
            )
        elif req.format == "condensed-pdf":
            write_binder_pdf(
                rows, out_path, title=req.title, max_price=req.max_price, layout=CONDENSED_LAYOUT
            )
        elif req.format == "checklist":
            written = write_checklist_pdf(rows, out_path)
            if not written:
                raise HTTPException(
                    status_code=400,
                    detail="checklist has no matched rows to render",
                )
        content = out_path.read_bytes()

    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _to_row(r: RowIn) -> Row:
    """Reconstruct an internal Row from the wire payload."""
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
    )
    return Row(query=q, card=r.card, pricing=pricing, image_path=None, tag=r.tag)
