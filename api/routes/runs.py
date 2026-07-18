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
CARD_CONDITIONS = {"NM", "LP", "MP", "HP"}

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


class RunRowConditionRequest(BaseModel):
    """Body for PATCH /runs/{id}/rows/{position}/condition.

    `condition=None` clears the explicit row override and removes the
    derived browser-side condition price fields from `pricing_json`.
    `condition_multiplier` is browser-supplied (the Settings drawer lets a
    user customize it per condition tier, and the server has no copy of
    that config) but `adjusted_market` is always recomputed server-side
    from the row's own `market_price` — never trusted verbatim from the
    client — so a stale or manipulated client value can't get persisted."""

    condition: str | None = None
    condition_multiplier: float | None = Field(default=None, ge=0)


class RunRowOverrideRequest(BaseModel):
    """Body for PATCH /runs/{id}/rows/{position}/override.

    `value=None` clears the manual price override (#266), reverting the row
    to its live market price. `value` is otherwise the price a reviewer has
    decided to use instead of whatever the source returned."""

    value: float | None = Field(default=None, ge=0)


def _run_visible_to_current_user(run: Run, current_user: User) -> bool:
    return run.user_id == current_user.id or (run.user_id == DEFAULT_USER_ID and run.name is None)


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
    if not _run_visible_to_current_user(run, current_user):
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


@router.patch("/runs/{run_id}/rows/{position}/condition")
def update_run_row_condition(
    run_id: int,
    position: int,
    req: RunRowConditionRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Persist or clear one row's explicit condition override.

    The run-row already owns opaque `pricing_json`, so condition pricing can
    round-trip through saved searches without a schema migration. Raw market
    columns stay unchanged; the adjusted value remains an export/UI field."""
    run = db.scalar(select(Run).where(Run.id == run_id))
    if run is None or not _run_visible_to_current_user(run, current_user):
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    row = db.scalar(select(RunRow).where(RunRow.run_id == run.id, RunRow.position == position))
    if row is None:
        raise HTTPException(status_code=404, detail=f"run row {position} not found")

    pricing = dict(row.pricing_json or {})
    if req.condition is None:
        pricing.pop("condition", None)
        pricing.pop("condition_multiplier", None)
        pricing.pop("adjusted_market", None)
    else:
        condition = req.condition.strip().upper()
        if condition not in CARD_CONDITIONS:
            raise HTTPException(status_code=422, detail="condition must be NM, LP, MP, or HP")
        pricing["condition"] = condition
        pricing["condition_multiplier"] = req.condition_multiplier
        pricing["adjusted_market"] = (
            round(row.market_price * req.condition_multiplier, 2)
            if row.market_price is not None and req.condition_multiplier is not None
            else None
        )
    row.pricing_json = pricing
    db.commit()
    db.refresh(row)
    return RunRowOut(
        position=row.position,
        tag=row.tag,
        market_price=float(row.market_price) if row.market_price is not None else None,
        currency=row.currency,
        query=row.query_json,
        card=row.card_json,
        pricing=row.pricing_json,
    ).model_dump()


@router.patch("/runs/{run_id}/rows/{position}/override")
def update_run_row_override(
    run_id: int,
    position: int,
    req: RunRowOverrideRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Persist or clear one row's manual price override (#266).

    Stored in `pricing_json` alongside `condition`/`adjusted_market` so it
    round-trips through saved searches without a schema migration. Every
    reader of `Pricing.effective_market` / `market_or_override` picks the
    override up automatically — comps, exports, and the binder/checklist
    writers never need to know it exists."""
    run = db.scalar(select(Run).where(Run.id == run_id))
    if run is None or not _run_visible_to_current_user(run, current_user):
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    row = db.scalar(select(RunRow).where(RunRow.run_id == run.id, RunRow.position == position))
    if row is None:
        raise HTTPException(status_code=404, detail=f"run row {position} not found")

    pricing = dict(row.pricing_json or {})
    if req.value is None:
        pricing.pop("pricing_override", None)
    else:
        pricing["pricing_override"] = req.value
    row.pricing_json = pricing
    db.commit()
    db.refresh(row)
    return RunRowOut(
        position=row.position,
        tag=row.tag,
        market_price=float(row.market_price) if row.market_price is not None else None,
        currency=row.currency,
        query=row.query_json,
        card=row.card_json,
        pricing=row.pricing_json,
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
