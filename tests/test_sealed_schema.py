"""Tests for the #882 sealed-product + condition/grading schema (ADR-0029).

Covers:

- Alembic migration up/down round-trip for the four new tables and the
  ``target_*`` columns on ``wishlist_items``.
- FK + nullability constraints on sealed items and copies rows.
- Cascade delete: collection → sealed items → copies; wishlist → sealed items.
- ``acquired_collection_sealed_item_id`` SET NULL on collection-item delete.
- `api.db.product_payload.extract_product_identity` — flat and card-style
  nested payload shapes, malformed input.

Mirrors the isolation pattern from `tests/test_persistence.py` — each test
points `MGZ_PKMN_DATABASE_URL` at a fresh tempfile so the user's real
`~/.cache/mgz-pkmn/mgz-pkmn.db` is never touched.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.db import session as session_mod
from api.db.migrate import upgrade_head
from api.db.models import (
    DEFAULT_USER_ID,
    Collection,
    CollectionItem,
    CollectionItemCopy,
    CollectionSealedItem,
    CollectionSealedItemCopy,
    Wishlist,
    WishlistSealedItem,
)
from api.db.product_payload import extract_product_identity


class _IsolatedDbMixin(unittest.TestCase):
    """Point MGZ_PKMN_DATABASE_URL at a fresh sqlite file per test."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "test.db"
        self._old_url = os.environ.get("MGZ_PKMN_DATABASE_URL")
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        if self._old_url is None:
            os.environ.pop("MGZ_PKMN_DATABASE_URL", None)
        else:
            os.environ["MGZ_PKMN_DATABASE_URL"] = self._old_url
        self._tmp.cleanup()

    def _engine(self):
        engine = create_engine(f"sqlite:///{self._db_path}")

        # SQLite ships with FK enforcement off; turn it on so the declared
        # ON DELETE CASCADE / SET NULL behavior is actually exercised.
        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _record):  # pragma: no cover - trivial
            dbapi_conn.execute("PRAGMA foreign_keys=ON")

        return engine


SAMPLE_PRODUCT = {
    "name": "Scarlet & Violet 151 Booster Bundle",
    "set_id": "sv3pt5",
    "product_type": "bundle",
    "language": "en",
    "image_url": "https://example.com/151-bundle.jpg",
    "pricecharting_url": "https://www.pricecharting.com/game/pokemon-151/booster-bundle",
}


