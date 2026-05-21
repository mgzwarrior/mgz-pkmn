"""`/api/v1/runs` — persisted lookup history.

First implementation slice of ADR-0013. Three endpoints:

- `GET /runs` — paginated list. Returns the lightweight `summary_json`
  aggregate per run so a sidebar render doesn't pull every `run_rows`
  payload.
- `GET /runs/{id}` — full run including every row, in stream order.
- `POST /runs/{id}/export` — re-export the stored rows in any of the
  formats `/export` already supports. Bypasses re-fetching from
  pokemontcg.io entirely — yesterday's run re-exports in milliseconds.

Subsequent slices will add `/collections` and `/wishlists` trees that
build on the same persistence layer.
"""

from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Annotated

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from mgz_pkmn.binder import CONDENSED_LAYOUT, STANDARD_LAYOUT, write_binder_pdf
from mgz_pkmn.checklist import write_checklist_pdf
from mgz_pkmn.sorting import DEFAULT_SORT, SORT_MODES, sort_rows
from mgz_pkmn.spreadsheet import write_spreadsheet

from ..db.models import Run, RunRow
from ..db.serialize import run_row_to_row
from ..db.session import get_db

router = APIRouter()

# Annotated dependency aliases keep `Depends(...)` out of argument defaults
# (ruff B008) while preserving the FastAPI-native dependency-injection
# behaviour. `Query(...)` defaults stay inline — they're param descriptors,
# not function calls returning a value.
DbSession = Annotated[Session, Depends(get_db)]

# Mirrors the format map in `routes/export.py`. Kept local rather than
# imported to avoid a cycle on the export module.
_FORMAT_MAP: dict[str, tuple[str, str]] = {
    "xlsx": (
        "cards.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "pdf": ("binder.pdf", "application/pdf"),
    "condensed-pdf": ("binder-condensed.pdf", "application/pdf"),
    "checklist": ("checklist.pdf", "application/pdf"),
}
_IMAGE_FORMATS = frozenset({"xlsx", "pdf", "condensed-pdf"})


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class RunSummaryOut(BaseModel):
    """Lightweight run record for the sidebar list view."""

    id: int
    created_at: str
    elapsed_seconds: float | None
    summary: dict
    row_count: int


class RunRowOut(BaseModel):
    position: int
    tag: str
    market_price: float | None
    currency: str | None
    query: dict
    card: dict | None
    pricing: dict


class RunOut(BaseModel):
    id: int
    created_at: str
    elapsed_seconds: float | None
    input_text: str
    summary: dict
    rows: list[RunRowOut]


class ExportFromRunRequest(BaseModel):
    format: str = "xlsx"
    sort: str = DEFAULT_SORT
    max_price: float | None = None
    title: str = "cards"
    no_images: bool = True


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/runs")
def list_runs(
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """Most-recent-first listing of stored runs.

    Returns the lightweight `summary_json` per row plus a row count so the
    sidebar can render without ever loading `run_rows`."""
    row_count_subq = (
        select(RunRow.run_id, func.count(RunRow.id).label("row_count"))
        .group_by(RunRow.run_id)
        .subquery()
    )
    stmt = (
        select(Run, func.coalesce(row_count_subq.c.row_count, 0).label("row_count"))
        .outerjoin(row_count_subq, Run.id == row_count_subq.c.run_id)
        .order_by(Run.created_at.desc(), Run.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = [
        RunSummaryOut(
            id=run.id,
            created_at=run.created_at.isoformat(),
            elapsed_seconds=run.elapsed_seconds,
            summary=run.summary_json,
            row_count=row_count,
        )
        for run, row_count in db.execute(stmt).all()
    ]
    total = db.scalar(select(func.count(Run.id))) or 0
    return {"items": [item.model_dump() for item in items], "total": total}


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: DbSession) -> dict:
    """Full run record including every persisted `run_row`."""
    run = db.scalar(select(Run).where(Run.id == run_id).options(selectinload(Run.rows)))
    if run is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    return RunOut(
        id=run.id,
        created_at=run.created_at.isoformat(),
        elapsed_seconds=run.elapsed_seconds,
        input_text=run.input_text,
        summary=run.summary_json,
        rows=[
            RunRowOut(
                position=rr.position,
                tag=rr.tag,
                market_price=float(rr.market_price) if rr.market_price is not None else None,
                currency=rr.currency,
                query=rr.query_json,
                card=rr.card_json,
                pricing=rr.pricing_json,
            )
            for rr in run.rows
        ],
    ).model_dump()


@router.post("/runs/{run_id}/export")
async def export_run(
    run_id: int,
    req: ExportFromRunRequest,
    db: DbSession,
) -> StreamingResponse:
    """Re-export a stored run.

    Reconstructs in-memory `Row` objects from the persisted `run_rows` and
    feeds them through the same writers `/export` uses. Re-downloads images
    when `no_images=False`, mirroring the live-export flow."""
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

    run = db.scalar(select(Run).where(Run.id == run_id).options(selectinload(Run.rows)))
    if run is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")

    rows = [run_row_to_row(rr) for rr in run.rows]
    filename, media_type = _FORMAT_MAP[req.format]
    content = await run_in_threadpool(_render_export, rows, req, filename)
    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# Rendering helper — mirrors routes/export.py:_render
# ---------------------------------------------------------------------------


def _render_export(rows, req: ExportFromRunRequest, filename: str) -> bytes:
    """Build the export file from reconstructed `Row`s and return its bytes."""
    from .export import _download_card_image

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        embed_images = not req.no_images and req.format in _IMAGE_FORMATS
        if embed_images:
            images_dir = tmp / "images"
            with requests.Session() as session:
                for row in rows:
                    row.image_path = _download_card_image(row.card, images_dir, session)
        sort_rows(rows, req.sort)

        out_path = tmp / filename
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
        return out_path.read_bytes()
