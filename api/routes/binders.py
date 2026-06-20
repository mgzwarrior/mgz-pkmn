"""`/api/v1/binders` — physical binders the collector owns (#702).

A binder is inventory-level: a real binder you own, carrying its physical
identity (``binder_format`` / ``binder_color`` / ``binder_type`` /
``capacity``), that holds zero or more collections via
``Collection.binder_id``. You can own an empty binder (one with no
collections filed in it yet) and fill it later.

Deleting a binder detaches its collections (the FK is ``ON DELETE SET NULL``)
rather than removing them — the cards live on the collections, not the binder.
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..auth.session import current_user_or_default
from ..db.models import (
    BINDER_COLORS,
    BINDER_FORMATS,
    BINDER_TYPES,
    Binder,
    CollectionItem,
    User,
)
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]

#: Freeform cover color: a ``#rrggbb`` hex (#681); presets validate against
#: :data:`BINDER_COLORS`.
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class BinderCollectionOut(BaseModel):
    """A collection filed in a binder, with its fill counts."""

    id: int
    name: str
    item_count: int
    total_quantity: int


class BinderSummaryOut(BaseModel):
    """Lightweight binder record for the inventory list view."""

    id: int
    name: str
    created_at: str
    binder_format: str | None
    binder_color: str | None
    binder_type: str | None
    capacity: int | None
    collection_count: int
    #: ``True`` when no collections are filed in this binder yet — the "own a
    #: binder before you fill it" case the inventory view surfaces.
    is_empty: bool


class BinderOut(BinderSummaryOut):
    collections: list[BinderCollectionOut]


class BinderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    binder_format: str | None = None
    binder_color: str | None = None
    binder_type: str | None = None
    capacity: int | None = Field(default=None, ge=1)


class BinderPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    binder_format: str | None = None
    binder_color: str | None = None
    binder_type: str | None = None
    capacity: int | None = Field(default=None, ge=1)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _validate_identity(
    binder_format: str | None,
    binder_color: str | None,
    binder_type: str | None,
) -> None:
    if binder_format is not None and binder_format not in BINDER_FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"unknown binder_format '{binder_format}'; allowed: {', '.join(BINDER_FORMATS)}",
        )
    if (
        binder_color is not None
        and binder_color not in BINDER_COLORS
        and not _HEX_COLOR_RE.match(binder_color)
    ):
        raise HTTPException(
            status_code=422,
            detail=f"unknown binder_color '{binder_color}'; use a preset ({', '.join(BINDER_COLORS)}) or a #rrggbb hex",
        )
    if binder_type is not None and binder_type not in BINDER_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"unknown binder_type '{binder_type}'; allowed: {', '.join(BINDER_TYPES)}",
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_binder(db: Session, binder_id: int, user_id: int) -> Binder:
    binder = db.scalar(
        select(Binder)
        .where(Binder.id == binder_id, Binder.user_id == user_id)
        .options(selectinload(Binder.collections))
    )
    if binder is None:
        raise HTTPException(status_code=404, detail=f"binder {binder_id} not found")
    return binder


def _fill_counts(db: Session, collection_ids: list[int]) -> dict[int, tuple[int, int]]:
    """Per-collection ``(item_count, total_quantity)`` for the given ids."""
    if not collection_ids:
        return {}
    rows = db.execute(
        select(
            CollectionItem.collection_id,
            func.count(CollectionItem.id),
            func.coalesce(func.sum(CollectionItem.quantity), 0),
        )
        .where(CollectionItem.collection_id.in_(collection_ids))
        .group_by(CollectionItem.collection_id)
    ).all()
    return {cid: (int(count), int(qty)) for cid, count, qty in rows}


def _serialize(db: Session, binder: Binder, *, include_collections: bool) -> dict[str, Any]:
    collections = sorted(binder.collections, key=lambda c: c.created_at)
    base: dict[str, Any] = {
        "id": binder.id,
        "name": binder.name,
        "created_at": binder.created_at.isoformat(),
        "binder_format": binder.binder_format,
        "binder_color": binder.binder_color,
        "binder_type": binder.binder_type,
        "capacity": binder.capacity,
        "collection_count": len(collections),
        "is_empty": len(collections) == 0,
    }
    if not include_collections:
        return base
    counts = _fill_counts(db, [c.id for c in collections])
    base["collections"] = [
        {
            "id": c.id,
            "name": c.name,
            "item_count": counts.get(c.id, (0, 0))[0],
            "total_quantity": counts.get(c.id, (0, 0))[1],
        }
        for c in collections
    ]
    return base


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/binders")
def list_binders(db: DbSession, current_user: CurrentUser) -> dict:
    binders = db.scalars(
        select(Binder)
        .where(Binder.user_id == current_user.id)
        .options(selectinload(Binder.collections))
        .order_by(Binder.created_at)
    ).all()
    return {"binders": [_serialize(db, b, include_collections=False) for b in binders]}


@router.post("/binders", status_code=201)
def create_binder(req: BinderCreate, db: DbSession, current_user: CurrentUser) -> dict:
    _validate_identity(req.binder_format, req.binder_color, req.binder_type)
    binder = Binder(
        user_id=current_user.id,
        name=req.name.strip(),
        binder_format=req.binder_format,
        binder_color=req.binder_color,
        binder_type=req.binder_type,
        capacity=req.capacity,
    )
    db.add(binder)
    db.commit()
    db.refresh(binder)
    return _serialize(db, binder, include_collections=True)


@router.get("/binders/{binder_id}")
def get_binder(binder_id: int, db: DbSession, current_user: CurrentUser) -> dict:
    binder = _load_binder(db, binder_id, current_user.id)
    return _serialize(db, binder, include_collections=True)


@router.patch("/binders/{binder_id}")
def patch_binder(
    binder_id: int,
    req: BinderPatch,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    binder = _load_binder(db, binder_id, current_user.id)
    fields = req.model_dump(exclude_unset=True)
    _validate_identity(
        fields.get("binder_format", binder.binder_format),
        fields.get("binder_color", binder.binder_color),
        fields.get("binder_type", binder.binder_type),
    )
    if "name" in fields and fields["name"] is not None:
        binder.name = fields["name"].strip()
    for key in ("binder_format", "binder_color", "binder_type", "capacity"):
        if key in fields:
            setattr(binder, key, fields[key])
    db.commit()
    db.refresh(binder)
    return _serialize(db, binder, include_collections=True)


@router.delete("/binders/{binder_id}", status_code=204)
def delete_binder(binder_id: int, db: DbSession, current_user: CurrentUser) -> None:
    binder = _load_binder(db, binder_id, current_user.id)
    # Detach filed collections (the cards live on them, not the binder) before
    # the row goes — explicit so the ORM identity map agrees with the FK's
    # ON DELETE SET NULL, regardless of backend.
    for collection in binder.collections:
        collection.binder_id = None
    db.delete(binder)
    db.commit()
