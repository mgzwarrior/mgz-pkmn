"""Per-user default wishlist + collection (ADR-0027, #759).

The one-tap ``Want`` / ``Own`` quick actions need a write target that exists
without asking the user to pick or create a list first. Every user gets exactly
one default wishlist and one default personal collection — ordinary
``wishlists`` / ``collections`` rows flagged ``is_default``, not a parallel
store. They're provisioned lazily here on first use; a partial unique index
(``uq_<table>_user_default``) keeps the one-default-per-user invariant even
under a concurrent first call.

Lifecycle (ADR-0027): the flag is the invariant, not the row. Renaming a
default keeps it the default (nothing here touches it). Deleting a default
leaves the user without one, so the next ``get_or_create_*`` call re-establishes
it. :func:`set_default_wishlist` / :func:`set_default_collection` reassign the
flag to another existing row rather than duplicating storage.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import COLLECTION_KIND_MANUAL, Collection, Wishlist

#: Names a freshly provisioned default gets. Plain and renameable — the user can
#: change them without losing default status.
DEFAULT_WISHLIST_NAME = "My wishlist"
DEFAULT_COLLECTION_NAME = "My collection"


def get_or_create_default_wishlist(db: Session, user_id: int) -> Wishlist:
    """Return the user's default wishlist, provisioning one if absent.

    Idempotent and safe against a concurrent first call: the partial unique
    index turns the losing insert into an ``IntegrityError`` we recover from by
    re-reading the now-present row."""
    existing = _default_wishlist(db, user_id)
    if existing is not None:
        return existing

    wishlist = Wishlist(user_id=user_id, name=DEFAULT_WISHLIST_NAME, is_default=True)
    db.add(wishlist)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        won = _default_wishlist(db, user_id)
        if won is None:  # pragma: no cover — the index guarantees a winner
            raise
        return won
    return wishlist


def get_or_create_default_collection(db: Session, user_id: int) -> Collection:
    """Return the user's default personal collection, provisioning one if absent.

    A plain ``manual`` collection (no binder, no rule). Same idempotency and
    race-recovery contract as :func:`get_or_create_default_wishlist`."""
    existing = _default_collection(db, user_id)
    if existing is not None:
        return existing

    collection = Collection(
        user_id=user_id,
        name=DEFAULT_COLLECTION_NAME,
        kind=COLLECTION_KIND_MANUAL,
        is_default=True,
    )
    db.add(collection)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        won = _default_collection(db, user_id)
        if won is None:  # pragma: no cover — the index guarantees a winner
            raise
        return won
    return collection


def set_default_wishlist(db: Session, user_id: int, wishlist_id: int) -> Wishlist:
    """Promote ``wishlist_id`` to the user's default, clearing the prior one.

    Clears the old default before setting the new one so the partial unique
    index never sees two defaults mid-flush. Raises ``ValueError`` if the
    wishlist isn't the user's."""
    target = db.get(Wishlist, wishlist_id)
    if target is None or target.user_id != user_id:
        raise ValueError(f"wishlist {wishlist_id} not found for user {user_id}")
    current = _default_wishlist(db, user_id)
    if current is not None and current.id != wishlist_id:
        current.is_default = False
        db.flush()
    target.is_default = True
    db.flush()
    return target


def set_default_collection(db: Session, user_id: int, collection_id: int) -> Collection:
    """Promote ``collection_id`` to the user's default, clearing the prior one.

    Mirror of :func:`set_default_wishlist` for collections."""
    target = db.get(Collection, collection_id)
    if target is None or target.user_id != user_id:
        raise ValueError(f"collection {collection_id} not found for user {user_id}")
    current = _default_collection(db, user_id)
    if current is not None and current.id != collection_id:
        current.is_default = False
        db.flush()
    target.is_default = True
    db.flush()
    return target


def _default_wishlist(db: Session, user_id: int) -> Wishlist | None:
    return db.scalars(
        select(Wishlist).where(Wishlist.user_id == user_id, Wishlist.is_default)
    ).first()


def _default_collection(db: Session, user_id: int) -> Collection | None:
    return db.scalars(
        select(Collection).where(Collection.user_id == user_id, Collection.is_default)
    ).first()
