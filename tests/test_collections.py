"""Tests for `/api/v1/collections` (ADR-0013 slice 3).

Covers:

- Alembic migration up/down round-trip for `collections` and
  `collection_items`.
- All CRUD endpoints + 404 paths.
- "Add card to collection" round-trip end-to-end.
- Cascade delete: removing a collection drops its items.

Mirrors the isolation pattern from `tests/test_persistence.py` — each
test points `MGZ_PKMN_DATABASE_URL` at a fresh tempfile so the user's
real `~/.cache/mgz-pkmn/mgz-pkmn.db` is never touched.
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
from api.db.models import CollectionItem


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


class CollectionsMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_collections_tables(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("collections", names)
        self.assertIn("collection_items", names)

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("collections", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Step back one revision to drop just the collections tables —
        # the auth-foundation slice underneath should survive.
        command.downgrade(cfg, "-1")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("collections", names)
        self.assertNotIn("collection_items", names)
        self.assertIn("users", names)

        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("collections", names)
        self.assertIn("collection_items", names)


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


class CollectionsEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_list_is_empty_when_no_collections(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/collections")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body, {"items": [], "total": 0})

    def test_create_then_list(self) -> None:
        with self._client() as c:
            created = c.post(
                "/api/v1/collections",
                json={"name": "Binder candidates", "description": "for the show"},
            )
            self.assertEqual(created.status_code, 201)
            body = created.json()
            self.assertEqual(body["name"], "Binder candidates")
            self.assertEqual(body["description"], "for the show")
            self.assertEqual(body["items"], [])
            self.assertTrue(body["id"])

            listing = c.get("/api/v1/collections").json()
            self.assertEqual(listing["total"], 1)
            self.assertEqual(listing["items"][0]["name"], "Binder candidates")
            self.assertEqual(listing["items"][0]["item_count"], 0)

    def test_create_rejects_blank_name(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections", json={"name": ""})
            self.assertEqual(resp.status_code, 422)

    def test_get_404_for_missing(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/collections/9999")
            self.assertEqual(resp.status_code, 404)

    def test_patch_renames_and_clears_description(self) -> None:
        with self._client() as c:
            cid = c.post(
                "/api/v1/collections",
                json={"name": "Old", "description": "keep me"},
            ).json()["id"]

            renamed = c.patch(f"/api/v1/collections/{cid}", json={"name": "New"}).json()
            self.assertEqual(renamed["name"], "New")
            # description omitted from the PATCH body — preserved.
            self.assertEqual(renamed["description"], "keep me")

            cleared = c.patch(f"/api/v1/collections/{cid}", json={"description": None}).json()
            self.assertIsNone(cleared["description"])

    def test_patch_404_for_missing(self) -> None:
        with self._client() as c:
            resp = c.patch("/api/v1/collections/9999", json={"name": "x"})
            self.assertEqual(resp.status_code, 404)

    def test_delete_collection_cascades_items(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "delete me"}).json()["id"]
            c.post(
                f"/api/v1/collections/{cid}/items",
                json={"card": SAMPLE_CARD},
            )
            resp = c.delete(f"/api/v1/collections/{cid}")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(c.get(f"/api/v1/collections/{cid}").status_code, 404)
            # No orphaned items left behind.
            with session_mod.get_session_factory()() as s:
                self.assertEqual(
                    s.scalar(select(CollectionItem).where(CollectionItem.collection_id == cid)),
                    None,
                )

    def test_add_card_round_trip(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Charizard masters"}).json()["id"]

            added = c.post(
                f"/api/v1/collections/{cid}/items",
                json={"card": SAMPLE_CARD, "notes": "near-mint"},
            )
            self.assertEqual(added.status_code, 201)
            item = added.json()
            self.assertEqual(item["card"]["id"], "base1-4")
            self.assertEqual(item["notes"], "near-mint")
            self.assertTrue(item["id"])

            detail = c.get(f"/api/v1/collections/{cid}").json()
            self.assertEqual(len(detail["items"]), 1)
            self.assertEqual(detail["items"][0]["card"]["name"], "Charizard")

            listing = c.get("/api/v1/collections").json()
            self.assertEqual(listing["items"][0]["item_count"], 1)

    def test_add_item_404_for_missing_collection(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections/9999/items", json={"card": SAMPLE_CARD})
            self.assertEqual(resp.status_code, 404)

    def test_delete_item_removes_one_and_returns_204(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "k"}).json()["id"]
            item_id = c.post(f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD}).json()[
                "id"
            ]

            resp = c.delete(f"/api/v1/collections/{cid}/items/{item_id}")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(len(c.get(f"/api/v1/collections/{cid}").json()["items"]), 0)

    def test_delete_item_404_when_wrong_collection(self) -> None:
        with self._client() as c:
            cid_a = c.post("/api/v1/collections", json={"name": "a"}).json()["id"]
            cid_b = c.post("/api/v1/collections", json={"name": "b"}).json()["id"]
            item_id = c.post(
                f"/api/v1/collections/{cid_a}/items", json={"card": SAMPLE_CARD}
            ).json()["id"]

            # Item exists, but not in collection B.
            resp = c.delete(f"/api/v1/collections/{cid_b}/items/{item_id}")
            self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
