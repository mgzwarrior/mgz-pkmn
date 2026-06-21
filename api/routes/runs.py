"""`/api/v1/runs` — persisted lookup history with saved-search UX.

First implementation slice of ADR-0013. Every completed `/bulk` stream
persists a row here, but only runs the user has explicitly *saved*
(given a name to) surface via this listing endpoint — the sidebar shows
a curated set of saved searches rather than a noisy auto-list of every
recent run.

Endpoints:

- `GET /runs` — paginated list of *saved* runs (``name IS NOT NULL``).
  Returns the lightweight `summary_json` aggregate per row so a sidebar
  render never pulls a `run_rows` payload.
- `GET /runs/{id}` — full run including every row, in stream order. Not
  filtered on `name`: callers (e.g. the just-completed stream) can load
  a run by id before it has been saved.
- `PATCH /runs/{id}` — save / rename a run. Sets ``name`` and stores the
  current ResultsTable view state (sort + filters) so a future
  click-to-load can restore the exact view.
- `DELETE /runs/{id}` — delete a run (and its rows). Owner-only; prunes a
  saved search the user no longer wants (#698).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..auth.session import current_user_or_default
from ..db.models import DEFAULT_USER_ID, Run, RunRow, User
from ..db.session import get_db

router = APIRouter()

# Annotated dependency aliases keep `Depends(...)` out of argument defaults
# (ruff B008) while preserving the FastAPI-native dependency-injection
# behaviour. `Query(...)` defaults stay inline — they're param descriptors,
# not function calls returning a value.
DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]


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
    name: str | None
    view_state: dict | None


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
    name: str | None
    view_state: dict | None


class SaveRunRequest(BaseModel):
    """Body for PATCH /runs/{id}.

    Names a run (or renames an already-saved one) and stamps the current
    ResultsTable view state on it. Blank `name` is rejected so we don't
    accidentally promote a run into the saved list without a label."""

    name: str = Field(min_length=1, max_length=200)
    view_state: dict | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/runs")
def list_runs(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """Most-recent-first listing of *saved* runs.

    Filters on ``Run.name IS NOT NULL`` so the sidebar only surfaces runs
    the user has explicitly chosen to keep."""
    row_count_subq = (
        select(RunRow.run_id, func.count(RunRow.id).label("row_count"))
        .group_by(RunRow.run_id)
        .subquery()
    )
    stmt = (
        select(Run, func.coalesce(row_count_subq.c.row_count, 0).label("row_count"))
        .outerjoin(row_count_subq, Run.id == row_count_subq.c.run_id)
        .where(Run.name.is_not(None), Run.user_id == current_user.id)
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
            name=run.name,
            view_state=run.view_state,
        )
        for run, row_count in db.execute(stmt).all()
    ]
    total = (
        db.scalar(
            select(func.count(Run.id)).where(
                Run.name.is_not(None),
                Run.user_id == current_user.id,
            )
        )
        or 0
    )
    return {"items": [item.model_dump() for item in items], "total": total}


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: DbSession, current_user: CurrentUser) -> dict:
    """Full run record including every persisted `run_row`.

    Not filtered on `name`: the just-completed stream needs to load its
    own (still-unnamed) run before the user has chosen to save it.

    Ownership rule mirrors `PATCH /runs/{id}`: signed-in users only see
    their own runs, with one carve-out — anonymous, still-unnamed runs
    (`user_id == DEFAULT_USER_ID and name is None`) stay readable so the
    just-completed pre-sign-in stream can promote into the saved list."""
    run = db.scalar(select(Run).where(Run.id == run_id).options(selectinload(Run.rows)))
    if run is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    if run.user_id != current_user.id and not (run.user_id == DEFAULT_USER_ID and run.name is None):
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
        name=run.name,
        view_state=run.view_state,
    ).model_dump()


@router.patch("/runs/{run_id}")
def save_run(run_id: int, req: SaveRunRequest, db: DbSession, current_user: CurrentUser) -> dict:
    """Save or rename a run.

    Stamps the supplied ``name`` (promoting an unnamed run into the
    saved-search list) and snapshots the ResultsTable view state for
    later replay. ``view_state`` is opaque to the API — the schema lives
    in the SPA."""
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    run = db.scalar(select(Run).where(Run.id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    if run.user_id != current_user.id:
        if run.user_id == DEFAULT_USER_ID and run.name is None:
            # Anonymous hosted-demo lookups can be promoted after the
            # visitor signs in. Once named, the run belongs to that user.
            run.user_id = current_user.id
        else:
            raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    run.name = name
    if req.view_state is not None:
        run.view_state = req.view_state
    db.commit()
    db.refresh(run)
    row_count = db.scalar(select(func.count(RunRow.id)).where(RunRow.run_id == run.id)) or 0
    return RunSummaryOut(
        id=run.id,
        created_at=run.created_at.isoformat(),
        elapsed_seconds=run.elapsed_seconds,
        summary=run.summary_json,
        row_count=row_count,
        name=run.name,
        view_state=run.view_state,
    ).model_dump()


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: int, db: DbSession, current_user: CurrentUser) -> None:
    """Delete a run and its rows. Owner-only — a missing or not-owned id 404s.

    Hard delete, matching the collections / wishlists routes: the run row and
    its cascaded ``run_rows`` are removed outright (no soft-delete column).
    Unlike ``GET`` / ``PATCH`` there's no anonymous-unnamed carve-out — you
    only delete saved searches, which are named and already yours."""
    run = db.scalar(select(Run).where(Run.id == run_id))
    if run is None or run.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    db.delete(run)
    db.commit()
