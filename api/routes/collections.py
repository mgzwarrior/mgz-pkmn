"""`/api/v1/collections` — user-named buckets for pinning matched cards.

Third slice of [ADR-0013](../../docs/adr/0013-sqlite-persistence-for-runs-collections-wishlists.md).
A collection is a flat list of cards a user wants to keep around across
runs — e.g. "Charizard masters", "binder candidates", "show pickups".
Card identity is stored verbatim from the matched payload (`card_json`)
because that's the only stable handle across re-lookups.

A collection is one of three `kind`s (ADR-0025): `manual` (the default
flat bucket), `set` (anchored to a `source_set_id`), or `dynamic` — a
saved rule (`rule_json`) whose membership is the user's owned cards that
match it, recomputed lazily on read and never materialised as
`collection_items` rows. See `api/db/collection_rules.py` for the rule
schema and resolver.

Endpoints:

- `GET    /collections`                       list user's collections
- `POST   /collections`                       create (manual, set, or dynamic)
- `GET    /collections/{id}`                  full collection including items
- `PATCH  /collections/{id}`                  rename / edit description / rule
- `DELETE /collections/{id}`                  cascade-delete items
- `POST   /collections/{id}/items`            add a card (manual/set only)
- `DELETE /collections/{id}/items/{item_id}`  remove a card (manual/set only)
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
from ..db.collection_rules import (
    RuleValidationError,
    count_dynamic_items,
    normalize_rule,
    resolve_dynamic_items,
)
from ..db.models import (
    ADDED_VIA_MANUAL,
    COLLECTION_KIND_DYNAMIC,
    COLLECTION_KIND_MANUAL,
    COLLECTION_KIND_SET,
    Collection,
    CollectionItem,
    User,
)
from ..db.session import get_db

#: The kinds a caller may create. Mirrors the model constants; kept here so
#: the create/patch validators reject an unknown kind with a 422.
_VALID_KINDS = (COLLECTION_KIND_MANUAL, COLLECTION_KIND_SET, COLLECTION_KIND_DYNAMIC)

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]


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
    # ---- #506: kind + rule so the SPA can badge dynamic/set collections ----
    kind: str
    source_set_id: str | None
    rule: dict[str, Any] | None


class CollectionItemOut(BaseModel):
    id: int
    card: dict[str, Any]
    notes: str | None
    added_at: str
    # ---- v1.5 collections-rework fields (#574) ----
    quantity: int
    card_set_id: str | None
    card_number: str | None
    card_name: str | None
    card_rarity: str | None
    card_types: list[str] | None
    card_image_url: str | None
    price_snapshot: float | None
    priced_at: str | None
    added_via: str | None


class CollectionOut(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: str
    items: list[CollectionItemOut]
    # ---- #506 ----
    #: One of ``manual`` / ``set`` / ``dynamic``.
    kind: str
    #: Set anchor when ``kind == 'set'``, else null.
    source_set_id: str | None
    #: Membership rule when ``kind == 'dynamic'``, else null. For a dynamic
    #: collection ``items`` is the resolved, non-persisted membership.
    rule: dict[str, Any] | None


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    #: Defaults to ``manual`` so existing callers are unchanged. ``set``
    #: requires ``source_set_id``; ``dynamic`` requires ``rule``.
    kind: str = COLLECTION_KIND_MANUAL
    source_set_id: str | None = Field(default=None, max_length=64)
    rule: dict[str, Any] | None = None


class CollectionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    #: Editing a dynamic collection's rule re-points its membership. Only
    #: meaningful on ``kind == 'dynamic'`` collections.
    rule: dict[str, Any] | None = None


class CollectionItemCreate(BaseModel):
    # The verbatim card payload from a matched lookup row. The shape is
    # source-side and intentionally opaque — see ADR-0013. Promoted
    # identity columns are extracted server-side via
    # :func:`api.db.card_payload.extract_card_identity`.
    card: dict[str, Any]
    notes: str | None = None
    #: Vendor multiples. Default 1 keeps single-card calls unchanged.
    quantity: int = Field(default=1, ge=1)
    #: Provenance tag. Inserts default to ``manual``; callers like the
    #: wishlist promote endpoint (#504) and the haul mode (#509) override.
    added_via: str | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/collections")
def list_collections(db: DbSession, current_user: CurrentUser) -> dict:
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
        .where(Collection.user_id == current_user.id)
        .order_by(Collection.created_at.desc(), Collection.id.desc())
    )
    items = []
    for c, item_count in db.execute(stmt).all():
        # Dynamic collections own no rows — the join counts 0. Resolve the
        # rule against owned inventory so the badge reflects live membership.
        if c.kind == COLLECTION_KIND_DYNAMIC and c.rule_json:
            count = count_dynamic_items(db, current_user.id, c.rule_json)
        else:
            count = int(item_count)
        items.append(
            CollectionSummaryOut(
                id=c.id,
                name=c.name,
                description=c.description,
                created_at=c.created_at.isoformat(),
                item_count=count,
                kind=c.kind,
                source_set_id=c.source_set_id,
                rule=c.rule_json,
            )
        )
    return {"items": [item.model_dump() for item in items], "total": len(items)}


@router.post("/collections", status_code=201)
def create_collection(req: CollectionCreate, db: DbSession, current_user: CurrentUser) -> dict:
    if req.kind not in _VALID_KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"unknown kind '{req.kind}'; allowed: {', '.join(_VALID_KINDS)}",
        )
    source_set_id, rule_json = _validate_kind_fields(req.kind, req.source_set_id, req.rule)
    collection = Collection(
        user_id=current_user.id,
        name=req.name.strip(),
        description=req.description,
        kind=req.kind,
        source_set_id=source_set_id,
        rule_json=rule_json,
    )
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return _serialize_collection(db, collection, current_user.id)


@router.get("/collections/{collection_id}")
def get_collection(collection_id: int, db: DbSession, current_user: CurrentUser) -> dict:
    collection = _load_collection(db, collection_id, current_user.id)
    return _serialize_collection(db, collection, current_user.id)


@router.patch("/collections/{collection_id}")
def patch_collection(
    collection_id: int,
    req: CollectionPatch,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    collection = _load_collection(db, collection_id, current_user.id)
    if req.name is not None:
        collection.name = req.name.strip()
    # `description` is patched whenever the caller includes the key —
    # passing `null` clears it. `model_fields_set` distinguishes "omitted"
    # from "explicitly null" since Pydantic collapses both to None.
    if "description" in req.model_fields_set:
        collection.description = req.description
    if "rule" in req.model_fields_set:
        if collection.kind != COLLECTION_KIND_DYNAMIC:
            raise HTTPException(
                status_code=409,
                detail="only dynamic collections have a rule",
            )
        collection.rule_json = _normalize_rule_or_422(req.rule)
    db.commit()
    db.refresh(collection)
    return _serialize_collection(db, collection, current_user.id)


@router.delete("/collections/{collection_id}", status_code=204)
def delete_collection(collection_id: int, db: DbSession, current_user: CurrentUser) -> None:
    collection = _load_collection(db, collection_id, current_user.id)
    db.delete(collection)
    db.commit()


@router.post("/collections/{collection_id}/items", status_code=201)
def add_collection_item(
    collection_id: int,
    req: CollectionItemCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    collection = _load_collection(db, collection_id, current_user.id)
    _reject_if_dynamic(collection)
    promoted = extract_card_identity(req.card)
    price = extract_price_snapshot(req.card)
    item = CollectionItem(
        collection_id=collection.id,
        card_json=req.card,
        notes=req.notes,
        quantity=req.quantity,
        added_via=req.added_via or ADDED_VIA_MANUAL,
        price_snapshot=price,
        priced_at=datetime.now(UTC) if price is not None else None,
        **promoted,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize_item(item)


@router.delete("/collections/{collection_id}/items/{item_id}", status_code=204)
def delete_collection_item(
    collection_id: int,
    item_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    # Scope the lookup through the parent collection so a guess-the-id
    # attack on another user's items 404s instead of leaking existence.
    collection = _load_collection(db, collection_id, current_user.id)
    _reject_if_dynamic(collection)
    item = db.scalar(
        select(CollectionItem).where(
            CollectionItem.id == item_id,
            CollectionItem.collection_id == collection.id,
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


def _load_collection(db: Session, collection_id: int, user_id: int) -> Collection:
    collection = db.scalar(
        select(Collection)
        .where(
            Collection.id == collection_id,
            Collection.user_id == user_id,
        )
        .options(selectinload(Collection.items))
    )
    if collection is None:
        raise HTTPException(status_code=404, detail=f"collection {collection_id} not found")
    return collection


def _validate_kind_fields(
    kind: str, source_set_id: str | None, rule: dict[str, Any] | None
) -> tuple[str | None, dict[str, Any] | None]:
    """Cross-check the kind-specific fields, returning the values to persist.

    A ``set`` collection needs a ``source_set_id`` anchor; a ``dynamic`` one
    needs a valid ``rule``. Fields that don't belong to the chosen kind are
    dropped rather than stored as dead state."""
    if kind == COLLECTION_KIND_SET:
        if not source_set_id:
            raise HTTPException(status_code=422, detail="set collections require a source_set_id")
        return source_set_id, None
    if kind == COLLECTION_KIND_DYNAMIC:
        return None, _normalize_rule_or_422(rule)
    return None, None


def _normalize_rule_or_422(rule: dict[str, Any] | None) -> dict[str, Any]:
    """Validate a dynamic rule, mapping a bad rule to a 422."""
    try:
        return normalize_rule(rule)
    except RuleValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _reject_if_dynamic(collection: Collection) -> None:
    """Guard item mutation: a dynamic collection's membership is its rule,
    not a hand-curated list, so direct add/remove is a 409."""
    if collection.kind == COLLECTION_KIND_DYNAMIC:
        raise HTTPException(
            status_code=409,
            detail="dynamic collections are rule-defined; edit the rule, not its items",
        )


def _serialize_collection(db: Session, collection: Collection, user_id: int) -> dict:
    # A dynamic collection owns no rows — resolve its membership live from
    # the rule. Manual/set collections render their stored items.
    if collection.kind == COLLECTION_KIND_DYNAMIC and collection.rule_json:
        members = resolve_dynamic_items(db, user_id, collection.rule_json)
    else:
        members = collection.items
    return CollectionOut(
        id=collection.id,
        name=collection.name,
        description=collection.description,
        created_at=collection.created_at.isoformat(),
        items=[_item_out(i) for i in members],
        kind=collection.kind,
        source_set_id=collection.source_set_id,
        rule=collection.rule_json,
    ).model_dump()


def _serialize_item(item: CollectionItem) -> dict:
    return _item_out(item).model_dump()


def _item_out(item: CollectionItem) -> CollectionItemOut:
    return CollectionItemOut(
        id=item.id,
        card=item.card_json,
        notes=item.notes,
        added_at=item.added_at.isoformat(),
        quantity=item.quantity,
        card_set_id=item.card_set_id,
        card_number=item.card_number,
        card_name=item.card_name,
        card_rarity=item.card_rarity,
        card_types=item.card_types_json,
        card_image_url=item.card_image_url,
        price_snapshot=(float(item.price_snapshot) if item.price_snapshot is not None else None),
        priced_at=item.priced_at.isoformat() if item.priced_at is not None else None,
        added_via=item.added_via,
    )