class MigrationRoundTripTests(_IsolatedDbMixin):
    def test_upgrade_creates_sealed_and_copies_tables(self) -> None:
        engine = self._engine()
        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertLessEqual(
            {
                "collection_sealed_items",
                "wishlist_sealed_items",
                "collection_item_copies",
                "collection_sealed_item_copies",
            },
            names,
        )
        wishlist_cols = {c["name"] for c in inspect(engine).get_columns("wishlist_items")}
        self.assertLessEqual(
            {"target_condition", "target_grading_company", "target_min_grade"}, wishlist_cols
        )

    def test_downgrade_removes_everything_then_reupgrades(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = self._engine()
        upgrade_head(engine)
        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Target the revision right before #882 by id rather than "-1" — later
        # migrations (e.g. #788) can land after this one in the chain, and a
        # relative offset would silently downgrade the wrong revision.
        command.downgrade(cfg, "c3d8f2a6b4e9")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("collection_sealed_items", names)
        self.assertNotIn("wishlist_sealed_items", names)
        self.assertNotIn("collection_item_copies", names)
        self.assertNotIn("collection_sealed_item_copies", names)
        wishlist_cols = {c["name"] for c in inspect(engine).get_columns("wishlist_items")}
        self.assertNotIn("target_condition", wishlist_cols)
        upgrade_head(engine)
        self.assertIn("collection_sealed_items", set(inspect(engine).get_table_names()))


class SealedItemConstraintTests(_IsolatedDbMixin):
    def _seeded_session(self) -> Session:
        engine = self._engine()
        upgrade_head(engine)
        return Session(engine)

    def test_sealed_item_requires_existing_collection(self) -> None:
        with self._seeded_session() as db:
            db.add(CollectionSealedItem(collection_id=9999, product_json=SAMPLE_PRODUCT))
            with self.assertRaises(IntegrityError):
                db.commit()

    def test_copy_requires_existing_item(self) -> None:
        with self._seeded_session() as db:
            db.add(CollectionItemCopy(collection_item_id=9999, condition="NM"))
            with self.assertRaises(IntegrityError):
                db.commit()

    def test_sealed_item_round_trip_with_copies_and_cascade(self) -> None:
        with self._seeded_session() as db:
            collection = Collection(user_id=DEFAULT_USER_ID, name="Sealed Stash")
            item = CollectionSealedItem(
                product_json=SAMPLE_PRODUCT,
                quantity=3,
                **extract_product_identity(SAMPLE_PRODUCT),
            )
            item.copies = [
                CollectionSealedItemCopy(quantity=2, condition="sealed"),
                CollectionSealedItemCopy(
                    quantity=1,
                    condition="opened",
                    grading_company="CGC",
                    grade=9.5,
                    cert_number="1234567890",
                ),
            ]
            collection.sealed_items.append(item)
            db.add(collection)
            db.commit()

            got = db.get(CollectionSealedItem, item.id)
            assert got is not None
            self.assertEqual(got.product_set_id, "sv3pt5")
            self.assertEqual(got.product_type, "bundle")
            self.assertEqual(len(got.copies), 2)
            self.assertEqual(got.copies[1].grade, 9.5)

            db.delete(collection)
            db.commit()
            self.assertIsNone(db.get(CollectionSealedItem, item.id))
            self.assertEqual(db.query(CollectionSealedItemCopy).count(), 0)

    def test_card_item_copies_round_trip(self) -> None:
        with self._seeded_session() as db:
            collection = Collection(user_id=DEFAULT_USER_ID, name="Binder")
            card = CollectionItem(card_json={"name": "Charizard"}, quantity=3)
            card.copies = [
                CollectionItemCopy(quantity=2, condition="NM"),
                CollectionItemCopy(quantity=1, grading_company="PSA", grade=9),
            ]
            collection.items.append(card)
            db.add(collection)
            db.commit()

            got = db.get(CollectionItem, card.id)
            assert got is not None
            self.assertEqual(len(got.copies), 2)
            self.assertIsNone(got.copies[1].condition)
            self.assertEqual(got.copies[1].grading_company, "PSA")

    def test_wishlist_sealed_item_targets_and_acquired_set_null(self) -> None:
        with self._seeded_session() as db:
            collection = Collection(user_id=DEFAULT_USER_ID, name="Sealed Stash")
            owned = CollectionSealedItem(product_json=SAMPLE_PRODUCT)
            collection.sealed_items.append(owned)
            wishlist = Wishlist(user_id=DEFAULT_USER_ID, name="Chases")
            chase = WishlistSealedItem(
                product_json=SAMPLE_PRODUCT,
                target_condition="sealed",
                target_grading_company="PSA",
                target_min_grade=9,
                **extract_product_identity(SAMPLE_PRODUCT),
            )
            wishlist.sealed_items.append(chase)
            db.add_all([collection, wishlist])
            db.commit()

            chase.acquired_collection_sealed_item_id = owned.id
            db.commit()

            db.delete(owned)
            db.commit()
            db.refresh(chase)
            self.assertIsNone(chase.acquired_collection_sealed_item_id)
            self.assertEqual(chase.target_condition, "sealed")

            db.delete(wishlist)
            db.commit()
            self.assertEqual(db.query(WishlistSealedItem).count(), 0)


class ExtractProductIdentityTests(unittest.TestCase):
    def test_pulls_every_field_from_flat_payload(self) -> None:
        got = extract_product_identity(SAMPLE_PRODUCT)
        self.assertEqual(
            got,
            {
                "product_set_id": "sv3pt5",
                "product_name": "Scarlet & Violet 151 Booster Bundle",
                "product_type": "bundle",
                "product_language": "en",
                "product_image_url": "https://example.com/151-bundle.jpg",
            },
        )

    def test_accepts_card_style_nested_shape(self) -> None:
        got = extract_product_identity(
            {
                "name": "Evolving Skies Booster Box",
                "set": {"id": "swsh7", "name": "Evolving Skies"},
                "type": "booster-box",
                "images": {"small": "https://example.com/es-box.jpg"},
            }
        )
        self.assertEqual(got["product_set_id"], "swsh7")
        self.assertEqual(got["product_type"], "booster-box")
        self.assertEqual(got["product_image_url"], "https://example.com/es-box.jpg")
        self.assertIsNone(got["product_language"])

    def test_flat_keys_win_over_nested(self) -> None:
        got = extract_product_identity(
            {"set_id": "sv1", "set": {"id": "swsh7"}, "product_type": "tin", "type": "other"}
        )
        self.assertEqual(got["product_set_id"], "sv1")
        self.assertEqual(got["product_type"], "tin")

    def test_malformed_payloads_yield_all_nulls(self) -> None:
        all_null = {
            "product_set_id": None,
            "product_name": None,
            "product_type": None,
            "product_language": None,
            "product_image_url": None,
        }
        self.assertEqual(extract_product_identity(None), all_null)
        self.assertEqual(extract_product_identity({}), all_null)
        self.assertEqual(extract_product_identity("not a dict"), all_null)  # type: ignore[arg-type]
        self.assertEqual(
            extract_product_identity({"name": "  ", "set": "sv1", "images": ["x"]}), all_null
        )


if __name__ == "__main__":
    unittest.main()
