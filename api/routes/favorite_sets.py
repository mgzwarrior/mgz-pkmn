"""`/api/v1/favorite-sets` — per-user pinned favorite sets (#712).

Part of turning swipe into a personalization surface (#701). A favorite
set is an explicit, durable "I love this set" signal — distinct from the
localStorage swipe taste profile — that other surfaces (search defaults,
set ID cards, swipe candidate weighting) can read across devices.

Sets are referenced by their catalog id (``base1`` / ``sv4pt5``); the
friendly name is resolved client-side from the baked set catalog, so it
isn't stored or returned here.

Endpoints:

- ``GET    /favorite-sets``               the user's pinned set ids
- ``POST   /favorite-sets``               pin a set (idempotent)
- ``DELETE /favorite-sets/{set_id}``      unpin a set
- ``GET    /favorite-sets/suggestions``   sets to consider pinning, ranked
  by how many owned cards the user has in each — the server-side half of
  the suggestion (the SPA folds in its swipe signal client-side).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth.session import current_user_or_default
from ..db.models import (
    Collection,
    CollectionItem,
    FavoriteSet,
    User,
)
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]

#: Default cap on suggestion rows — enough to fill the panel without a long tail.
_SUGGESTION_LIMIT = 6


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class FavoriteSetOut(BaseModel):
    set_id: str
    pinned_at: str


class FavoriteSetsOut(BaseModel):
    sets: list[FavoriteSetOut]


class FavoriteSetCreate(BaseModel):
    set_id: str = Field(min_length=1, max_length=64)


class SuggestionOut(BaseModel):
    """One suggested set with the owned-card count behind the suggestion."""

    set_id: str
    owned_count: int


class SuggestionsOut(BaseModel):
    suggestions: list[SuggestionOut]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/favorite-sets")
def list_favorites(db: DbSession, current_user: CurrentUser) -> dict:
    """The user's pinned sets, newest first."""
    rows = db.execute(
        select(FavoriteSet.set_id, FavoriteSet.pinned_at)
        .where(FavoriteSet.user_id == current_user.id)
        .order_by(FavoriteSet.pinned_at.desc())
    ).all()
    sets = [FavoriteSetOut(set_id=s, pinned_at=p.isoformat()) for s, p in rows]
    return FavoriteSetsOut(sets=sets).model_dump()


@router.post("/favorite-sets", status_code=204)
def pin_favorite(
    req: FavoriteSetCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Pin a set. Idempotent: re-pinning is a no-op.

    The unique constraint on ``(user_id, set_id)`` is the source of truth —
    a concurrent duplicate insert raises ``IntegrityError``, which we
    swallow so the call still reports success (the set is already pinned)."""
    row = FavoriteSet(
        user_id=current_user.id,
        set_id=req.set_id,
        pinned_at=datetime.now(UTC),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return Response(status_code=204)


@router.delete("/favorite-sets/{set_id}", status_code=204)
def unpin_favorite(
    set_id: str,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Unpin a set. A no-op (still 204) when it wasn't pinned."""
    db.execute(
        delete(FavoriteSet).where(
            FavoriteSet.user_id == current_user.id,
            FavoriteSet.set_id == set_id,
        )
    )
    db.commit()
    return Response(status_code=204)


@router.get("/favorite-sets/suggestions")
def list_suggestions(
    db: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=50)] = _SUGGESTION_LIMIT,
) -> dict:
    """Sets the user might want to pin, ranked by owned-card count.

    Tallies the user's ``collection_items`` by ``card_set_id`` — the sets
    they've already invested a collection in are the strongest owned signal
    for a favorite — and drops any set they've already pinned. The SPA folds
    its own swipe ``set`` counter into this before rendering.

    Counts owned *copies* (``sum(quantity)``), not rows, so the rest of the
    collections model's quantity semantics hold — a single ``quantity: 10``
    row is ten owned, not one."""
    pinned = set(
        db.scalars(select(FavoriteSet.set_id).where(FavoriteSet.user_id == current_user.id)).all()
    )

    owned = func.coalesce(func.sum(CollectionItem.quantity), 0).label("owned")
    rows = db.execute(
        select(CollectionItem.card_set_id, owned)
        .join(Collection, CollectionItem.collection_id == Collection.id)
        .where(
            Collection.user_id == current_user.id,
            CollectionItem.card_set_id.is_not(None),
        )
        .group_by(CollectionItem.card_set_id)
        .order_by(owned.desc())
    ).all()

    suggestions = [
        SuggestionOut(set_id=set_id, owned_count=int(count))
        for set_id, count in rows
        if set_id not in pinned
    ][:limit]
    return SuggestionsOut(suggestions=suggestions).model_dump()
