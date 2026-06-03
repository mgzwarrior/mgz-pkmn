"""Tests for `/api/v1/wishlists` (ADR-0013 slice 4).

Covers:

- Alembic migration up/down round-trip for `wishlists` and
  `wishlist_items` (including `max_price`).
- All CRUD endpoints + 404 paths.
- "Add card to wishlist" round-trip end-to-end, with and without `max_price`.
- Cascade delete: removing a wishlist drops its items.

Mirrors the isolation pattern from `tests/test_collections.py`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import inspect, select

from api.db import session as session_mod
from api.db.migrate import upgrade_head
from api.db.models import WishlistItem


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


SAMPLE_CARD = {
    "id": "base1-4",
    "name": "Charizard",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "4",
    "rarity": "Rare Holo",
    "images": {"small": "https://example.com/charizard.png"},
}


# ---------------------------------------------------------------------------
# Migration round-trip
# ---------------------------------------------------------------------------


class WishlistsMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_wishlists_tables(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("wishlists", names)
        self.assertIn("wishlist_items", names)

    def test_max_price_column_exists_on_items(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("wishlist_items")}
        self.assertIn("max_price", cols)

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("wishlists", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Step back to the collections revision so the wishlists tables
        # come down but the collections slice underneath survives.
        command.downgrade(cfg, "2b9da4eb7e17")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("wishlists", names)
        self.assertNotIn("wishlist_items", names)
        self.assertIn("collections", names)

        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("wishlists", names)
        self.assertIn("wishlist_items", names)


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


class WishlistsEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_list_is_empty_when_no_wishlists(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/wishlists")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"items": [], "total": 0})

    def test_create_then_list(self) -> None:
        with self._client() as c:
            created = c.post(
                "/api/v1/wishlists",
                json={"name": "Charizard hunt", "description": "every set"},
            )
            self.assertEqual(created.status_code, 201)
            body = created.json()
            self.assertEqual(body["name"], "Charizard hunt")
            self.assertEqual(body["description"], "every set")
            self.assertEqual(body["items"], [])
            self.assertTrue(body["id"])

            listing = c.get("/api/v1/wishlists").json()
            self.assertEqual(listing["total"], 1)
            self.assertEqual(listing["items"][0]["name"], "Charizard hunt")
            self.assertEqual(listing["items"][0]["item_count"], 0)

    def test_create_rejects_blank_name(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/wishlists", json={"name": ""})
            self.assertEqual(resp.status_code, 422)

    def test_get_404_for_missing(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/wishlists/9999")
            self.assertEqual(resp.status_code, 404)

    def test_patch_renames_and_clears_description(self) -> None:
        with self._client() as c:
            wid = c.post(
                "/api/v1/wishlists",
                json={"name": "Old", "description": "keep me"},
            ).json()["id"]

            renamed = c.patch(f"/api/v1/wishlists/{wid}", json={"name": "New"}).json()
            self.assertEqual(renamed["name"], "New")
            self.assertEqual(renamed["description"], "keep me")

            cleared = c.patch(f"/api/v1/wishlists/{wid}", json={"description": None}).json()
            self.assertIsNone(cleared["description"])

    def test_patch_404_for_missing(self) -> None:
        with self._client() as c:
            resp = c.patch("/api/v1/wishlists/9999", json={"name": "x"})
            self.assertEqual(resp.status_code, 404)

    def test_delete_wishlist_cascades_items(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "drop me"}).json()["id"]
            c.post(
                f"/api/v1/wishlists/{wid}/items",
                json={"card": SAMPLE_CARD, "max_price": 50.0},
            )
            resp = c.delete(f"/api/v1/wishlists/{wid}")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(c.get(f"/api/v1/wishlists/{wid}").status_code, 404)
            with session_mod.get_session_factory()() as s:
                self.assertEqual(
                    s.scalar(select(WishlistItem).where(WishlistItem.wishlist_id == wid)),
                    None,
                )

    def test_add_card_persists_max_price(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "Charizard hunt"}).json()["id"]

            added = c.post(
                f"/api/v1/wishlists/{wid}/items",
                json={"card": SAMPLE_CARD, "max_price": 75.5, "notes": "near-mint"},
            )
            self.assertEqual(added.status_code, 201)
            item = added.json()
            self.assertEqual(item["card"]["id"], "base1-4")
            self.assertEqual(item["notes"], "near-mint")
            self.assertEqual(item["max_price"], 75.5)

            detail = c.get(f"/api/v1/wishlists/{wid}").json()
            self.assertEqual(len(detail["items"]), 1)
            self.assertEqual(detail["items"][0]["max_price"], 75.5)

    def test_add_card_without_max_price_persists_null(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "no caps"}).json()["id"]
            added = c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD})
            self.assertEqual(added.status_code, 201)
            self.assertIsNone(added.json()["max_price"])

    def test_add_card_rejects_negative_max_price(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "x"}).json()["id"]
            resp = c.post(
                f"/api/v1/wishlists/{wid}/items",
                json={"card": SAMPLE_CARD, "max_price": -5},
            )
            self.assertEqual(resp.status_code, 422)

    def test_add_item_404_for_missing_wishlist(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/wishlists/9999/items", json={"card": SAMPLE_CARD})
            self.assertEqual(resp.status_code, 404)

    def test_delete_item_removes_one_and_returns_204(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "k"}).json()["id"]
            item_id = c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD}).json()[
                "id"
            ]
            resp = c.delete(f"/api/v1/wishlists/{wid}/items/{item_id}")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(len(c.get(f"/api/v1/wishlists/{wid}").json()["items"]), 0)

    def test_delete_item_404_when_wrong_wishlist(self) -> None:
        with self._client() as c:
            wid_a = c.post("/api/v1/wishlists", json={"name": "a"}).json()["id"]
            wid_b = c.post("/api/v1/wishlists", json={"name": "b"}).json()["id"]
            item_id = c.post(f"/api/v1/wishlists/{wid_a}/items", json={"card": SAMPLE_CARD}).json()[
                "id"
            ]
            resp = c.delete(f"/api/v1/wishlists/{wid_b}/items/{item_id}")
            self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
