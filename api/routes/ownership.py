"""`/api/v1/cards/ownership` — cross-collection ownership lookup (#576).

The collections-rethink RFC (#501) turns durable inventory into something
the rest of the product can see: every card shown in search / browse /
swipe results carries an inline badge — "owned 2x in Show Binder · 1x in
Trade Stock", "chasing on Allentown want-list" — so a vendor pricing comps
doesn't re-add a card they already own and a collector doesn't chase the
same card twice.

This is the read side of that. The SPA batches the identities on a page
into one `POST`, and gets back the per-card occupancy across the user's
collections + wishlists. Keyed on the promoted ``(card_set_id,
card_number)`` identity from the #574 rework — the sibling of the
library-aware swipe exclusion (#581), which unions the same shape.

Endpoint:

- ``POST /cards/ownership``  per-card occupancy for a batch of identities
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth.session import current_user_or_default
from ..db.models import Collection, CollectionItem, User, Wishlist, WishlistItem
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]

#: Upper bound on the batch — a single results page is well under this.
#: Caps the work a single request can ask for.
MAX_CARDS = 500


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class CardIdentity(BaseModel):
    set_id: str
    number: str


class OwnershipQuery(BaseModel):
    cards: list[CardIdentity] = Field(default_factory=list, max_length=MAX_CARDS)


class CollectionOccupancy(BaseModel):
    id: int
    name: str
    quantity: int


class WishlistOccupancy(BaseModel):
    id: int
    name: str


class CardOwnership(BaseModel):
    collections: list[CollectionOccupancy]
    wishlists: list[WishlistOccupancy]


class OwnershipOut(BaseModel):
    #: Sparse map keyed by ``"<set_id>::<number>"``. Cards with no
    #: occupancy are omitted, so the SPA renders a badge only when the key
    #: is present.
    ownership: dict[str, CardOwnership]


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


def _key(set_id: str, number: str) -> str:
    """Stable map key for a ``(set_id, number)`` pair. Colon-joined so the
    two segments can't run together ambiguously — mirrors the SPA's
    ``exclusionKey`` from the swipe surface (#581)."""
    return f"{set_id}::{number}"


@router.post("/cards/ownership")
def card_ownership(
    req: OwnershipQuery,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Per-card occupancy across the user's collections + wishlists.

    Returns a sparse map: only cards the user owns or is chasing appear.
    Quantities are summed across a collection's items, so a card added
    twice to one binder reports ``quantity: 2`` rather than two rows.

    The query is scoped to the set ids present in the request, then matched
    exactly on ``(card_set_id, card_number)`` in Python — bounded work that
    stays portable across SQLite / Postgres without a tuple-``IN``."""
    requested = {(c.set_id, c.number) for c in req.cards}
    if not requested:
        return OwnershipOut(ownership={}).model_dump()

    set_ids = {set_id for set_id, _ in requested}

    # (key, collection_id) -> [name, summed quantity]; insertion order
    # preserved so the badge lists collections in a stable order.
    collections: dict[str, dict[int, CollectionOccupancy]] = {}
    coll_rows = db.execute(
        select(
            CollectionItem.card_set_id,
            CollectionItem.card_number,
            Collection.id,
            Collection.name,
            CollectionItem.quantity,
        )
        .join(Collection, CollectionItem.collection_id == Collection.id)
        .where(
            Collection.user_id == current_user.id,
            CollectionItem.card_set_id.in_(set_ids),
        )
    ).all()
    for set_id, number, coll_id, coll_name, quantity in coll_rows:
        if (set_id, number) not in requested:
            continue
        key = _key(set_id, number)
        per_collection = collections.setdefault(key, {})
        existing = per_collection.get(coll_id)
        if existing is None:
            per_collection[coll_id] = CollectionOccupancy(
                id=coll_id, name=coll_name, quantity=quantity or 0
            )
        else:
            existing.quantity += quantity or 0

    wishlists: dict[str, dict[int, WishlistOccupancy]] = {}
    wish_rows = db.execute(
        select(
            WishlistItem.card_set_id,
            WishlistItem.card_number,
            Wishlist.id,
            Wishlist.name,
        )
        .join(Wishlist, WishlistItem.wishlist_id == Wishlist.id)
        .where(
            Wishlist.user_id == current_user.id,
            WishlistItem.card_set_id.in_(set_ids),
        )
    ).all()
    for set_id, number, wish_id, wish_name in wish_rows:
        if (set_id, number) not in requested:
            continue
        key = _key(set_id, number)
        per_wishlist = wishlists.setdefault(key, {})
        per_wishlist.setdefault(wish_id, WishlistOccupancy(id=wish_id, name=wish_name))

    ownership: dict[str, CardOwnership] = {}
    for key in set(collections) | set(wishlists):
        ownership[key] = CardOwnership(
            collections=list(collections.get(key, {}).values()),
            wishlists=list(wishlists.get(key, {}).values()),
        )
    return OwnershipOut(ownership=ownership).model_dump()
