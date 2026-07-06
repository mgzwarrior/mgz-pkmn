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

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth.session import current_user_or_default
from ..db.card_payload import extract_card_identity, extract_price_snapshot
from ..db.defaults import (
    get_or_create_default_collection,
    get_or_create_default_wishlist,
)
from ..db.models import (
    ADDED_VIA_QUICK,
    COLLECTION_PURPOSE_PERSONAL,
    Collection,
    CollectionItem,
    User,
    Wishlist,
    WishlistItem,
)
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
    #: #707 — one of ``personal`` / ``trade`` / ``bulk``. Lets the SPA count
    #: only ``personal`` toward the "owned" badge and surface trade/bulk
    #: occupancy distinctly (e.g. "1 for trade") instead of hiding it.
    purpose: str


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
            Collection.purpose,
        )
        .join(Collection, CollectionItem.collection_id == Collection.id)
        .where(
            Collection.user_id == current_user.id,
            CollectionItem.card_set_id.in_(set_ids),
        )
    ).all()
    for set_id, number, coll_id, coll_name, quantity, purpose in coll_rows:
        if (set_id, number) not in requested:
            continue
        key = _key(set_id, number)
        per_collection = collections.setdefault(key, {})
        existing = per_collection.get(coll_id)
        if existing is None:
            per_collection[coll_id] = CollectionOccupancy(
                id=coll_id, name=coll_name, quantity=quantity or 0, purpose=purpose
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
            # Only active chases count as "wanted" — an acquired item is a
            # completed chase kept for history (ADR-0025), not a live want
            # (#768).
            WishlistItem.acquired_at.is_(None),
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


# ---------------------------------------------------------------------------
# Quick actions (#760, ADR-0027) — one-tap want / own against the user's
# default wishlist + collection, with no picker. Idempotent: re-tapping is a
# no-op, and each endpoint returns the card's derived state so the SPA can
# confirm immediately.
# ---------------------------------------------------------------------------


class CardActionRequest(BaseModel):
    #: The verbatim card payload, same shape the save/bulk endpoints take. The
    #: promoted ``(set_id, number)`` identity is re-extracted from it here.
    card: dict[str, Any]


class CardState(BaseModel):
    """A single card's derived library state after a quick action."""

    set_id: str | None
    number: str | None
    #: Derived view flags (ADR-0027): on any wishlist / in any collection.
    wanted: bool
    owned: bool
    collections: list[CollectionOccupancy]
    wishlists: list[WishlistOccupancy]


def _identity(card: dict[str, Any]) -> tuple[str | None, str | None]:
    promoted = extract_card_identity(card)
    return promoted.get("card_set_id"), promoted.get("card_number")


def _card_state(db: Session, user_id: int, set_id: str | None, number: str | None) -> CardState:
    """The card's occupancy across the user's collections + wishlists — the
    single-card sibling of :func:`card_ownership`."""
    collections: dict[int, CollectionOccupancy] = {}
    if set_id is not None and number is not None:
        coll_rows = db.execute(
            select(Collection.id, Collection.name, CollectionItem.quantity, Collection.purpose)
            .join(CollectionItem, CollectionItem.collection_id == Collection.id)
            .where(
                Collection.user_id == user_id,
                CollectionItem.card_set_id == set_id,
                CollectionItem.card_number == number,
            )
        ).all()
        for coll_id, coll_name, quantity, purpose in coll_rows:
            existing = collections.get(coll_id)
            if existing is None:
                collections[coll_id] = CollectionOccupancy(
                    id=coll_id, name=coll_name, quantity=quantity or 0, purpose=purpose
                )
            else:
                existing.quantity += quantity or 0

        wish_rows = db.execute(
            select(Wishlist.id, Wishlist.name)
            .join(WishlistItem, WishlistItem.wishlist_id == Wishlist.id)
            .where(
                Wishlist.user_id == user_id,
                WishlistItem.card_set_id == set_id,
                WishlistItem.card_number == number,
                # Active chases only — an acquired item is history, not a live
                # want (#768).
                WishlistItem.acquired_at.is_(None),
            )
        ).all()
    else:
        wish_rows = []

    wishlists: dict[int, WishlistOccupancy] = {}
    for wish_id, wish_name in wish_rows:
        wishlists.setdefault(wish_id, WishlistOccupancy(id=wish_id, name=wish_name))

    # #707 — only a personal-purpose collection reads as "owned"; trade/bulk
    # occupancy still renders (in `collections`), just doesn't flip the flag.
    personal_owned = any(c.purpose == COLLECTION_PURPOSE_PERSONAL for c in collections.values())
    return CardState(
        set_id=set_id,
        number=number,
        wanted=bool(wishlists),
        owned=personal_owned,
        collections=list(collections.values()),
        wishlists=list(wishlists.values()),
    )


def _wishlist_item(
    db: Session,
    wishlist_id: int,
    set_id: str | None,
    number: str | None,
    *,
    acquired: bool,
) -> WishlistItem | None:
    """The default-wishlist row for a card, filtered to active chases
    (``acquired=False``) or completed ones (``acquired=True``)."""
    if set_id is None or number is None:
        return None
    cond = WishlistItem.acquired_at.is_not(None) if acquired else WishlistItem.acquired_at.is_(None)
    return db.scalar(
        select(WishlistItem).where(
            WishlistItem.wishlist_id == wishlist_id,
            WishlistItem.card_set_id == set_id,
            WishlistItem.card_number == number,
            cond,
        )
    )


def _default_collection_item(
    db: Session, collection_id: int, set_id: str | None, number: str | None
) -> CollectionItem | None:
    if set_id is None or number is None:
        return None
    return db.scalar(
        select(CollectionItem).where(
            CollectionItem.collection_id == collection_id,
            CollectionItem.card_set_id == set_id,
            CollectionItem.card_number == number,
        )
    )


@router.post("/cards/want")
def want_card(req: CardActionRequest, db: DbSession, current_user: CurrentUser) -> dict:
    """Want a card on the user's default wishlist — an active chase.

    Idempotent for an already-active want. If the only item is an *acquired*
    one (the card was wanted, then owned), re-wanting reactivates that row
    rather than minting a duplicate — the explicit "I own one but want another"
    path (#768)."""
    wishlist = get_or_create_default_wishlist(db, current_user.id)
    set_id, number = _identity(req.card)
    # An active want already covers this card → nothing to do (and don't touch
    # any acquired history row).
    if _wishlist_item(db, wishlist.id, set_id, number, acquired=False) is None:
        acquired = _wishlist_item(db, wishlist.id, set_id, number, acquired=True)
        if acquired is not None:
            acquired.acquired_at = None
            acquired.acquired_collection_item_id = None
        else:
            price = extract_price_snapshot(req.card)
            db.add(
                WishlistItem(
                    wishlist_id=wishlist.id,
                    card_json=req.card,
                    price_snapshot=price,
                    priced_at=datetime.now(UTC) if price is not None else None,
                    **extract_card_identity(req.card),
                )
            )
    db.commit()
    return _card_state(db, current_user.id, set_id, number).model_dump()


@router.post("/cards/unwant")
def unwant_card(req: CardActionRequest, db: DbSession, current_user: CurrentUser) -> dict:
    """Drop a card's active chase from the user's default wishlist.

    Only removes an active want — an acquired item is kept as history (its chase
    already completed), so this never erases the "I got it" record (#768)."""
    wishlist = get_or_create_default_wishlist(db, current_user.id)
    set_id, number = _identity(req.card)
    item = _wishlist_item(db, wishlist.id, set_id, number, acquired=False)
    if item is not None:
        db.delete(item)
    db.commit()
    return _card_state(db, current_user.id, set_id, number).model_dump()


@router.post("/cards/own")
def own_card(req: CardActionRequest, db: DbSession, current_user: CurrentUser) -> dict:
    """Add a card to the user's default personal collection. Idempotent.

    Preserves the chase lifecycle (ADR-0025/0027): any unacquired wishlist item
    for this card is stamped with ``acquired_at`` + a back-pointer to the new
    collection item, so the want-list keeps doubling as a retrospective."""
    collection = get_or_create_default_collection(db, current_user.id)
    set_id, number = _identity(req.card)
    item = _default_collection_item(db, collection.id, set_id, number)
    if item is None:
        price = extract_price_snapshot(req.card)
        item = CollectionItem(
            collection_id=collection.id,
            card_json=req.card,
            quantity=1,
            added_via=ADDED_VIA_QUICK,
            price_snapshot=price,
            priced_at=datetime.now(UTC) if price is not None else None,
            **extract_card_identity(req.card),
        )
        db.add(item)
        db.flush()
        _stamp_acquired(db, current_user.id, set_id, number, item.id)
    db.commit()
    return _card_state(db, current_user.id, set_id, number).model_dump()


@router.post("/cards/unown")
def unown_card(req: CardActionRequest, db: DbSession, current_user: CurrentUser) -> dict:
    """Remove a card from the user's default collection. No-op if not in it.

    Reverses any promotion stamp pointing at the removed item, so a card the
    user had marked owned shows as chasing again."""
    collection = get_or_create_default_collection(db, current_user.id)
    set_id, number = _identity(req.card)
    item = _default_collection_item(db, collection.id, set_id, number)
    if item is not None:
        _unstamp_acquired(db, item.id)
        db.delete(item)
    db.commit()
    return _card_state(db, current_user.id, set_id, number).model_dump()


def _stamp_acquired(
    db: Session, user_id: int, set_id: str | None, number: str | None, collection_item_id: int
) -> None:
    """Mark the chase complete on every unacquired wishlist item for this card."""
    if set_id is None or number is None:
        return
    now = datetime.now(UTC)
    items = db.scalars(
        select(WishlistItem)
        .join(Wishlist, WishlistItem.wishlist_id == Wishlist.id)
        .where(
            Wishlist.user_id == user_id,
            WishlistItem.card_set_id == set_id,
            WishlistItem.card_number == number,
            WishlistItem.acquired_at.is_(None),
        )
    ).all()
    for wl_item in items:
        wl_item.acquired_at = now
        wl_item.acquired_collection_item_id = collection_item_id


def _unstamp_acquired(db: Session, collection_item_id: int) -> None:
    """Clear the promotion stamp on any wishlist item pointing at this item."""
    items = db.scalars(
        select(WishlistItem).where(WishlistItem.acquired_collection_item_id == collection_item_id)
    ).all()
    for wl_item in items:
        wl_item.acquired_at = None
        wl_item.acquired_collection_item_id = None
