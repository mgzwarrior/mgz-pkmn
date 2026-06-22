"""Aggregate "your collection at a glance" dashboard (#575, expanded in #741).

The response shapes and the pure rollup that backs ``GET
/collections/insights`` live here so [collections.py](./collections.py) keeps
to CRUD + binder routing. The route handler itself (the SQL read + assembly)
stays in that module next to the rest of the collections API.

Every breakdown is computed live from the promoted card-identity columns —
indexed SQL plus a small in-Python rollup, not a ``card_json`` scan. Dynamic
collections own no rows, so they never appear here; their owned-scope
membership is a filtered view of cards already counted, and double-counting
them would inflate every total.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Wishlist, WishlistItem


class InsightsTotals(BaseModel):
    """Headline counters across every collection the user owns."""

    collections: int
    #: Distinct ``(set_id, number)`` identities, plus each identity-less row.
    unique_cards: int
    #: Sum of ``quantity`` — counts vendor multiples.
    total_quantity: int
    #: Sum of ``price_snapshot * quantity`` over priced rows. Live per-card
    #: snapshots, not a ``collection_snapshots`` read — that table's writer
    #: is #508, so value-over-time stays out of this slice.
    estimated_value: float


class LabeledCount(BaseModel):
    """One bar in a top-N breakdown — a label and its distinct-card count."""

    label: str
    count: int


class DuplicateCard(BaseModel):
    """A row a vendor holds in multiples within a single collection."""

    card_name: str | None
    card_set_id: str | None
    card_number: str | None
    quantity: int
    collection_name: str


class CrossCollectionCard(BaseModel):
    """One card identity that shows up in two or more collections."""

    card_name: str | None
    card_set_id: str | None
    card_number: str | None
    total_quantity: int
    collections: list[str]


class AlreadyOwnedChase(BaseModel):
    """A want-list card the user already owns in a collection — a cleanup
    nudge (wishlist ∩ collection)."""

    card_name: str | None
    card_set_id: str | None
    card_number: str | None
    wishlist_id: int
    wishlist_name: str
    collections: list[str]


class ValueCard(BaseModel):
    """A single owned card identity ranked by its per-copy price snapshot —
    the collection's "crown jewels" list."""

    card_name: str | None
    card_set_id: str | None
    card_number: str | None
    price: float


class LabeledValue(BaseModel):
    """One bar in a value breakdown — a label and its summed estimated value
    (``price_snapshot * quantity``)."""

    label: str
    value: float


class CollectionInsightsOut(BaseModel):
    totals: InsightsTotals
    top_types: list[LabeledCount]
    top_rarities: list[LabeledCount]
    top_sets: list[LabeledCount]
    top_value_cards: list[ValueCard]
    value_by_set: list[LabeledValue]
    value_by_collection: list[LabeledValue]
    duplicate_multiples: list[DuplicateCard]
    cross_collection: list[CrossCollectionCard]
    already_owned_chasing: list[AlreadyOwnedChase]


#: How many bars each top-N breakdown returns, and how many cards the
#: duplicate / cleanup lists cap at, so the payload stays bounded.
_TOP_N = 8
_LIST_CAP = 25


def _identity(set_id: str | None, number: str | None) -> tuple[str, str] | None:
    """The ``(set_id, number)`` handle, or None when the row predates the
    promoted-identity backfill and can't be grouped."""
    if set_id is None or number is None:
        return None
    return (set_id, number)


