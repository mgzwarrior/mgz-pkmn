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
- `GET    /collections/{id}/target`           catalog-backed membership + ownership overlay (#631)
- `POST   /collections/{id}/chase`            push the un-owned matches onto a want-list (#631)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

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
    COLLECTION_KIND_DYNAMIC,
    COLLECTION_KIND_MANUAL,
    COLLECTION_KIND_SET,
    DYNAMIC_SCOPE_CATALOG,
    DYNAMIC_SCOPE_OWNED,
    Collection,
    CollectionItem,
    User,
    Wishlist,
    WishlistItem,
)
from ..db.session import get_db

#: The kinds a caller may create. Mirrors the model constants; kept here so
#: the create/patch validators reject an unknown kind with a 422.
_VALID_KINDS = (COLLECTION_KIND_MANUAL, COLLECTION_KIND_SET, COLLECTION_KIND_DYNAMIC)
#: Allowed ``dynamic_scope`` values on create. Null/owned is the default.
_VALID_SCOPES = (DYNAMIC_SCOPE_OWNED, DYNAMIC_SCOPE_CATALOG)

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
    #: #631 — ``owned`` / ``catalog`` for dynamic collections, else null.
    dynamic_scope: str | None


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


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    #: Defaults to ``manual`` so existing callers are unchanged. ``set``
    #: requires ``source_set_id``; ``dynamic`` requires ``rule``.
    kind: str = COLLECTION_KIND_MANUAL
    source_set_id: str | None = Field(default=None, max_length=64)
    rule: dict[str, Any] | None = None
    #: #631 — only read for ``kind == 'dynamic'``. ``owned`` (default) is the
    #: inventory view; ``catalog`` is the catalog-backed target view.
    dynamic_scope: str | None = None


class CollectionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    #: Editing a dynamic collection's rule re-points its membership. Only
    #: meaningful on ``kind == 'dynamic'`` collections.
    rule: dict[str, Any] | None = None


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
                dynamic_scope=c.dynamic_scope,
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
    source_set_id, rule_json, dynamic_scope = _validate_kind_fields(
        req.kind, req.source_set_id, req.rule, req.dynamic_scope
    )
    collection = Collection(
        user_id=current_user.id,
        name=req.name.strip(),
        description=req.description,
        kind=req.kind,
        source_set_id=source_set_id,
        rule_json=rule_json,
        dynamic_scope=dynamic_scope,
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
    return serialize_collection_item(item)


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
    needs a valid ``rule`` and a scope (defaulting to ``owned``). Fields that
    don't belong to the chosen kind are dropped rather than stored as dead
    state."""
    if kind == COLLECTION_KIND_SET:
        if not source_set_id:
            raise HTTPException(status_code=422, detail="set collections require a source_set_id")
        return source_set_id, None, None
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
        dynamic_scope=collection.dynamic_scope,
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
