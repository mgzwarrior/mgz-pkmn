"""Tests for `/api/v1/favorite-sets` — per-user pinned favorite sets (#712).

Covers:

- Alembic migration up/down round-trip for the `favorite_sets` table.
- CRUD: list, idempotent pin, unpin (including unpin-of-unpinned no-op).
- Suggestions: owned `collection_items` tallied per set, ranked, with the
  already-pinned sets dropped.

Mirrors the per-test tempfile DB isolation from `tests/test_swipe.py`.
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
from sqlalchemy import inspect

from api.db import session as session_mod
from api.db.migrate import upgrade_head

CHARIZARD = {
    "id": "base1-4",
    "name": "Charizard",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "4",
    "rarity": "Rare Holo",
}
BLASTOISE = {
    "id": "base1-2",
    "name": "Blastoise",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "2",
    "rarity": "Rare Holo",
}
MEW_EX = {
    "id": "sv4pt5-205",
    "name": "Mew ex",
    "set": {"id": "sv4pt5", "name": "151"},
    "number": "205",
    "rarity": "Special Illustration Rare",
}


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

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)


class FavoriteSetsMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_table_then_downgrade_drops_it(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        insp = inspect(engine)
        self.assertIn("favorite_sets", insp.get_table_names())
        cols = {c["name"] for c in insp.get_columns("favorite_sets")}
        self.assertEqual(cols, {"id", "user_id", "set_id", "pinned_at"})
        self.assertIn(
            "ix_favorite_sets_user_id",
            {i["name"] for i in insp.get_indexes("favorite_sets")},
        )

        from alembic.command import downgrade
        from alembic.config import Config

        cfg = Config(str(Path(__file__).resolve().parents[1] / "api" / "alembic.ini"))
        downgrade(cfg, "-1")
        self.assertNotIn("favorite_sets", inspect(session_mod.get_engine()).get_table_names())


class FavoriteSetsCrudTests(_IsolatedDbMixin):
    def test_list_is_empty_initially(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/favorite-sets")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"sets": []})

    def test_pin_then_list(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.post("/api/v1/favorite-sets", json={"set_id": "base1"}).status_code,
                204,
            )
            body = c.get("/api/v1/favorite-sets").json()
            self.assertEqual([s["set_id"] for s in body["sets"]], ["base1"])
            self.assertIn("pinned_at", body["sets"][0])

    def test_pin_is_idempotent(self) -> None:
        with self._client() as c:
            c.post("/api/v1/favorite-sets", json={"set_id": "base1"})
            c.post("/api/v1/favorite-sets", json={"set_id": "base1"})
            body = c.get("/api/v1/favorite-sets").json()
            self.assertEqual(len(body["sets"]), 1)

    def test_pin_rejects_blank_set_id(self) -> None:
        with self._client() as c:
            self.assertEqual(c.post("/api/v1/favorite-sets", json={"set_id": ""}).status_code, 422)

    def test_unpin_removes_only_that_set(self) -> None:
        with self._client() as c:
            c.post("/api/v1/favorite-sets", json={"set_id": "base1"})
            c.post("/api/v1/favorite-sets", json={"set_id": "sv4pt5"})
            self.assertEqual(c.delete("/api/v1/favorite-sets/base1").status_code, 204)
            remaining = [s["set_id"] for s in c.get("/api/v1/favorite-sets").json()["sets"]]
            self.assertEqual(remaining, ["sv4pt5"])

    def test_unpin_unpinned_is_a_noop(self) -> None:
        with self._client() as c:
            self.assertEqual(c.delete("/api/v1/favorite-sets/never-pinned").status_code, 204)


class FavoriteSetSuggestionTests(_IsolatedDbMixin):
    def _own(self, c: TestClient, cards: list[dict], quantity: int = 1) -> None:
        cid = c.post("/api/v1/collections", json={"name": "Owned"}).json()["id"]
        for card in cards:
            c.post(
                f"/api/v1/collections/{cid}/items",
                json={"card": card, "quantity": quantity},
            )

    def test_suggestions_rank_sets_by_owned_count(self) -> None:
        with self._client() as c:
            self._own(c, [CHARIZARD, BLASTOISE, MEW_EX])  # base1: 2, sv4pt5: 1
            body = c.get("/api/v1/favorite-sets/suggestions").json()["suggestions"]
            self.assertEqual(
                [(s["set_id"], s["owned_count"]) for s in body],
                [("base1", 2), ("sv4pt5", 1)],
            )

    def test_suggestions_drop_already_pinned_sets(self) -> None:
        with self._client() as c:
            self._own(c, [CHARIZARD, BLASTOISE, MEW_EX])
            c.post("/api/v1/favorite-sets", json={"set_id": "base1"})
            body = c.get("/api/v1/favorite-sets/suggestions").json()["suggestions"]
            self.assertEqual([s["set_id"] for s in body], ["sv4pt5"])

    def test_suggestions_count_owned_copies_not_rows(self) -> None:
        # One sv4pt5 row with quantity 5 must out-rank two base1 rows of 1.
        with self._client() as c:
            self._own(c, [CHARIZARD, BLASTOISE])  # base1: 2 copies across 2 rows
            self._own(c, [MEW_EX], quantity=5)  # sv4pt5: 5 copies in 1 row
            body = c.get("/api/v1/favorite-sets/suggestions").json()["suggestions"]
            self.assertEqual(
                [(s["set_id"], s["owned_count"]) for s in body],
                [("sv4pt5", 5), ("base1", 2)],
            )

    def test_suggestions_empty_without_a_collection(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.get("/api/v1/favorite-sets/suggestions").json(),
                {"suggestions": []},
            )


if __name__ == "__main__":
    unittest.main()