def _top_labels(buckets: dict[str, set]) -> list[LabeledCount]:
    """Top-N labels by distinct-card count, ties broken alphabetically."""
    ranked = sorted(buckets.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    return [LabeledCount(label=label, count=len(cards)) for label, cards in ranked[:_TOP_N]]


def _top_values(buckets: dict[str, float]) -> list[LabeledValue]:
    """Top-N labels by summed value, ties broken alphabetically. Empty
    (zero-value) buckets are dropped so the breakdown only shows priced rows."""
    ranked = sorted(
        ((label, value) for label, value in buckets.items() if value > 0),
        key=lambda kv: (-kv[1], kv[0]),
    )
    return [LabeledValue(label=label, value=round(value, 2)) for label, value in ranked[:_TOP_N]]


def aggregate_items(rows: list) -> dict[str, Any]:
    """Roll the user's materialized collection items up into the dashboard's
    breakdowns. See the module docstring for why dynamic collections are
    absent from ``rows`` and must stay that way."""
    total_quantity = 0
    unique_extra = 0  # identity-less rows, each its own "unique" card
    estimated_value = 0.0
    type_cards: dict[str, set] = defaultdict(set)
    rarity_cards: dict[str, set] = defaultdict(set)
    set_cards: dict[str, set] = defaultdict(set)
    set_value: dict[str, float] = defaultdict(float)
    collection_value: dict[str, float] = defaultdict(float)
    owned_collections: dict[tuple, set] = defaultdict(set)
    owned_quantity: dict[tuple, int] = defaultdict(int)
    owned_price: dict[tuple, float] = {}  # best per-copy snapshot per identity
    owned_meta: dict[tuple, dict] = {}
    multiples: list[DuplicateCard] = []

    for set_id, number, name, rarity, types, quantity, price, coll_name in rows:
        qty = quantity or 0
        total_quantity += qty
        if price is not None:
            unit = float(price)
            estimated_value += unit * qty
            collection_value[coll_name] += unit * qty
            if set_id:
                set_value[set_id] += unit * qty
        ident = _identity(set_id, number)
        if ident is None:
            unique_extra += 1
        else:
            owned_collections[ident].add(coll_name)
            owned_quantity[ident] += qty
            owned_meta[ident] = {"card_name": name, "card_set_id": set_id, "card_number": number}
            if price is not None:
                owned_price[ident] = max(owned_price.get(ident, 0.0), float(price))
            if set_id:
                set_cards[set_id].add(ident)
            if rarity:
                rarity_cards[rarity].add(ident)
            for t in types or []:
                type_cards[t].add(ident)
        if qty > 1:
            multiples.append(
                DuplicateCard(
                    card_name=name,
                    card_set_id=set_id,
                    card_number=number,
                    quantity=qty,
                    collection_name=coll_name,
                )
            )

    multiples.sort(key=lambda d: (-d.quantity, d.card_name or ""))
    cross = [
        CrossCollectionCard(
            total_quantity=owned_quantity[ident],
            collections=sorted(names),
            **owned_meta[ident],
        )
        for ident, names in owned_collections.items()
        if len(names) >= 2
    ]
    cross.sort(key=lambda c: (-len(c.collections), -c.total_quantity, c.card_name or ""))

    top_value_cards = [
        ValueCard(price=round(owned_price[ident], 2), **owned_meta[ident])
        for ident in sorted(
            owned_price, key=lambda i: (-owned_price[i], owned_meta[i]["card_name"] or "")
        )[:_TOP_N]
    ]

    return {
        "total_quantity": total_quantity,
        "unique_cards": len(owned_meta) + unique_extra,
        "estimated_value": round(estimated_value, 2),
        "top_types": _top_labels(type_cards),
        "top_rarities": _top_labels(rarity_cards),
        "top_sets": _top_labels(set_cards),
        "top_value_cards": top_value_cards,
        "value_by_set": _top_values(set_value),
        "value_by_collection": _top_values(collection_value),
        "duplicate_multiples": multiples[:_LIST_CAP],
        "cross_collection": cross[:_LIST_CAP],
        "owned_collections": owned_collections,
    }


def already_owned_chasing(
    db: Session, user_id: int, owned_collections: dict[tuple, set]
) -> list[AlreadyOwnedChase]:
    """Want-list cards the user already owns — the quiet cleanup nudge.
    Acquired (``got it``) rows are excluded: they're intentionally kept as a
    retrospective, not stale chases."""
    rows = db.execute(
        select(
            WishlistItem.card_set_id,
            WishlistItem.card_number,
            WishlistItem.card_name,
            Wishlist.id,
            Wishlist.name,
        )
        .join(Wishlist, WishlistItem.wishlist_id == Wishlist.id)
        .where(Wishlist.user_id == user_id, WishlistItem.acquired_at.is_(None))
    ).all()
    out: list[AlreadyOwnedChase] = []
    for set_id, number, name, wl_id, wl_name in rows:
        ident = _identity(set_id, number)
        if ident is None or ident not in owned_collections:
            continue
        out.append(
            AlreadyOwnedChase(
                card_name=name,
                card_set_id=set_id,
                card_number=number,
                wishlist_id=wl_id,
                wishlist_name=wl_name,
                collections=sorted(owned_collections[ident]),
            )
        )
    return out[:_LIST_CAP]
