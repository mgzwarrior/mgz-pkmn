"""Tests for per-user default wishlist + collection (ADR-0027, #759).

Covers the find-or-create helpers, the one-default-per-user invariant enforced
by the partial unique index, the default-row lifecycle rules from ADR-0027
(rename keeps the default, delete re-establishes one), and flag reassignment.

Reuses the isolated-tempfile-DB pattern from `tests/test_collections.py`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.exc import IntegrityError

from api.db import session as session_mod
from api.db.defaults import (
    DEFAULT_COLLECTION_NAME,
    DEFAULT_WISHLIST_NAME,
    get_or_create_default_collection,
    get_or_create_default_wishlist,
    set_default_collection,
    set_default_wishlist,
)
from api.db.migrate import upgrade_head
from api.db.models import DEFAULT_USER_ID, Collection, User, Wishlist


class _IsolatedDbMixin(unittest.TestCase):
    """Point MGZ_PKMN_DATABASE_URL at a fresh sqlite file per test."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "test.db"
        self._old_url = os.environ.get("MGZ_PKMN_DATABASE_URL")
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        session_mod.reset_engine()
        upgrade_head(session_mod.get_engine())
        self._Session = session_mod.get_session_factory()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        if self._old_url is None:
            os.environ.pop("MGZ_PKMN_DATABASE_URL", None)
        else:
            os.environ["MGZ_PKMN_DATABASE_URL"] = self._old_url
        self._tmp.cleanup()


class DefaultWishlistTests(_IsolatedDbMixin):
    def test_creates_one_default_then_returns_it(self) -> None:
        with self._Session() as db:
            first = get_or_create_default_wishlist(db, DEFAULT_USER_ID)
            db.commit()
            self.assertTrue(first.is_default)
            self.assertEqual(first.name, DEFAULT_WISHLIST_NAME)

        with self._Session() as db:
            second = get_or_create_default_wishlist(db, DEFAULT_USER_ID)
            db.commit()
            self.assertEqual(second.id, first.id)
            count = db.query(Wishlist).filter_by(user_id=DEFAULT_USER_ID, is_default=True).count()
            self.assertEqual(count, 1)

    def test_partial_unique_index_blocks_a_second_default(self) -> None:
        with self._Session() as db:
            get_or_create_default_wishlist(db, DEFAULT_USER_ID)
            db.commit()
            db.add(Wishlist(user_id=DEFAULT_USER_ID, name="sneaky", is_default=True))
            with self.assertRaises(IntegrityError):
                db.flush()

    def test_rename_keeps_default_status(self) -> None:
        with self._Session() as db:
            wl = get_or_create_default_wishlist(db, DEFAULT_USER_ID)
            wl.name = "Allentown chase"
            db.commit()

        with self._Session() as db:
            again = get_or_create_default_wishlist(db, DEFAULT_USER_ID)
            self.assertEqual(again.name, "Allentown chase")
            self.assertTrue(again.is_default)

    def test_delete_re_establishes_a_default(self) -> None:
        with self._Session() as db:
            original = get_or_create_default_wishlist(db, DEFAULT_USER_ID)
            db.delete(original)
            db.commit()
            # Deleting the default leaves the user without one.
            self.assertEqual(
                db.query(Wishlist).filter_by(user_id=DEFAULT_USER_ID, is_default=True).count(), 0
            )

        with self._Session() as db:
            fresh = get_or_create_default_wishlist(db, DEFAULT_USER_ID)
            db.commit()
            # The next quick action provisions a fresh default.
            self.assertTrue(fresh.is_default)
            self.assertEqual(fresh.name, DEFAULT_WISHLIST_NAME)
            self.assertEqual(
                db.query(Wishlist).filter_by(user_id=DEFAULT_USER_ID, is_default=True).count(), 1
            )

    def test_set_default_reassigns_the_flag(self) -> None:
        with self._Session() as db:
            old = get_or_create_default_wishlist(db, DEFAULT_USER_ID)
            other = Wishlist(user_id=DEFAULT_USER_ID, name="Trade pile")
            db.add(other)
            db.flush()
            promoted = set_default_wishlist(db, DEFAULT_USER_ID, other.id)
            db.commit()
            self.assertTrue(promoted.is_default)
            self.assertFalse(db.get(Wishlist, old.id).is_default)
            count = db.query(Wishlist).filter_by(user_id=DEFAULT_USER_ID, is_default=True).count()
            self.assertEqual(count, 1)

    def test_set_default_rejects_another_users_wishlist(self) -> None:
        with self._Session() as db:
            stranger = User(name="stranger")
            db.add(stranger)
            db.flush()
            theirs = Wishlist(user_id=stranger.id, name="not mine")
            db.add(theirs)
            db.flush()
            with self.assertRaises(ValueError):
                set_default_wishlist(db, DEFAULT_USER_ID, theirs.id)


class DefaultCollectionTests(_IsolatedDbMixin):
    def test_creates_one_default_then_returns_it(self) -> None:
        with self._Session() as db:
            first = get_or_create_default_collection(db, DEFAULT_USER_ID)
            db.commit()
            self.assertTrue(first.is_default)
            self.assertEqual(first.name, DEFAULT_COLLECTION_NAME)
            self.assertEqual(first.kind, "manual")

        with self._Session() as db:
            second = get_or_create_default_collection(db, DEFAULT_USER_ID)
            db.commit()
            self.assertEqual(second.id, first.id)

    def test_partial_unique_index_blocks_a_second_default(self) -> None:
        with self._Session() as db:
            get_or_create_default_collection(db, DEFAULT_USER_ID)
            db.commit()
            db.add(Collection(user_id=DEFAULT_USER_ID, name="sneaky", is_default=True))
            with self.assertRaises(IntegrityError):
                db.flush()

    def test_set_default_reassigns_the_flag(self) -> None:
        with self._Session() as db:
            old = get_or_create_default_collection(db, DEFAULT_USER_ID)
            other = Collection(user_id=DEFAULT_USER_ID, name="Graded slabs")
            db.add(other)
            db.flush()
            promoted = set_default_collection(db, DEFAULT_USER_ID, other.id)
            db.commit()
            self.assertTrue(promoted.is_default)
            self.assertFalse(db.get(Collection, old.id).is_default)

    def test_defaults_are_per_user(self) -> None:
        with self._Session() as db:
            second_user = User(name="second")
            db.add(second_user)
            db.flush()
            mine = get_or_create_default_collection(db, DEFAULT_USER_ID)
            theirs = get_or_create_default_collection(db, second_user.id)
            db.commit()
            self.assertNotEqual(mine.id, theirs.id)
            self.assertEqual(mine.user_id, DEFAULT_USER_ID)
            self.assertEqual(theirs.user_id, second_user.id)


if __name__ == "__main__":
    unittest.main()
