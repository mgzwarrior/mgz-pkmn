"""`/api/v1/collections` — user-named buckets for pinning matched cards.

Third slice of [ADR-0013](../../docs/adr/0013-sqlite-persistence-for-runs-collections-wishlists.md).
A collection is a flat list of cards a user wants to keep around across
runs — e.g. "Charizard masters", "binder candidates", "show pickups".
Card identity is stored verbatim from the matched payload (`card_json`)
because that's the only stable handle across re-lookups.

Endpoints:

- `GET    /collections`                       list user's collections
- `POST   /collections`                       create
- `GET    /collections/{id}`                  full collection including items
- `PATCH  /collections/{id}`                  rename / edit description
- `DELETE /collections/{id}`                  cascade-delete items
- `POST   /collections/{id}/items`            add a card
- `DELETE /collections/{id}/items/{item_id}`  remove a card
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db.models import DEFAULT_USER_ID, Collection, CollectionItem
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class CollectionSummaryOut(BaseModel):
    """Lightweight collection record for the sidebar list view."""

    id: int
    name: str
    description: str | None
    created_at: str
    item_count: int


class CollectionItemOut(BaseModel):
    id: int
    card: dict[str, Any]
    notes: str | None
    added_at: str


class CollectionOut(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: str
    items: list[CollectionItemOut]


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class CollectionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class CollectionItemCreate(BaseModel):
    # The verbatim card payload from a matched lookup row. The shape is
    # source-side and intentionally opaque — see ADR-0013.
    card: dict[str, Any]
    notes: str | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/collections")
def list_collections(db: DbSession) -> dict:
    """Most-recent-first listing with item counts (no items payload)."""
    item_count_subq = (
        select(
            CollectionItem.collection_id,
            func.count(CollectionItem.id).label("item_count"),
        )
        .group_by(CollectionItem.collection_id)
        .subquery()
    )
    stmt = (
        select(
            Collection,
            func.coalesce(item_count_subq.c.item_count, 0).label("item_count"),
        )
        .outerjoin(item_count_subq, Collection.id == item_count_subq.c.collection_id)
        .where(Collection.user_id == DEFAULT_USER_ID)
        .order_by(Collection.created_at.desc(), Collection.id.desc())
    )
    items = [
        CollectionSummaryOut(
            id=c.id,
            name=c.name,
            description=c.description,
            created_at=c.created_at.isoformat(),
            item_count=int(item_count),
        )
        for c, item_count in db.execute(stmt).all()
    ]
    return {"items": [item.model_dump() for item in items], "total": len(items)}


@router.post("/collections", status_code=201)
def create_collection(req: CollectionCreate, db: DbSession) -> dict:
    collection = Collection(
        user_id=DEFAULT_USER_ID,
        name=req.name.strip(),
        description=req.description,
    )
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return _serialize_collection(collection)


@router.get("/collections/{collection_id}")
def get_collection(collection_id: int, db: DbSession) -> dict:
    collection = _load_collection(db, collection_id)
    return _serialize_collection(collection)


@router.patch("/collections/{collection_id}")
def patch_collection(collection_id: int, req: CollectionPatch, db: DbSession) -> dict:
    collection = _load_collection(db, collection_id)
    if req.name is not None:
        collection.name = req.name.strip()
    # `description` is patched whenever the caller includes the key —
    # passing `null` clears it. `model_fields_set` distinguishes "omitted"
    # from "explicitly null" since Pydantic collapses both to None.
    if "description" in req.model_fields_set:
        collection.description = req.description
    db.commit()
    db.refresh(collection)
    return _serialize_collection(collection)


@router.delete("/collections/{collection_id}", status_code=204)
def delete_collection(collection_id: int, db: DbSession) -> None:
    collection = _load_collection(db, collection_id)
    db.delete(collection)
    db.commit()


@router.post("/collections/{collection_id}/items", status_code=201)
def add_collection_item(collection_id: int, req: CollectionItemCreate, db: DbSession) -> dict:
    collection = _load_collection(db, collection_id)
    item = CollectionItem(
        collection_id=collection.id,
        card_json=req.card,
        notes=req.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize_item(item)


@router.delete("/collections/{collection_id}/items/{item_id}", status_code=204)
def delete_collection_item(collection_id: int, item_id: int, db: DbSession) -> None:
    item = db.scalar(
        select(CollectionItem).where(
            CollectionItem.id == item_id,
            CollectionItem.collection_id == collection_id,
        )
    )
    if item is None:
        raise HTTPException(
            status_code=404,
            detail=f"item {item_id} not found in collection {collection_id}",
        )
    db.delete(item)
    db.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_collection(db: Session, collection_id: int) -> Collection:
    collection = db.scalar(
        select(Collection)
        .where(
            Collection.id == collection_id,
            Collection.user_id == DEFAULT_USER_ID,
        )
        .options(selectinload(Collection.items))
    )
    if collection is None:
        raise HTTPException(status_code=404, detail=f"collection {collection_id} not found")
    return collection


def _serialize_collection(collection: Collection) -> dict:
    return CollectionOut(
        id=collection.id,
        name=collection.name,
        description=collection.description,
        created_at=collection.created_at.isoformat(),
        items=[_item_out(i) for i in collection.items],
    ).model_dump()


def _serialize_item(item: CollectionItem) -> dict:
    return _item_out(item).model_dump()


def _item_out(item: CollectionItem) -> CollectionItemOut:
    return CollectionItemOut(
        id=item.id,
        card=item.card_json,
        notes=item.notes,
        added_at=item.added_at.isoformat(),
    )
