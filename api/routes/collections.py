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
- `GET    /collections/insights`              aggregate "at a glance" dashboard (#575)
- `POST   /collections`                       create (manual, set, or dynamic)
- `GET    /collections/{id}`                  full collection including items
- `PATCH  /collections/{id}`                  rename / edit description / rule
- `DELETE /collections/{id}`                  cascade-delete items
- `POST   /collections/{id}/items`            add a card (manual/set only)
- `POST   /collections/{id}/items/bulk`       add many cards at once (#268/#509)
- `PATCH  /collections/{id}/items/{item_id}`  adjust a card's owned quantity (#769)
- `DELETE /collections/{id}/items/{item_id}`  remove a card (manual/set only)
- `GET    /collections/{id}/target`           catalog-backed membership + ownership overlay (#631)
- `POST   /collections/{id}/chase`            push the un-owned matches onto a want-list (#631)
- `GET    /collections/{id}/id-card.pdf`      printable binder cover ID card (#507)
"""

from __future__ import annotations

import hashlib
import io
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import requests
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.set_cards import fetch_all_sets, write_collection_id_card_pdf
from mgz_pkmn.sources import TCGClient

from ..auth.session import current_user_or_default
from ..db.card_payload import extract_card_identity, extract_price_snapshot
from ..db.collection_rules import (
    RuleValidationError,
    count_dynamic_items,
    normalize_rule,
    owned_quantity_map,
    resolve_dynamic_items,
    rule_to_lucene,
)
from ..db.models import (
    ADDED_VIA_MANUAL,
    BINDER_COLORS,
    BINDER_FORMATS,
    BINDER_TYPES,
    COLLECTION_KIND_BINDER,
    COLLECTION_KIND_DYNAMIC,
    COLLECTION_KIND_MANUAL,
    COLLECTION_KIND_SET,
    COLLECTION_PURPOSE_PERSONAL,
    COLLECTION_PURPOSES,
    DYNAMIC_SCOPE_CATALOG,
    DYNAMIC_SCOPE_OWNED,
    Binder,
    Collection,
    CollectionItem,
    User,
    Wishlist,
    WishlistItem,
)
from ..db.session import get_db
from .collection_insights import (
    CollectionInsightsOut,
    InsightsTotals,
    aggregate_items,
    already_owned_chasing,
)

#: The kinds a caller may create. Mirrors the model constants; kept here so
#: the create/patch validators reject an unknown kind with a 422.
_VALID_KINDS = (
    COLLECTION_KIND_MANUAL,
    COLLECTION_KIND_SET,
    COLLECTION_KIND_DYNAMIC,
    COLLECTION_KIND_BINDER,
)
#: Allowed ``dynamic_scope`` values on create. Null/owned is the default.
_VALID_SCOPES = (DYNAMIC_SCOPE_OWNED, DYNAMIC_SCOPE_CATALOG)

#: Kinds that carry the shared cover/type/master-set identity (#681): a
#: physical ``binder`` and a ``dynamic`` (smart) binder. ``manual``/``set``
#: are legacy buckets created outside the binder modal and stay plain.
_IDENTITY_KINDS = (COLLECTION_KIND_BINDER, COLLECTION_KIND_DYNAMIC)
#: Kinds that additionally carry the physical pocket ``binder_format`` and
#: slot ``capacity`` — a smart binder has no fixed slots, so just the binder.
_PHYSICAL_KINDS = (COLLECTION_KIND_BINDER,)

#: A freeform cover color: a 6-digit ``#rrggbb`` hex (#681). Token-stem
#: presets are validated against :data:`BINDER_COLORS` instead.
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

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
    #: Sum of item ``quantity`` (vendor multiples), i.e. occupied slots — what
    #: a binder's capacity fill measures (#679). Equals ``item_count`` for a
    #: dynamic collection's resolved membership.
    total_quantity: int
    # ---- #506: kind + rule so the SPA can badge dynamic/set collections ----
    kind: str
    source_set_id: str | None
    rule: dict[str, Any] | None
    #: #631 — ``owned`` / ``catalog`` for dynamic collections, else null.
    dynamic_scope: str | None
    #: #703 — the binder this collection is filed into (``binders.id``), or
    #: null when unfiled.
    binder_id: int | None
    # ---- #679/#681: binder identity. format/capacity are physical-only;
    # color/type/master-set are shared across binder + smart binder. ----
    binder_format: str | None
    binder_color: str | None
    binder_type: str | None
    capacity: int | None
    is_master_set: bool | None
    #: #759/#762 — the user's default `Own` target. The flag is the invariant,
    #: not the row: renaming keeps it, deleting re-establishes one lazily. The
    #: SPA shows a subtle "default" marker so a bare Own's destination is clear.
    is_default: bool
    #: #707 — one of :data:`COLLECTION_PURPOSES`. ``personal`` (default) counts
    #: toward set-completion / the owned badge; ``trade``/``bulk`` don't.
    purpose: str


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
    #: #631 — ``owned`` / ``catalog`` for dynamic collections, else null.
    dynamic_scope: str | None
    #: #703 — the binder this collection is filed into (``binders.id``), or
    #: null when unfiled.
    binder_id: int | None
    # ---- #679/#681: binder identity. format/capacity are physical-only;
    # color/type/master-set are shared across binder + smart binder. ----
    binder_format: str | None
    binder_color: str | None
    binder_type: str | None
    capacity: int | None
    is_master_set: bool | None
    #: #707 — one of :data:`COLLECTION_PURPOSES`.
    purpose: str
    #: #788 — pinned ID card cover item, or null when auto-picked.
    id_card_cover_item_id: int | None = None


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    #: Defaults to ``manual`` so existing callers are unchanged. ``set``
    #: requires ``source_set_id``; ``dynamic`` requires ``rule``; ``binder``
    #: is a manual bucket carrying the #679 identity fields below.
    kind: str = COLLECTION_KIND_MANUAL
    source_set_id: str | None = Field(default=None, max_length=64)
    rule: dict[str, Any] | None = None
    #: #631 — only read for ``kind == 'dynamic'``. ``owned`` (default) is the
    #: inventory view; ``catalog`` is the catalog-backed target view.
    dynamic_scope: str | None = None
    #: #703 — file the new collection into a physical binder (``binders.id``).
    #: Validated as owned; null leaves the collection unfiled.
    binder_id: int | None = None
    # ---- #679/#681: binder identity. format/capacity persist for binders;
    # color/type/master-set for binder + smart binder; dropped otherwise. ----
    binder_format: str | None = None
    binder_color: str | None = None
    binder_type: str | None = None
    capacity: int | None = Field(default=None, ge=1)
    is_master_set: bool | None = None
    #: #707 — one of :data:`COLLECTION_PURPOSES`. Defaults to ``personal``.
    purpose: str = COLLECTION_PURPOSE_PERSONAL


class CollectionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    #: Editing a dynamic collection's rule re-points its membership. Only
    #: meaningful on ``kind == 'dynamic'`` collections.
    rule: dict[str, Any] | None = None
    #: #703 — move the collection into a binder, or clear it (``null``) to
    #: unfile. Patched only when the key is present in the request body.
    binder_id: int | None = None
    # ---- #679/#681: editable binder identity. Each patched only when its key
    # is present in the request body, so a partial PATCH leaves the rest
    # intact; rejected with a 409 on kinds that don't carry the field. ----
    binder_format: str | None = None
    binder_color: str | None = None
    binder_type: str | None = None
    capacity: int | None = Field(default=None, ge=1)
    is_master_set: bool | None = None
    #: #707 — reassign the collection's purpose. Valid on every kind.
    purpose: str | None = None
    #: #788 — pin a specific owned item as the ID card cover, or clear it
    #: (``null``) to fall back to auto-pick. Patched only when the key is
    #: present in the request body.
    id_card_cover_item_id: int | None = None


# ---- #631: catalog-backed target view + chase ----------------------------


class TargetCardOut(BaseModel):
    """One catalog match, annotated with the user's ownership of it."""

    card: dict[str, Any]
    card_set_id: str | None
    card_number: str | None
    owned: bool
    owned_quantity: int


class CollectionTargetOut(BaseModel):
    """Resolved catalog membership for a ``catalog``-scope dynamic collection,
    with an ``owned / total`` progress headline and the per-card overlay."""

    id: int
    name: str
    rule: dict[str, Any] | None
    total: int
    owned_count: int
    cards: list[TargetCardOut]


class ChaseRequest(BaseModel):
    """Push the un-owned matches onto a want-list. Target either an existing
    want-list by id, or create a fresh one by name — exactly one of the two."""

    wishlist_id: int | None = None
    wishlist_name: str | None = Field(default=None, min_length=1, max_length=200)
    #: Optional alert threshold stamped on every created want-list item.
    max_price: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _exactly_one_target(self) -> ChaseRequest:
        if (self.wishlist_id is None) == (self.wishlist_name is None):
            raise ValueError("pass exactly one of wishlist_id or wishlist_name")
        return self


class ChaseResult(BaseModel):
    wishlist_id: int
    added: int
    skipped: int
    total_missing: int


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


class CollectionItemPatch(BaseModel):
    #: New vendor-multiple count for the item (#769). Floored at 1 — removing
    #: the last copy is a DELETE, not a quantity-0 PATCH.
    quantity: int = Field(ge=1)


class CollectionItemQuantityDelta(BaseModel):
    #: +1 / -1 from the card-detail quantity stepper (#762). A delta, not an
    #: absolute count — see `update_collection_item_by_card` for why.
    delta: int


class BulkItemsCreate(BaseModel):
    """Add a set of matched cards to a manual/set collection in one call.

    Backs the results-table "add selected to binder (owned)" bulk action
    (#268) and the haul mode (#509). Each card lands as its own quantity-1
    row, mirroring the single-card :class:`CollectionItemCreate` insert; the
    optional ``notes`` / ``added_via`` apply to every row in the batch."""

    cards: list[dict[str, Any]] = Field(min_length=1, max_length=500)
    notes: str | None = None
    added_via: str | None = None


class BulkAddResult(BaseModel):
    """Count plus the created rows, so the SPA can bump item counts and
    invalidate the cross-surface ownership cache (#576) in one round-trip."""

    added: int
    items: list[CollectionItemOut]


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
            # Occupied slots = sum of vendor multiples; backs a binder's
            # capacity fill (#679), which counts pockets, not rows.
            func.coalesce(func.sum(CollectionItem.quantity), 0).label("total_quantity"),
        )
        .group_by(CollectionItem.collection_id)
        .subquery()
    )
    stmt = (
        select(
            Collection,
            func.coalesce(item_count_subq.c.item_count, 0).label("item_count"),
            func.coalesce(item_count_subq.c.total_quantity, 0).label("total_quantity"),
        )
        .outerjoin(item_count_subq, Collection.id == item_count_subq.c.collection_id)
        .where(Collection.user_id == current_user.id)
        .order_by(Collection.created_at.desc(), Collection.id.desc())
    )
    items = []
    for c, item_count, total_quantity in db.execute(stmt).all():
        # Dynamic collections own no rows — the join counts 0. Resolve the
        # rule against owned inventory so the badge reflects live membership.
        if c.kind == COLLECTION_KIND_DYNAMIC and c.rule_json:
            count = count_dynamic_items(db, current_user.id, c.rule_json)
            qty = count
        else:
            count = int(item_count)
            qty = int(total_quantity)
        items.append(
            CollectionSummaryOut(
                id=c.id,
                name=c.name,
                description=c.description,
                created_at=c.created_at.isoformat(),
                item_count=count,
                total_quantity=qty,
                kind=c.kind,
                source_set_id=c.source_set_id,
                rule=c.rule_json,
                dynamic_scope=c.dynamic_scope,
                binder_id=c.binder_id,
                binder_format=c.binder_format,
                binder_color=c.binder_color,
                binder_type=c.binder_type,
                capacity=c.capacity,
                is_master_set=c.is_master_set,
                is_default=c.is_default,
                purpose=c.purpose,
            )
        )
    return {"items": [item.model_dump() for item in items], "total": len(items)}


@router.get("/collections/insights")
def collection_insights(db: DbSession, current_user: CurrentUser) -> dict:
    """Aggregate "your collection at a glance" across all of a user's
    collections (#575): totals, top types / rarities / sets, vendor
    duplicates, and the wishlist ∩ collection cleanup nudge. Computed live
    from the promoted card-identity columns — every breakdown is indexed SQL
    + a small in-Python rollup, not a ``card_json`` scan."""
    collection_count = (
        db.scalar(select(func.count(Collection.id)).where(Collection.user_id == current_user.id))
        or 0
    )
    rows = db.execute(
        select(
            CollectionItem.card_set_id,
            CollectionItem.card_number,
            CollectionItem.card_name,
            CollectionItem.card_rarity,
            CollectionItem.card_types_json,
            CollectionItem.quantity,
            CollectionItem.price_snapshot,
            Collection.id,
            Collection.name,
        )
        .join(Collection, CollectionItem.collection_id == Collection.id)
        .where(Collection.user_id == current_user.id)
    ).all()

    agg = aggregate_items(rows)
    out = CollectionInsightsOut(
        totals=InsightsTotals(
            collections=int(collection_count),
            unique_cards=agg["unique_cards"],
            total_quantity=agg["total_quantity"],
            estimated_value=agg["estimated_value"],
        ),
        top_types=agg["top_types"],
        top_rarities=agg["top_rarities"],
        top_sets=agg["top_sets"],
        top_value_cards=agg["top_value_cards"],
        value_by_set=agg["value_by_set"],
        value_by_collection=agg["value_by_collection"],
        duplicate_multiples=agg["duplicate_multiples"],
        cross_collection=agg["cross_collection"],
        already_owned_chasing=already_owned_chasing(db, current_user.id, agg["owned_collections"]),
    )
    return out.model_dump()


@router.post("/collections", status_code=201)
def create_collection(req: CollectionCreate, db: DbSession, current_user: CurrentUser) -> dict:
    if req.kind not in _VALID_KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"unknown kind '{req.kind}'; allowed: {', '.join(_VALID_KINDS)}",
        )
    _validate_purpose(req.purpose)
    source_set_id, rule_json, dynamic_scope = _validate_kind_fields(
        req.kind, req.source_set_id, req.rule, req.dynamic_scope
    )
    # Cover/type/master-set identity rides binder + smart binder; physical
    # format/capacity ride only the physical binder. Other kinds drop it all
    # so it never lingers as dead state (mirrors how rule/scope are scoped).
    has_identity = req.kind in _IDENTITY_KINDS
    physical = req.kind in _PHYSICAL_KINDS
    if has_identity:
        _validate_binder_color(req.binder_color)
        _validate_binder_type(req.binder_type)
        # A physical master-set binder needs a set anchor to target; on a
        # smart binder the rule defines membership, so the flag is a label.
        if req.is_master_set and physical and not source_set_id:
            raise HTTPException(
                status_code=422,
                detail="a master-set binder needs a source_set_id to target",
            )
    if physical:
        _validate_binder_format(req.binder_format)
    _require_owned_binder(db, req.binder_id, current_user.id)
    collection = Collection(
        user_id=current_user.id,
        name=req.name.strip(),
        description=req.description,
        kind=req.kind,
        source_set_id=source_set_id,
        rule_json=rule_json,
        dynamic_scope=dynamic_scope,
        binder_id=req.binder_id,
        binder_format=req.binder_format if physical else None,
        binder_color=req.binder_color if has_identity else None,
        binder_type=req.binder_type if has_identity else None,
        capacity=req.capacity if physical else None,
        is_master_set=req.is_master_set if has_identity else None,
        purpose=req.purpose,
    )
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return serialize_collection(db, collection, current_user.id)


@router.get("/collections/{collection_id}")
def get_collection(collection_id: int, db: DbSession, current_user: CurrentUser) -> dict:
    collection = _load_collection(db, collection_id, current_user.id)
    return serialize_collection(db, collection, current_user.id)


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
    # File into a binder, or clear it (explicit null) to unfile. Only touched
    # when the key is present so a partial PATCH leaves the filing intact.
    if "binder_id" in req.model_fields_set:
        _require_owned_binder(db, req.binder_id, current_user.id)
        collection.binder_id = req.binder_id
    if req.purpose is not None:
        _validate_purpose(req.purpose)
        collection.purpose = req.purpose
    if "id_card_cover_item_id" in req.model_fields_set:
        _set_id_card_cover(db, collection, req.id_card_cover_item_id)
    _patch_binder_fields(collection, req)
    db.commit()
    db.refresh(collection)
    return serialize_collection(db, collection, current_user.id)


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
    return serialize_collection_item(item)


@router.post("/collections/{collection_id}/items/bulk", status_code=201)
def add_collection_items_bulk(
    collection_id: int,
    req: BulkItemsCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Add every card in ``req.cards`` to the collection in one transaction.

    Same per-card handling as the single :func:`add_collection_item` (identity
    + price-snapshot extraction, ``manual`` provenance by default); dynamic
    collections are rejected for the same reason."""
    collection = _load_collection(db, collection_id, current_user.id)
    _reject_if_dynamic(collection)
    now = datetime.now(UTC)
    items: list[CollectionItem] = []
    for card in req.cards:
        promoted = extract_card_identity(card)
        price = extract_price_snapshot(card)
        items.append(
            CollectionItem(
                collection_id=collection.id,
                card_json=card,
                notes=req.notes,
                quantity=1,
                added_via=req.added_via or ADDED_VIA_MANUAL,
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
        items=[CollectionItemOut(**serialize_collection_item(i)) for i in items],
    ).model_dump()


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
    # Cleared explicitly: the column's ON DELETE SET NULL doesn't fire on the
    # default SQLite database (PRAGMA foreign_keys is off), and SQLite can
    # reuse the deleted rowid — a stale pin could attach to a future item.
    if collection.id_card_cover_item_id == item.id:
        collection.id_card_cover_item_id = None
    db.delete(item)
    db.commit()


@router.delete("/collections/{collection_id}/items", status_code=204)
def delete_collection_items_by_card(
    collection_id: int,
    set_id: str,
    number: str,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    """Remove a card from a specific collection by its ``(set_id, number)``
    identity — the card-detail "remove from this list" affordance (#762).

    Deletes every matching row, since a card can occupy a collection more than
    once (separate adds), so the collection cleanly stops listing the card.
    Scoped through the parent collection (an unowned id 404s); dynamic
    collections are rejected like the other item-write paths."""
    collection = _load_collection(db, collection_id, current_user.id)
    _reject_if_dynamic(collection)
    items = db.scalars(
        select(CollectionItem).where(
            CollectionItem.collection_id == collection.id,
            CollectionItem.card_set_id == set_id,
            CollectionItem.card_number == number,
        )
    ).all()
    if not items:
        raise HTTPException(
            status_code=404,
            detail=f"card {set_id}-{number} not found in collection {collection_id}",
        )
    # Same explicit clear as delete_collection_item — SQLite doesn't run the
    # FK's ON DELETE SET NULL.
    if collection.id_card_cover_item_id in {i.id for i in items}:
        collection.id_card_cover_item_id = None
    for item in items:
        db.delete(item)
    db.commit()


@router.patch("/collections/{collection_id}/items/{item_id}")
def update_collection_item(
    collection_id: int,
    item_id: int,
    req: CollectionItemPatch,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Adjust a card's owned quantity in place (#769) — the editable count in
    the collection detail view. Scoped through the parent collection so an
    unowned id 404s; dynamic collections (rule-derived membership) are rejected
    like the other item-write paths."""
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
    item.quantity = req.quantity
    db.commit()
    db.refresh(item)
    return serialize_collection_item(item)


@router.patch("/collections/{collection_id}/items")
def update_collection_item_by_card(
    collection_id: int,
    set_id: str,
    number: str,
    req: CollectionItemQuantityDelta,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Adjust a card's owned quantity by its ``(set_id, number)`` identity —
    the card-detail quantity stepper (#762), which only has the occupancy's
    *summed* quantity, not an item id. Takes a delta rather than an absolute
    count: a card can occupy a collection via more than one row (separate
    adds), so there's no single row to set an absolute value on — writing
    the stepper's summed total onto one row would double-count whatever the
    other rows still hold (review feedback on the first cut of this).

    A positive delta lands on the oldest row. A negative delta is drawn down
    from the oldest row first, deleting any row it fully exhausts and
    carrying the remainder to the next one, so the total tracks the click
    exactly no matter how many rows back it. Scoped through the parent
    collection; dynamic collections are rejected like the other item-write
    paths."""
    collection = _load_collection(db, collection_id, current_user.id)
    _reject_if_dynamic(collection)
    items = db.scalars(
        select(CollectionItem)
        .where(
            CollectionItem.collection_id == collection.id,
            CollectionItem.card_set_id == set_id,
            CollectionItem.card_number == number,
        )
        .order_by(CollectionItem.id)
    ).all()
    if not items:
        raise HTTPException(
            status_code=404,
            detail=f"card {set_id}-{number} not found in collection {collection_id}",
        )

    total = sum(item.quantity for item in items)
    if total + req.delta < 1:
        raise HTTPException(
            status_code=422,
            detail="quantity would drop below 1 — remove the card instead",
        )

    if req.delta > 0:
        items[0].quantity += req.delta
    else:
        remaining = -req.delta
        for item in items:
            if remaining <= 0:
                break
            if item.quantity <= remaining:
                remaining -= item.quantity
                # Same explicit clear as delete_collection_item /
                # delete_collection_items_by_card — SQLite doesn't run the
                # FK's ON DELETE SET NULL.
                if collection.id_card_cover_item_id == item.id:
                    collection.id_card_cover_item_id = None
                db.delete(item)
            else:
                item.quantity -= remaining
                remaining = 0
    db.commit()
    return {"quantity": total + req.delta}


# ---------------------------------------------------------------------------
# #631 — catalog-backed target view + chase
# ---------------------------------------------------------------------------


@router.get("/collections/{collection_id}/target")
def get_collection_target(
    collection_id: int,
    db: DbSession,
    current_user: CurrentUser,
    api_key: str | None = None,
) -> dict:
    """Resolve a ``catalog``-scope dynamic collection against the catalog and
    overlay the user's ownership.

    Returns the full matching set from pokemontcg.io (bounded by the client's
    paginated ``search_all`` cap), each card flagged ``owned`` / not, plus an
    ``owned / total`` progress headline. The resolution rides the catalog
    client's on-disk cache, so this stays cheap on a warm cache; the base
    ``GET /collections/{id}`` is left DB-only and offline. 409 for any
    collection that isn't a catalog-scope dynamic — owned-scope membership
    belongs on the base endpoint."""
    collection = _load_collection(db, collection_id, current_user.id)
    _require_catalog_dynamic(collection)

    cards = _fetch_catalog_cards(collection.rule_json, api_key)
    owned = owned_quantity_map(db, current_user.id)

    target_cards: list[TargetCardOut] = []
    owned_count = 0
    for card in cards:
        ident = extract_card_identity(card)
        set_id, number = ident["card_set_id"], ident["card_number"]
        qty = owned.get((set_id, number), 0) if set_id and number else 0
        if qty > 0:
            owned_count += 1
        target_cards.append(
            TargetCardOut(
                card=card,
                card_set_id=set_id,
                card_number=number,
                owned=qty > 0,
                owned_quantity=qty,
            )
        )

    return CollectionTargetOut(
        id=collection.id,
        name=collection.name,
        rule=collection.rule_json,
        total=len(target_cards),
        owned_count=owned_count,
        cards=target_cards,
    ).model_dump()


@router.post("/collections/{collection_id}/chase", status_code=201)
def chase_collection(
    collection_id: int,
    req: ChaseRequest,
    db: DbSession,
    current_user: CurrentUser,
    api_key: str | None = None,
) -> dict:
    """Push the un-owned matches of a catalog-scope dynamic collection onto a
    want-list — the one-click chase hand-off (#631, #504).

    Resolves the catalog target, subtracts what the user owns, and adds each
    remaining card to the named (created) or referenced want-list. Idempotent
    on re-run: a card already on the target want-list is skipped, not
    duplicated, so chasing twice doesn't double the list."""
    collection = _load_collection(db, collection_id, current_user.id)
    _require_catalog_dynamic(collection)

    wishlist = _resolve_chase_wishlist(db, current_user.id, req)

    cards = _fetch_catalog_cards(collection.rule_json, api_key)
    owned = owned_quantity_map(db, current_user.id)
    existing = {
        (i.card_set_id, i.card_number)
        for i in db.scalars(
            select(WishlistItem).where(WishlistItem.wishlist_id == wishlist.id)
        ).all()
    }

    added = skipped = total_missing = 0
    for card in cards:
        ident = extract_card_identity(card)
        set_id, number = ident["card_set_id"], ident["card_number"]
        key = (set_id, number)
        if set_id and number and owned.get(key, 0) > 0:
            continue  # already owned — not a chase target
        total_missing += 1
        if key in existing:
            skipped += 1
            continue
        price = extract_price_snapshot(card)
        db.add(
            WishlistItem(
                wishlist_id=wishlist.id,
                card_json=card,
                max_price=req.max_price,
                price_snapshot=price,
                priced_at=datetime.now(UTC) if price is not None else None,
                **ident,
            )
        )
        existing.add(key)
        added += 1

    db.commit()
    return ChaseResult(
        wishlist_id=wishlist.id,
        added=added,
        skipped=skipped,
        total_missing=total_missing,
    ).model_dump()


# ---------------------------------------------------------------------------
# #507 — printable collection ID card
# ---------------------------------------------------------------------------

#: Disk-image-cache category for auto-picked cover art, keyed by a hash of
#: the card image URL so repeat prints reuse the download.
_COVER_CATEGORY = "collection-covers"


@router.get("/collections/{collection_id}/id-card.pdf")
def collection_id_card(
    collection_id: int,
    db: DbSession,
    current_user: CurrentUser,
    api_key: str | None = None,
    no_images: bool = False,
) -> StreamingResponse:
    """Render a printable collection ID card — the cover cutout for the
    top-left pocket of a binder (#507): the collection's title, a representative
    card photo, and an owned / total count.

    The cover is auto-picked (the most valuable card you own in the
    collection, falling back to the first) unless the collector has pinned
    one via ``PATCH .../collections/{id} {id_card_cover_item_id}`` (#788).
    ``total`` is the catalog match count for a catalog-scope smart collection
    and the printed set size for a set collection; manual buckets and
    owned-scope smart collections have no denominator, so the card shows just
    the owned count. Pass ``no_images=true`` to skip the cover fetch
    (text-only, fast on a cold cache)."""
    collection = _load_collection(db, collection_id, current_user.id)
    owned_items = _id_card_owned_items(db, collection, current_user.id)
    total = _id_card_total(collection, api_key)

    cover_path: Path | None = None
    if not no_images:
        cover_url = _pick_cover_url(owned_items, collection.id_card_cover_item_id)
        if cover_url:
            cover_path = _fetch_cover(cover_url, TCGClient(api_key=api_key).session)

    content = _render_id_card(collection.name, len(owned_items), total, cover_path)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="collection-{collection_id}-id-card.pdf"'
        },
    )


def _id_card_owned_items(db: Session, collection: Collection, user_id: int) -> list[CollectionItem]:
    """The owned cards backing the ID card — resolved rule membership for a
    dynamic collection, stored rows otherwise."""
    if collection.kind == COLLECTION_KIND_DYNAMIC and collection.rule_json:
        return resolve_dynamic_items(db, user_id, collection.rule_json)
    return list(collection.items)


def _pick_cover_url(items: list[CollectionItem], pinned_item_id: int | None) -> str | None:
    """The pinned cover's image when set and still present among ``items``
    (a dynamic collection's resolved membership can drop a once-pinned item
    without clearing the pin), else auto-pick: the most valuable owned card
    with an image, falling back to the first with one."""
    with_image = [i for i in items if i.card_image_url]
    if pinned_item_id is not None:
        pinned = next((i for i in with_image if i.id == pinned_item_id), None)
        if pinned is not None:
            return pinned.card_image_url
    if not with_image:
        return None
    best = max(
        with_image,
        key=lambda i: float(i.price_snapshot) if i.price_snapshot is not None else -1.0,
    )
    return best.card_image_url


def _id_card_total(collection: Collection, api_key: str | None) -> int | None:
    """The denominator for the owned / total count, or None when the
    collection has no well-defined total (manual bucket, owned-scope smart)."""
    if (
        collection.kind == COLLECTION_KIND_DYNAMIC
        and collection.dynamic_scope == DYNAMIC_SCOPE_CATALOG
    ):
        return len(_fetch_catalog_cards(collection.rule_json, api_key))
    if collection.kind == COLLECTION_KIND_SET and collection.source_set_id:
        return _set_total(collection.source_set_id, api_key)
    return None


def _set_total(set_id: str, api_key: str | None) -> int | None:
    """Printed card count for a set, from the catalog's cached set list."""
    try:
        sets = fetch_all_sets(TCGClient(api_key=api_key))
    except requests.RequestException:
        return None
    for s in sets:
        if s.get("id") == set_id:
            total = s.get("printedTotal") or s.get("total")
            return int(total) if total else None
    return None


def _fetch_cover(url: str, session: requests.Session) -> Path | None:
    key = hashlib.sha256(url.encode()).hexdigest()[:16]
    return disk_cache.download_and_cache_image(_COVER_CATEGORY, key, url, session)


def _render_id_card(title: str, owned: int, total: int | None, cover_path: Path | None) -> bytes:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / "collection-id-card.pdf"
        write_collection_id_card_pdf(
            out_path, title=title, owned=owned, total=total, cover_path=cover_path
        )
        return out_path.read_bytes()


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
    kind: str,
    source_set_id: str | None,
    rule: dict[str, Any] | None,
    dynamic_scope: str | None,
) -> tuple[str | None, dict[str, Any] | None, str | None]:
    """Cross-check the kind-specific fields, returning the values to persist.

    A ``set`` collection needs a ``source_set_id`` anchor; a ``dynamic`` one
    needs a valid ``rule`` and a scope (defaulting to ``owned``); a ``binder``
    may optionally organize a set, so it passes ``source_set_id`` through.
    Fields that don't belong to the chosen kind are dropped rather than
    stored as dead state."""
    if kind == COLLECTION_KIND_SET:
        if not source_set_id:
            raise HTTPException(status_code=422, detail="set collections require a source_set_id")
        return source_set_id, None, None
    if kind == COLLECTION_KIND_BINDER:
        # A binder optionally organizes a set; the anchor is optional and
        # only required when the binder targets the master set (validated in
        # _normalize_binder_fields). No rule, no scope.
        return (source_set_id or None), None, None
    if kind == COLLECTION_KIND_DYNAMIC:
        scope = dynamic_scope or DYNAMIC_SCOPE_OWNED
        if scope not in _VALID_SCOPES:
            raise HTTPException(
                status_code=422,
                detail=f"unknown dynamic_scope '{scope}'; allowed: {', '.join(_VALID_SCOPES)}",
            )
        return None, _normalize_rule_or_422(rule), scope
    return None, None, None


def _normalize_rule_or_422(rule: dict[str, Any] | None) -> dict[str, Any]:
    """Validate a dynamic rule, mapping a bad rule to a 422."""
    try:
        return normalize_rule(rule)
    except RuleValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _validate_purpose(value: str) -> None:
    if value not in COLLECTION_PURPOSES:
        raise HTTPException(
            status_code=422,
            detail=f"unknown purpose '{value}'; allowed: {', '.join(COLLECTION_PURPOSES)}",
        )


def _set_id_card_cover(db: Session, collection: Collection, item_id: int | None) -> None:
    """Pin ``item_id`` as the ID card cover, or clear it (``None``).

    Rejects an item that doesn't belong to this collection (or belongs to a
    dynamic collection, whose membership isn't a stored row) with a 422 —
    silently ignoring a stale ID would leave the picker showing a selection
    the server didn't actually save."""
    if item_id is None:
        collection.id_card_cover_item_id = None
        return
    if collection.kind == COLLECTION_KIND_DYNAMIC:
        raise HTTPException(
            status_code=422,
            detail="a dynamic collection has no stored items to pin as a cover",
        )
    owns_item = (
        db.query(CollectionItem)
        .filter(CollectionItem.id == item_id, CollectionItem.collection_id == collection.id)
        .first()
    )
    if owns_item is None:
        raise HTTPException(status_code=422, detail=f"item {item_id} is not in this collection")
    collection.id_card_cover_item_id = item_id


def _validate_binder_format(value: str | None) -> None:
    if value is not None and value not in BINDER_FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"unknown binder_format '{value}'; allowed: {', '.join(BINDER_FORMATS)}",
        )


def _require_owned_binder(db: Session, binder_id: int | None, user_id: int) -> None:
    """Reject a ``binder_id`` that isn't an existing binder the user owns (#703).

    A null id is a no-op (the collection is left unfiled / detached). 404 —
    not 422 — so a stale or someone else's binder id reads the same as a
    missing one, matching how the rest of the route hides unowned rows."""
    if binder_id is None:
        return
    owned = db.scalar(select(Binder.id).where(Binder.id == binder_id, Binder.user_id == user_id))
    if owned is None:
        raise HTTPException(status_code=404, detail=f"binder {binder_id} not found")


def _validate_binder_color(value: str | None) -> None:
    # A preset token stem, or a freeform #rrggbb hex (#681, user data).
    if value is None or value in BINDER_COLORS or _HEX_COLOR_RE.match(value):
        return
    raise HTTPException(
        status_code=422,
        detail=f"unknown binder_color '{value}'; use a preset ({', '.join(BINDER_COLORS)}) or a #rrggbb hex",
    )


def _validate_binder_type(value: str | None) -> None:
    if value is not None and value not in BINDER_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"unknown binder_type '{value}'; allowed: {', '.join(BINDER_TYPES)}",
        )


#: Shared-identity keys a PATCH may carry on binder + smart binder.
_IDENTITY_PATCH_FIELDS = ("binder_color", "binder_type", "is_master_set")
#: Physical-only keys a PATCH may carry on a physical binder.
_PHYSICAL_PATCH_FIELDS = ("binder_format", "capacity")


def _patch_binder_fields(collection: Collection, req: CollectionPatch) -> None:
    """Apply any binder-identity edits in ``req`` to ``collection``.

    Only the keys the caller actually sent are touched; passing ``null``
    clears one. Cover/type/master-set ride binder + smart binder; format/
    capacity ride only the physical binder. Editing a field on a kind that
    doesn't carry it is a 409. A physical master-set toggle needs a set
    anchor; on a smart binder it's a free-standing label."""
    identity = [f for f in _IDENTITY_PATCH_FIELDS if f in req.model_fields_set]
    physical = [f for f in _PHYSICAL_PATCH_FIELDS if f in req.model_fields_set]
    if not identity and not physical:
        return
    if identity and collection.kind not in _IDENTITY_KINDS:
        raise HTTPException(
            status_code=409,
            detail="only binders carry cover color, storage type, and master-set",
        )
    if physical and collection.kind not in _PHYSICAL_KINDS:
        raise HTTPException(
            status_code=409,
            detail="only physical binders carry pocket format and capacity",
        )
    if "binder_format" in physical:
        _validate_binder_format(req.binder_format)
        collection.binder_format = req.binder_format
    if "capacity" in physical:
        collection.capacity = req.capacity
    if "binder_color" in identity:
        _validate_binder_color(req.binder_color)
        collection.binder_color = req.binder_color
    if "binder_type" in identity:
        _validate_binder_type(req.binder_type)
        collection.binder_type = req.binder_type
    if "is_master_set" in identity:
        if (
            req.is_master_set
            and collection.kind in _PHYSICAL_KINDS
            and not collection.source_set_id
        ):
            raise HTTPException(
                status_code=422,
                detail="a master-set binder needs a source_set_id to target",
            )
        collection.is_master_set = req.is_master_set


def _reject_if_dynamic(collection: Collection) -> None:
    """Guard item mutation: a dynamic collection's membership is its rule,
    not a hand-curated list, so direct add/remove is a 409."""
    if collection.kind == COLLECTION_KIND_DYNAMIC:
        raise HTTPException(
            status_code=409,
            detail="dynamic collections are rule-defined; edit the rule, not its items",
        )


def _require_catalog_dynamic(collection: Collection) -> None:
    """Gate the #631 endpoints to catalog-scope dynamic collections.

    Owned-scope membership is served by the base ``GET /collections/{id}``
    (pure DB, offline); the catalog endpoints only make sense for a
    target-view collection, so anything else is a 409 with a pointer."""
    if (
        collection.kind != COLLECTION_KIND_DYNAMIC
        or collection.dynamic_scope != DYNAMIC_SCOPE_CATALOG
    ):
        raise HTTPException(
            status_code=409,
            detail="not a catalog-scope dynamic collection; use GET /collections/{id} instead",
        )


def _fetch_catalog_cards(rule: dict[str, Any] | None, api_key: str | None) -> list[dict[str, Any]]:
    """Resolve a rule's full matching set from pokemontcg.io.

    Translates the rule to a Lucene query and walks the catalog client's
    paginated, on-disk-cached ``search_all`` — the same path the set-browse
    and pokedex routes use, so the request shares their cache. The page cap
    inside ``search_all`` bounds an over-broad rule ("all Fire")."""
    query = rule_to_lucene(rule or {})
    if not query:
        return []
    cards, _status = TCGClient(api_key=api_key).search_all(query)
    return cards


def _resolve_chase_wishlist(db: Session, user_id: int, req: ChaseRequest) -> Wishlist:
    """Return the want-list to chase into — created from ``wishlist_name`` or
    looked up by ``wishlist_id`` (scoped to the user; a foreign id 404s)."""
    if req.wishlist_name is not None:
        wishlist = Wishlist(user_id=user_id, name=req.wishlist_name.strip())
        db.add(wishlist)
        db.flush()  # assign id without ending the outer transaction
        return wishlist
    wishlist = db.scalar(
        select(Wishlist).where(Wishlist.id == req.wishlist_id, Wishlist.user_id == user_id)
    )
    if wishlist is None:
        raise HTTPException(status_code=404, detail=f"wishlist {req.wishlist_id} not found")
    return wishlist


def serialize_collection(db: Session, collection: Collection, user_id: int) -> dict:
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
        dynamic_scope=collection.dynamic_scope,
        binder_id=collection.binder_id,
        binder_format=collection.binder_format,
        binder_color=collection.binder_color,
        binder_type=collection.binder_type,
        capacity=collection.capacity,
        is_master_set=collection.is_master_set,
        purpose=collection.purpose,
        id_card_cover_item_id=collection.id_card_cover_item_id,
    ).model_dump()


def serialize_collection_item(item: CollectionItem) -> dict:
    """Public so the wishlist promote endpoint (#504) can return the created
    collection item in the same shape ``POST /collections/{id}/items`` does."""
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
