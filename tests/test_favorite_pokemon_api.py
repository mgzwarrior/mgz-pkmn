"""Tests for `/api/v1/favorite-pokemon` — per-user pinned favorite Pokémon (#742).

Covers:

- Alembic migration up/down round-trip for the `favorite_species` table and the
  `users.onboarding_completed_at` column.
- CRUD: list, idempotent pin, unpin (including unpin-of-unpinned no-op), and the
  dex-number range validation.

Mirrors the per-test tempfile DB isolation from `tests/test_favorite_sets_api.py`.
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

CHARIZARD = 6
BLASTOISE = 9
MEW = 151


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


class FavoriteSpeciesMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_table_then_downgrade_drops_it(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        insp = inspect(engine)
        self.assertIn("favorite_species", insp.get_table_names())
        cols = {c["name"] for c in insp.get_columns("favorite_species")}
        self.assertEqual(cols, {"id", "user_id", "dex_number", "pinned_at"})
        self.assertIn(
            "ix_favorite_species_user_id",
            {i["name"] for i in insp.get_indexes("favorite_species")},
        )
        user_cols = {c["name"] for c in insp.get_columns("users")}
        self.assertIn("onboarding_completed_at", user_cols)

        from alembic.command import downgrade
        from alembic.config import Config

        cfg = Config(str(Path(__file__).resolve().parents[1] / "api" / "alembic.ini"))
        # Downgrade to favorite_species' parent so this stays valid as later
        # migrations stack on top — a relative "-1" only drops favorite_species
        # while it's the head, which it no longer is (#759 added one above it).
        downgrade(cfg, "c8b4e1f6a2d7")
        insp = inspect(session_mod.get_engine())
        self.assertNotIn("favorite_species", insp.get_table_names())
        self.assertNotIn(
            "onboarding_completed_at",
            {c["name"] for c in insp.get_columns("users")},
        )


class FavoritePokemonCrudTests(_IsolatedDbMixin):
    def test_list_is_empty_initially(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/favorite-pokemon")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"pokemon": []})

    def test_pin_then_list(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.post("/api/v1/favorite-pokemon", json={"dex_number": CHARIZARD}).status_code,
                204,
            )
            body = c.get("/api/v1/favorite-pokemon").json()
            self.assertEqual([p["dex_number"] for p in body["pokemon"]], [CHARIZARD])
            self.assertIn("pinned_at", body["pokemon"][0])

    def test_pin_is_idempotent(self) -> None:
        with self._client() as c:
            c.post("/api/v1/favorite-pokemon", json={"dex_number": CHARIZARD})
            c.post("/api/v1/favorite-pokemon", json={"dex_number": CHARIZARD})
            body = c.get("/api/v1/favorite-pokemon").json()
            self.assertEqual(len(body["pokemon"]), 1)

    def test_pin_rejects_out_of_range_dex_number(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.post("/api/v1/favorite-pokemon", json={"dex_number": 0}).status_code, 422
            )
            self.assertEqual(
                c.post("/api/v1/favorite-pokemon", json={"dex_number": 99999}).status_code, 422
            )

    def test_unpin_removes_only_that_species(self) -> None:
        with self._client() as c:
            c.post("/api/v1/favorite-pokemon", json={"dex_number": CHARIZARD})
            c.post("/api/v1/favorite-pokemon", json={"dex_number": MEW})
            self.assertEqual(c.delete(f"/api/v1/favorite-pokemon/{CHARIZARD}").status_code, 204)
            remaining = [
                p["dex_number"] for p in c.get("/api/v1/favorite-pokemon").json()["pokemon"]
            ]
            self.assertEqual(remaining, [MEW])

    def test_unpin_unpinned_is_a_noop(self) -> None:
        with self._client() as c:
            self.assertEqual(c.delete(f"/api/v1/favorite-pokemon/{BLASTOISE}").status_code, 204)


if __name__ == "__main__":
    unittest.main()
