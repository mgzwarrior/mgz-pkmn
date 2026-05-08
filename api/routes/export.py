"""POST /api/v1/export — generate and stream an .xlsx or PDF binder."""

from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mgz_pkmn.binder import write_binder_pdf
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
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
    price_min: float | None = None
    price_max: float | None = None


class RowIn(BaseModel):
    query: CardQueryIn
    card: dict[str, Any] | None = None
    pricing: PricingIn
    tag: str = ""


class ExportRequest(BaseModel):
    rows: list[RowIn]
    format: str = "xlsx"  # "xlsx" | "pdf"
    max_price: float | None = None
    title: str = "cards"


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/export")
async def export_file(req: ExportRequest) -> StreamingResponse:
    """Accept the accumulated lookup rows and return a downloadable file.

    `format` may be `"xlsx"` (spreadsheet) or `"pdf"` (binder).
    Images are not embedded during API export — the export is intentionally
    fast and dependency-free on the server side. Use the CLI for
    image-embedded spreadsheets.
    """
    if req.format not in ("xlsx", "pdf"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx' or 'pdf'")

    # Reconstruct Row objects from the request payload.
    rows: list[Row] = []
    for r in req.rows:
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
        )
        pricing = Pricing(
            market=r.pricing.market,
            variant=r.pricing.variant,
            source=r.pricing.source,
            url=r.pricing.url,
            currency=r.pricing.currency,
        )
        rows.append(Row(query=q, card=r.card, pricing=pricing, image_path=None, tag=r.tag))

    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / ("cards.xlsx" if req.format == "xlsx" else "binder.pdf")

        if req.format == "xlsx":
            write_spreadsheet(rows, out_path, max_price=req.max_price)
            content = out_path.read_bytes()
            return StreamingResponse(
                io.BytesIO(content),
                media_type=("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                headers={"Content-Disposition": "attachment; filename=cards.xlsx"},
            )
        else:
            write_binder_pdf(rows, out_path, title=req.title, max_price=req.max_price)
            content = out_path.read_bytes()
            return StreamingResponse(
                io.BytesIO(content),
                media_type="application/pdf",
                headers={"Content-Disposition": "attachment; filename=binder.pdf"},
            )
