"""`/api/v1/swipe` — library-aware swipe-deck memory + exclusion (#581).

Two controls for the swipe discovery surface, both per-user and durable:

1. **No-repeat memory.** Every card shown is recorded in ``swipe_seen``;
   the SPA folds the persisted set into its candidate filter so a card
   never resurfaces across sessions until the deck is reset.
2. **Library-aware exclusion.** Opt-in flags fold the user's owned
   (``collection_items``) and chased (``wishlist_items``) cards into the
   same exclusion set, so the deck stops serving cards already catalogued.

All three sources share the promoted ``(card_set_id, card_number)``
identity from the #574 rework, so the exclusion is a single union keyed
on that pair. The SPA still samples client-side; this endpoint only hands
back *which* identities to skip.

Endpoints:

- ``GET    /swipe/excluded``  identities to skip (seen + owned? + chasing?)
- ``POST   /swipe/seen``      record one shown card (idempotent)
- ``DELETE /swipe/seen``      reset the deck (all, one set, or one card, #945)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth.session import current_user_or_default
from ..db.models import (
    Collection,
    CollectionItem,
    SwipeSeen,
    User,
    Wishlist,
    WishlistItem,
)
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class CardIdentity(BaseModel):
    """The promoted ``(set_id, number)`` pair the SPA keys exclusion on."""

    set_id: str
    number: str


class SwipeSeenCreate(BaseModel):
    set_id: str = Field(min_length=1, max_length=64)
    number: str = Field(min_length=1, max_length=16)
    # The decision that retired the card. Free-form on the wire (the SPA
    # sends pass / save / love); stored verbatim, truncated to the column.
    dir: str | None = Field(default=None, max_length=8)


class ExcludedOut(BaseModel):
    cards: list[CardIdentity]
    total: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/swipe/excluded")
def list_excluded(
    db: DbSession,
    current_user: CurrentUser,
    owned: Annotated[bool, Query()] = False,
    chasing: Annotated[bool, Query()] = False,
) -> dict:
    """Identities the swipe deck should skip for the current user.

    Always includes the persisted ``swipe_seen`` set. ``owned`` folds in
    cards in any of the user's collections; ``chasing`` folds in cards on
    any of their wishlists. Only rows whose promoted identity is fully
    populated (both ``card_set_id`` and ``card_number`` non-null) can be
    matched against a candidate, so partial rows are skipped."""
    pairs: set[tuple[str, str]] = set()

    seen_rows = db.execute(
        select(SwipeSeen.card_set_id, SwipeSeen.card_number).where(
            SwipeSeen.user_id == current_user.id
        )
    ).all()
    pairs.update((s, n) for s, n in seen_rows if s and n)

    if owned:
        owned_rows = db.execute(
            select(CollectionItem.card_set_id, CollectionItem.card_number)
            .join(Collection, CollectionItem.collection_id == Collection.id)
            .where(Collection.user_id == current_user.id)
        ).all()
        pairs.update((s, n) for s, n in owned_rows if s and n)

    if chasing:
        chasing_rows = db.execute(
            select(WishlistItem.card_set_id, WishlistItem.card_number)
            .join(Wishlist, WishlistItem.wishlist_id == Wishlist.id)
            .where(
                Wishlist.user_id == current_user.id,
                # Active chases only — an acquired item is owned, not chasing,
                # so it shouldn't be excluded under chasing alone (#768).
                WishlistItem.acquired_at.is_(None),
            )
        ).all()
        pairs.update((s, n) for s, n in chasing_rows if s and n)

    cards = [CardIdentity(set_id=s, number=n) for s, n in pairs]
    return ExcludedOut(cards=cards, total=len(cards)).model_dump()


@router.post("/swipe/seen", status_code=204)
def record_seen(
    req: SwipeSeenCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Record one shown card. Idempotent: re-seeing a card is a no-op.

    The unique constraint on ``(user_id, card_set_id, card_number)`` is
    the source of truth — a concurrent duplicate insert raises
    ``IntegrityError``, which we swallow so the call still reports success
    (the card is, after all, already recorded as seen)."""
    row = SwipeSeen(
        user_id=current_user.id,
        card_set_id=req.set_id,
        card_number=req.number,
        swipe_dir=req.dir,
        seen_at=datetime.now(UTC),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return Response(status_code=204)


@router.delete("/swipe/seen", status_code=204)
def reset_seen(
    db: DbSession,
    current_user: CurrentUser,
    set_id: Annotated[str | None, Query()] = None,
    number: Annotated[str | None, Query()] = None,
) -> Response:
    """Clear the user's seen memory — the whole deck, one set, or one card.

    Scoping to a set (``?set_id=sv8``) is the future-proofing nicety from
    #581: "reset Crown Zenith" without nuking the rest of the history.
    Scoping further to a single card (``?set_id=sv8&number=100``) is #945:
    "stop hiding just this one card I skipped by accident" without
    resetting the whole set. ``number`` alone is rejected — it isn't a
    unique identity without ``set_id``."""
    if number is not None and set_id is None:
        raise HTTPException(status_code=422, detail="number requires set_id")
    stmt = delete(SwipeSeen).where(SwipeSeen.user_id == current_user.id)
    if set_id is not None:
        stmt = stmt.where(SwipeSeen.card_set_id == set_id)
    if number is not None:
        stmt = stmt.where(SwipeSeen.card_number == number)
    db.execute(stmt)
    db.commit()
    return Response(status_code=204)
