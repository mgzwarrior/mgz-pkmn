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
- `DELETE /wishlists/{id}/items/{item_id}`  remove a card
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..auth.session import current_user_or_default
from ..db.models import User, Wishlist, WishlistItem
from ..db.session import get_db

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


class WishlistItemOut(BaseModel):
    id: int
    card: dict[str, Any]
    notes: str | None
    max_price: float | None
    added_at: str


class WishlistOut(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: str
    items: list[WishlistItemOut]


class WishlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class WishlistPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class WishlistItemCreate(BaseModel):
    # The verbatim card payload from a matched lookup row. The shape is
    # source-side and intentionally opaque — see ADR-0013.
    card: dict[str, Any]
    notes: str | None = None
    # Optional alert threshold — persisted but not yet wired to alerting.
    max_price: float | None = Field(default=None, ge=0)


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
        )
        for w, item_count in db.execute(stmt).all()
    ]
    return {"items": [item.model_dump() for item in items], "total": len(items)}


@router.post("/wishlists", status_code=201)
def create_wishlist(req: WishlistCreate, db: DbSession, current_user: CurrentUser) -> dict:
    wishlist = Wishlist(
        user_id=current_user.id,
        name=req.name.strip(),
        description=req.description,
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
    item = WishlistItem(
        wishlist_id=wishlist.id,
        card_json=req.card,
        notes=req.notes,
        max_price=req.max_price,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize_item(item)


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
    )
