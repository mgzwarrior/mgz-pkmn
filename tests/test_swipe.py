"""Tests for `/api/v1/swipe` — library-aware swipe-deck memory (#581).

Covers:

- Alembic migration up/down round-trip for `swipe_seen`.
- Recording a shown card + idempotent re-record (no duplicate row).
- `GET /swipe/excluded`: seen-only, plus opt-in owned / chasing unions.
- Reset: clearing the whole deck and scoping the reset to one set.

Mirrors the isolation pattern from `tests/test_wishlists.py`.
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
from sqlalchemy import func, inspect, select

from api.db import session as session_mod
from api.db.migrate import upgrade_head
from api.db.models import SwipeSeen


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


CHARIZARD = {
    "id": "base1-4",
    "name": "Charizard",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "4",
    "rarity": "Rare Holo",
    "images": {"small": "https://example.com/charizard.png"},
}
BLASTOISE = {
    "id": "base1-2",
    "name": "Blastoise",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "2",
    "rarity": "Rare Holo",
}
PIKACHU = {
    "id": "base1-58",
    "name": "Pikachu",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "58",
    "rarity": "Common",
}


# ---------------------------------------------------------------------------
# Migration round-trip
# ---------------------------------------------------------------------------


class SwipeMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_swipe_seen(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("swipe_seen", set(inspect(engine).get_table_names()))

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("swipe_seen", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Step back to the collections-rework revision underneath this one;
        # swipe_seen comes down, the rest of the schema survives.
        command.downgrade(cfg, "c01ec71011a7")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("swipe_seen", names)
        self.assertIn("collection_items", names)

        upgrade_head(engine)
        self.assertIn("swipe_seen", set(inspect(engine).get_table_names()))


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


class SwipeEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_excluded_is_empty_initially(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/swipe/excluded")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"cards": [], "total": 0})

    def test_record_seen_then_excluded(self) -> None:
        with self._client() as c:
            resp = c.post(
                "/api/v1/swipe/seen",
                json={"set_id": "base1", "number": "4", "dir": "save"},
            )
            self.assertEqual(resp.status_code, 204)

            body = c.get("/api/v1/swipe/excluded").json()
            self.assertEqual(body["total"], 1)
            self.assertEqual(body["cards"], [{"set_id": "base1", "number": "4"}])

    def test_record_seen_is_idempotent(self) -> None:
        with self._client() as c:
            for _ in range(3):
                resp = c.post(
                    "/api/v1/swipe/seen",
                    json={"set_id": "base1", "number": "4"},
                )
                self.assertEqual(resp.status_code, 204)

            body = c.get("/api/v1/swipe/excluded").json()
            self.assertEqual(body["total"], 1)
            with session_mod.get_session_factory()() as s:
                count = s.scalar(select(func.count(SwipeSeen.id)))
                self.assertEqual(count, 1)

    def test_excluded_owned_opt_in(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Show Binder"}).json()["id"]
            c.post(f"/api/v1/collections/{cid}/items", json={"card": BLASTOISE})

            # Owned card is invisible until the flag is set.
            self.assertEqual(c.get("/api/v1/swipe/excluded").json()["total"], 0)

            owned = c.get("/api/v1/swipe/excluded?owned=true").json()
            self.assertEqual(owned["total"], 1)
            self.assertIn({"set_id": "base1", "number": "2"}, owned["cards"])

    def test_excluded_chasing_opt_in(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "Hunt"}).json()["id"]
            c.post(f"/api/v1/wishlists/{wid}/items", json={"card": PIKACHU})

            self.assertEqual(c.get("/api/v1/swipe/excluded").json()["total"], 0)

            chasing = c.get("/api/v1/swipe/excluded?chasing=true").json()
            self.assertEqual(chasing["total"], 1)
            self.assertIn({"set_id": "base1", "number": "58"}, chasing["cards"])

    def test_excluded_unions_and_dedupes(self) -> None:
        with self._client() as c:
            # Charizard is both seen and owned — it must appear once.
            c.post("/api/v1/swipe/seen", json={"set_id": "base1", "number": "4"})
            cid = c.post("/api/v1/collections", json={"name": "Binder"}).json()["id"]
            c.post(f"/api/v1/collections/{cid}/items", json={"card": CHARIZARD})
            c.post(f"/api/v1/collections/{cid}/items", json={"card": BLASTOISE})
            wid = c.post("/api/v1/wishlists", json={"name": "Hunt"}).json()["id"]
            c.post(f"/api/v1/wishlists/{wid}/items", json={"card": PIKACHU})

            body = c.get("/api/v1/swipe/excluded?owned=true&chasing=true").json()
            pairs = {(card["set_id"], card["number"]) for card in body["cards"]}
            self.assertEqual(
                pairs,
                {("base1", "4"), ("base1", "2"), ("base1", "58")},
            )
            self.assertEqual(body["total"], 3)

    def test_reset_clears_all(self) -> None:
        with self._client() as c:
            c.post("/api/v1/swipe/seen", json={"set_id": "base1", "number": "4"})
            c.post("/api/v1/swipe/seen", json={"set_id": "sv8", "number": "100"})
            self.assertEqual(c.get("/api/v1/swipe/excluded").json()["total"], 2)

            resp = c.delete("/api/v1/swipe/seen")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(c.get("/api/v1/swipe/excluded").json()["total"], 0)

    def test_reset_scoped_to_one_set(self) -> None:
        with self._client() as c:
            c.post("/api/v1/swipe/seen", json={"set_id": "base1", "number": "4"})
            c.post("/api/v1/swipe/seen", json={"set_id": "sv8", "number": "100"})

            resp = c.delete("/api/v1/swipe/seen?set_id=base1")
            self.assertEqual(resp.status_code, 204)

            body = c.get("/api/v1/swipe/excluded").json()
            self.assertEqual(body["cards"], [{"set_id": "sv8", "number": "100"}])


if __name__ == "__main__":
    unittest.main()
