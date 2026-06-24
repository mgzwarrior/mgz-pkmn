"""`/api/v1/wishlists` — user-named wishlists of cards they're hunting.

Fourth slice of [ADR-0013](../../docs/adr/0013-sqlite-persistence-for-runs-collections-wishlists.md).
Same shape as `/collections` (the third slice) but distinct semantics:
collections are "I own these", wishlists are "I want these". Splitting
the tables keeps downstream queries free of a discriminator column and
lets the schemas drift independently — wishlists carry a `max_price`
threshold on each item, collections don't.

Endpoints:

- `GET    /wishlists`                       list user's wishlists
- `POST   /wishlists`                       create
- `GET    /wishlists/{id}`                  full wishlist including items
- `PATCH  /wishlists/{id}`                  rename / edit description
- `DELETE /wishlists/{id}`                  cascade-delete items
- `POST   /wishlists/{id}/items`            add a card (optional max_price)
- `POST   /wishlists/{id}/items/bulk`       add many cards at once (#268)
- `DELETE /wishlists/{id}/items/{item_id}`  remove a card
- `POST   /wishlists/{id}/items/{item_id}/promote`  acquire → collection (#504)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..auth.session import current_user_or_default
from ..db.card_payload import extract_card_identity, extract_price_snapshot
from ..db.models import (
    ADDED_VIA_WISHLIST_PROMOTE,
    COLLECTION_KIND_DYNAMIC,
    Collection,
    CollectionItem,
    User,
    Wishlist,
    WishlistItem,
)
from ..db.session import get_db
from .collections import _require_owned_binder, serialize_collection_item

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class WishlistSummaryOut(BaseModel):
    """Lightweight wishlist record for the sidebar list view."""

    id: int
    name: str
    description: str | None
    created_at: str
    item_count: int
    #: The binder this want-list is filed into, or null when loose (#774).
    binder_id: int | None
    #: #759/#762 — the user's default `Want` target. The flag is the invariant,
    #: not the row: renaming keeps it, deleting re-establishes one lazily. The
    #: SPA shows a subtle "default" marker so a bare Want's destination is clear.
    is_default: bool


class WishlistItemOut(BaseModel):
    id: int
    card: dict[str, Any]
    notes: str | None
    max_price: float | None
    added_at: str
    # ---- v1.5 collections-rework fields (#574) ----
    card_set_id: str | None
    card_number: str | None
    card_name: str | None
    card_rarity: str | None
    card_types: list[str] | None
    card_image_url: str | None
    price_snapshot: float | None
    priced_at: str | None
    #: Lifecycle plumbing for the wishlist → collection promote (#504).
    #: Non-null once the user has marked the chase complete.
    acquired_at: str | None
    acquired_collection_item_id: int | None


class WishlistOut(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: str
    #: The binder this want-list is filed into, or null when loose (#774).
    binder_id: int | None
    items: list[WishlistItemOut]


class WishlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    #: File the new want-list into a binder on create (#774). Null leaves it
    #: loose; an unowned id is a 404 (see :func:`_require_owned_binder`).
    binder_id: int | None = None


class WishlistPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    #: Re-file (or, with null, unfile) the want-list (#774). Only applied when
    #: the key is present, so omitting it leaves the current binder untouched.
    binder_id: int | None = None


class WishlistItemCreate(BaseModel):
    # The verbatim card payload from a matched lookup row. The shape is
    # source-side and intentionally opaque — see ADR-0013.
    card: dict[str, Any]
    notes: str | None = None
    # Optional alert threshold — persisted but not yet wired to alerting.
    max_price: float | None = Field(default=None, ge=0)


class BulkWishlistItemsCreate(BaseModel):
    """Add a set of matched cards to a want-list in one call — the
    results-table "add selected to binder (chasing)" bulk action (#268).
    ``notes`` / ``max_price`` apply to every row in the batch."""

    cards: list[dict[str, Any]] = Field(min_length=1, max_length=500)
    notes: str | None = None
    max_price: float | None = Field(default=None, ge=0)


class BulkAddResult(BaseModel):
    """Count plus the created rows, so the SPA can bump item counts and
    invalidate the cross-surface ownership cache (#576) in one round-trip."""

    added: int
    items: list[WishlistItemOut]


class PromoteRequest(BaseModel):
    """Mark a chased card acquired and land it in a collection (#504)."""

    collection_id: int
    #: Vendor multiples on the resulting collection row. Default 1.
    quantity: int = Field(default=1, ge=1)
    #: Optional note stamped on the new collection item — a fresh
    #: annotation, not inherited from the wishlist row.
    notes: str | None = None


class PromoteResult(BaseModel):
    """Both sides of the transition: the now-acquired wishlist row and the
    collection row it produced."""

    wishlist_item: WishlistItemOut
    collection_item: dict[str, Any]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/wishlists")
def list_wishlists(db: DbSession, current_user: CurrentUser) -> dict:
    """Most-recent-first listing with item counts (no items payload)."""
    item_count_subq = (
        select(
            WishlistItem.wishlist_id,
            func.count(WishlistItem.id).label("item_count"),
        )
        .group_by(WishlistItem.wishlist_id)
        .subquery()
    )
    stmt = (
        select(
            Wishlist,
            func.coalesce(item_count_subq.c.item_count, 0).label("item_count"),
        )
        .outerjoin(item_count_subq, Wishlist.id == item_count_subq.c.wishlist_id)
        .where(Wishlist.user_id == current_user.id)
        .order_by(Wishlist.created_at.desc(), Wishlist.id.desc())
    )
    items = [
        WishlistSummaryOut(
            id=w.id,
            name=w.name,
            description=w.description,
            created_at=w.created_at.isoformat(),
            item_count=int(item_count),
            binder_id=w.binder_id,
            is_default=w.is_default,
        )
        for w, item_count in db.execute(stmt).all()
    ]
    return {"items": [item.model_dump() for item in items], "total": len(items)}


@router.post("/wishlists", status_code=201)
def create_wishlist(req: WishlistCreate, db: DbSession, current_user: CurrentUser) -> dict:
    _require_owned_binder(db, req.binder_id, current_user.id)
    wishlist = Wishlist(
        user_id=current_user.id,
        name=req.name.strip(),
        description=req.description,
        binder_id=req.binder_id,
    )
    db.add(wishlist)
    db.commit()
    db.refresh(wishlist)
    return _serialize_wishlist(wishlist)


@router.get("/wishlists/{wishlist_id}")
def get_wishlist(wishlist_id: int, db: DbSession, current_user: CurrentUser) -> dict:
    wishlist = _load_wishlist(db, wishlist_id, current_user.id)
    return _serialize_wishlist(wishlist)


@router.patch("/wishlists/{wishlist_id}")
def patch_wishlist(
    wishlist_id: int,
    req: WishlistPatch,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    wishlist = _load_wishlist(db, wishlist_id, current_user.id)
    if req.name is not None:
        wishlist.name = req.name.strip()
    # `description` is patched whenever the caller includes the key —
    # passing `null` clears it. `model_fields_set` distinguishes "omitted"
    # from "explicitly null" since Pydantic collapses both to None.
    if "description" in req.model_fields_set:
        wishlist.description = req.description
    # File / re-file / unfile only when the caller sends the key (#774);
    # passing `null` detaches, mirroring the collections patch path.
    if "binder_id" in req.model_fields_set:
        _require_owned_binder(db, req.binder_id, current_user.id)
        wishlist.binder_id = req.binder_id
    db.commit()
    db.refresh(wishlist)
    return _serialize_wishlist(wishlist)


@router.delete("/wishlists/{wishlist_id}", status_code=204)
def delete_wishlist(wishlist_id: int, db: DbSession, current_user: CurrentUser) -> None:
    wishlist = _load_wishlist(db, wishlist_id, current_user.id)
    db.delete(wishlist)
    db.commit()


@router.post("/wishlists/{wishlist_id}/items", status_code=201)
def add_wishlist_item(
    wishlist_id: int,
    req: WishlistItemCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    wishlist = _load_wishlist(db, wishlist_id, current_user.id)
    promoted = extract_card_identity(req.card)
    price = extract_price_snapshot(req.card)
    item = WishlistItem(
        wishlist_id=wishlist.id,
        card_json=req.card,
        notes=req.notes,
        max_price=req.max_price,
        price_snapshot=price,
        priced_at=datetime.now(UTC) if price is not None else None,
        **promoted,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize_item(item)


@router.post("/wishlists/{wishlist_id}/items/bulk", status_code=201)
def add_wishlist_items_bulk(
    wishlist_id: int,
    req: BulkWishlistItemsCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Add every card in ``req.cards`` to the want-list in one transaction —
    same per-card handling as the single :func:`add_wishlist_item`."""
    wishlist = _load_wishlist(db, wishlist_id, current_user.id)
    now = datetime.now(UTC)
    items: list[WishlistItem] = []
    for card in req.cards:
        promoted = extract_card_identity(card)
        price = extract_price_snapshot(card)
        items.append(
            WishlistItem(
                wishlist_id=wishlist.id,
                card_json=card,
                notes=req.notes,
                max_price=req.max_price,
                price_snapshot=price,
                priced_at=now if price is not None else None,
                **promoted,
            )
        )
    db.add_all(items)
    db.commit()
    for item in items:
        db.refresh(item)
    return BulkAddResult(
        added=len(items),
        items=[WishlistItemOut(**_serialize_item(i)) for i in items],
    ).model_dump()


@router.delete("/wishlists/{wishlist_id}/items/{item_id}", status_code=204)
def delete_wishlist_item(
    wishlist_id: int,
    item_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    # Scope the lookup through the parent wishlist so a guess-the-id
    # attack on another user's items 404s instead of leaking existence.
    wishlist = _load_wishlist(db, wishlist_id, current_user.id)
    item = db.scalar(
        select(WishlistItem).where(
            WishlistItem.id == item_id,
            WishlistItem.wishlist_id == wishlist.id,
        )
    )
    if item is None:
        raise HTTPException(
            status_code=404,
            detail=f"item {item_id} not found in wishlist {wishlist_id}",
        )
    db.delete(item)
    db.commit()


@router.delete("/wishlists/{wishlist_id}/items", status_code=204)
def delete_wishlist_items_by_card(
    wishlist_id: int,
    set_id: str,
    number: str,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    """Remove a card from a specific want-list by its ``(set_id, number)``
    identity — the card-detail "remove from this list" affordance (#762).

    Only drops *active* chases; an acquired item is kept as history (its chase
    already completed), mirroring ``/cards/unwant`` (#768). 404s when no active
    chase for the card is on the list."""
    wishlist = _load_wishlist(db, wishlist_id, current_user.id)
    items = db.scalars(
        select(WishlistItem).where(
            WishlistItem.wishlist_id == wishlist.id,
            WishlistItem.card_set_id == set_id,
            WishlistItem.card_number == number,
            WishlistItem.acquired_at.is_(None),
        )
    ).all()
    if not items:
        raise HTTPException(
            status_code=404,
            detail=f"card {set_id}-{number} not found on wishlist {wishlist_id}",
        )
    for item in items:
        db.delete(item)
    db.commit()


@router.post("/wishlists/{wishlist_id}/items/{item_id}/promote", status_code=201)
def promote_wishlist_item(
    wishlist_id: int,
    item_id: int,
    req: PromoteRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Close the chase: mark a wishlist item acquired and mint the owned
    collection row it becomes (#504).

    The wishlist row is *not* deleted — it's stamped with ``acquired_at`` and
    a back-pointer to the new ``collection_items`` row, so the want-list keeps
    doubling as a show retrospective ("here's what I was hunting, and here's
    what I landed"). Re-promoting an already-acquired item is a 409 rather than
    a second collection row."""
    # Scope the item lookup through the parent wishlist so a guess-the-id
    # attack on another user's items 404s instead of leaking existence.
    wishlist = _load_wishlist(db, wishlist_id, current_user.id)
    item = db.scalar(
        select(WishlistItem).where(
            WishlistItem.id == item_id,
            WishlistItem.wishlist_id == wishlist.id,
        )
    )
    if item is None:
        raise HTTPException(
            status_code=404,
            detail=f"item {item_id} not found in wishlist {wishlist_id}",
        )
    if item.acquired_at is not None:
        raise HTTPException(
            status_code=409,
            detail=f"item {item_id} is already acquired",
        )

    collection = db.scalar(
        select(Collection).where(
            Collection.id == req.collection_id,
            Collection.user_id == current_user.id,
        )
    )
    if collection is None:
        raise HTTPException(status_code=404, detail=f"collection {req.collection_id} not found")
    if collection.kind == COLLECTION_KIND_DYNAMIC:
        raise HTTPException(
            status_code=409,
            detail="dynamic collections are rule-defined; promote into a manual or set collection",
        )

    # Re-extract identity/price from the verbatim payload so the collection
    # row goes through the same single extractor as a manual add.
    promoted = extract_card_identity(item.card_json)
    price = extract_price_snapshot(item.card_json)
    collection_item = CollectionItem(
        collection_id=collection.id,
        card_json=item.card_json,
        notes=req.notes,
        quantity=req.quantity,
        added_via=ADDED_VIA_WISHLIST_PROMOTE,
        price_snapshot=price,
        priced_at=datetime.now(UTC) if price is not None else None,
        **promoted,
    )
    db.add(collection_item)
    db.flush()  # assign the id without ending the transaction

    item.acquired_at = datetime.now(UTC)
    item.acquired_collection_item_id = collection_item.id

    db.commit()
    db.refresh(item)
    db.refresh(collection_item)
    return PromoteResult(
        wishlist_item=_item_out(item),
        collection_item=serialize_collection_item(collection_item),
    ).model_dump()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_wishlist(db: Session, wishlist_id: int, user_id: int) -> Wishlist:
    wishlist = db.scalar(
        select(Wishlist)
        .where(
            Wishlist.id == wishlist_id,
            Wishlist.user_id == user_id,
        )
        .options(selectinload(Wishlist.items))
    )
    if wishlist is None:
        raise HTTPException(status_code=404, detail=f"wishlist {wishlist_id} not found")
    return wishlist


def _serialize_wishlist(wishlist: Wishlist) -> dict:
    return WishlistOut(
        id=wishlist.id,
        name=wishlist.name,
        description=wishlist.description,
        created_at=wishlist.created_at.isoformat(),
        binder_id=wishlist.binder_id,
        items=[_item_out(i) for i in wishlist.items],
    ).model_dump()


def _serialize_item(item: WishlistItem) -> dict:
    return _item_out(item).model_dump()


def _item_out(item: WishlistItem) -> WishlistItemOut:
    return WishlistItemOut(
        id=item.id,
        card=item.card_json,
        notes=item.notes,
        max_price=float(item.max_price) if item.max_price is not None else None,
        added_at=item.added_at.isoformat(),
        card_set_id=item.card_set_id,
        card_number=item.card_number,
        card_name=item.card_name,
        card_rarity=item.card_rarity,
        card_types=item.card_types_json,
        card_image_url=item.card_image_url,
        price_snapshot=(float(item.price_snapshot) if item.price_snapshot is not None else None),
        priced_at=item.priced_at.isoformat() if item.priced_at is not None else None,
        acquired_at=item.acquired_at.isoformat() if item.acquired_at is not None else None,
        acquired_collection_item_id=item.acquired_collection_item_id,
    )
