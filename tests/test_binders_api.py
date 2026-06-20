"""Tests for `/api/v1/binders` — physical binders that hold collections (#702).

Covers:

- Alembic migration up/down round-trip for the `binders` table and the
  `collections.binder_id` column.
- All CRUD endpoints + 404 / validation paths.
- An empty binder reads as `is_empty`; filing a collection flips it.
- Deleting a binder detaches its collections (cards survive) rather than
  cascading them away.

Mirrors the per-test tempfile DB isolation from `tests/test_collections.py`.
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
from api.db.models import Collection


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


class BindersMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_binders_table_and_fk_column(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        insp = inspect(engine)
        self.assertIn("binders", insp.get_table_names())
        binder_cols = {c["name"] for c in insp.get_columns("binders")}
        for col in ("id", "user_id", "name", "created_at", "binder_format", "capacity"):
            self.assertIn(col, binder_cols, f"expected binders.{col}")
        collection_cols = {c["name"] for c in insp.get_columns("collections")}
        self.assertIn("binder_id", collection_cols)

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("binders", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Downgrade to the revision just before the binders slice.
        command.downgrade(cfg, "a3e8c5b1d9f4")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("binders", names)
        self.assertNotIn(
            "binder_id", {c["name"] for c in inspect(engine).get_columns("collections")}
        )
        self.assertIn("collections", names)

        command.upgrade(cfg, "head")
        self.assertIn("binders", set(inspect(engine).get_table_names()))


class BindersEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_list_is_empty_when_no_binders(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/binders")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"binders": []})

    def test_create_empty_binder_then_list(self) -> None:
        with self._client() as c:
            created = c.post(
                "/api/v1/binders",
                json={"name": "Base Set binder", "binder_format": "9-pocket", "capacity": 360},
            )
            self.assertEqual(created.status_code, 201)
            body = created.json()
            self.assertEqual(body["name"], "Base Set binder")
            self.assertEqual(body["binder_format"], "9-pocket")
            self.assertEqual(body["capacity"], 360)
            self.assertEqual(body["collection_count"], 0)
            self.assertTrue(body["is_empty"])
            self.assertEqual(body["collections"], [])

            listing = c.get("/api/v1/binders").json()
            self.assertEqual(len(listing["binders"]), 1)
            self.assertTrue(listing["binders"][0]["is_empty"])

    def test_create_rejects_blank_name(self) -> None:
        with self._client() as c:
            self.assertEqual(c.post("/api/v1/binders", json={"name": ""}).status_code, 422)

    def test_create_rejects_unknown_format(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/binders", json={"name": "X", "binder_format": "7-pocket"})
            self.assertEqual(resp.status_code, 422)

    def test_get_404_for_missing(self) -> None:
        with self._client() as c:
            self.assertEqual(c.get("/api/v1/binders/9999").status_code, 404)

    def test_patch_renames_and_updates_identity(self) -> None:
        with self._client() as c:
            bid = c.post("/api/v1/binders", json={"name": "Old", "binder_color": "palm"}).json()[
                "id"
            ]
            renamed = c.patch(
                f"/api/v1/binders/{bid}",
                json={"name": "New", "binder_color": "sun"},
            ).json()
            self.assertEqual(renamed["name"], "New")
            self.assertEqual(renamed["binder_color"], "sun")

    def test_filing_a_collection_flips_is_empty_and_delete_detaches(self) -> None:
        with self._client() as c:
            bid = c.post("/api/v1/binders", json={"name": "Holos"}).json()["id"]
            cid = c.post("/api/v1/collections", json={"name": "Base holos"}).json()["id"]

            # Assigning a collection into a binder is #3's endpoint; for now
            # wire the FK directly so we can exercise the binder-side behavior.
            factory = session_mod.get_session_factory()
            with factory() as db:
                coll = db.scalar(select(Collection).where(Collection.id == cid))
                coll.binder_id = bid
                db.commit()

            detail = c.get(f"/api/v1/binders/{bid}").json()
            self.assertFalse(detail["is_empty"])
            self.assertEqual(detail["collection_count"], 1)
            self.assertEqual(detail["collections"][0]["name"], "Base holos")

            self.assertEqual(c.delete(f"/api/v1/binders/{bid}").status_code, 204)
            # The collection survives the binder, now unfiled.
            still = c.get(f"/api/v1/collections/{cid}")
            self.assertEqual(still.status_code, 200)


if __name__ == "__main__":
    unittest.main()
