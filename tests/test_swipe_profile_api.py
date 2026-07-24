"""Tests for `/api/v1/swipe/profile` — server-side taste-profile persistence (#967).

Covers:

- Alembic migration up/down round-trip for `swipe_profile_weights`.
- `GET`: empty profile initially, grouped weights after a `PUT`.
- `PUT`: full-replace semantics (a second `PUT` overwrites, not merges),
  and zero-weight entries are dropped rather than persisted.
- `DELETE`: clears the persisted profile.

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
from sqlalchemy import func, inspect, select

from api.db import session as session_mod
from api.db.migrate import upgrade_head
from api.db.models import SwipeProfileWeight


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


# ---------------------------------------------------------------------------
# Migration round-trip
# ---------------------------------------------------------------------------


class SwipeProfileMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_swipe_profile_weights(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("swipe_profile_weights", set(inspect(engine).get_table_names()))

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("swipe_profile_weights", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Step back to the revision underneath this one; swipe_profile_weights
        # comes down, the rest of the schema survives.
        command.downgrade(cfg, "4d3b4ffb3653")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("swipe_profile_weights", names)
        self.assertIn("price_snapshots", names)

        upgrade_head(engine)
        self.assertIn("swipe_profile_weights", set(inspect(engine).get_table_names()))


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


class SwipeProfileEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_get_is_empty_initially(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/swipe/profile")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"rarity": {}, "set": {}, "tag": {}})

    def test_put_then_get_round_trips(self) -> None:
        with self._client() as c:
            body = {
                "rarity": {"Rare Holo": 3},
                "set": {"base1": -2},
                "tag": {"super:Pokémon": 1, "sub:VMAX": 2},
            }
            resp = c.put("/api/v1/swipe/profile", json=body)
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), body)

            self.assertEqual(c.get("/api/v1/swipe/profile").json(), body)

    def test_put_replaces_rather_than_merges(self) -> None:
        with self._client() as c:
            c.put(
                "/api/v1/swipe/profile",
                json={"rarity": {"Rare Holo": 3}, "set": {}, "tag": {}},
            )
            resp = c.put(
                "/api/v1/swipe/profile",
                json={"rarity": {"Common": 1}, "set": {}, "tag": {}},
            )
            self.assertEqual(resp.json(), {"rarity": {"Common": 1}, "set": {}, "tag": {}})

    def test_put_drops_zero_weight_entries(self) -> None:
        with self._client() as c:
            resp = c.put(
                "/api/v1/swipe/profile",
                json={"rarity": {"Rare Holo": 3, "Common": 0}, "set": {}, "tag": {}},
            )
            self.assertEqual(resp.json()["rarity"], {"Rare Holo": 3})

            with session_mod.get_session_factory()() as s:
                count = s.scalar(select(func.count(SwipeProfileWeight.id)))
                self.assertEqual(count, 1)

    def test_delete_clears_profile(self) -> None:
        with self._client() as c:
            c.put(
                "/api/v1/swipe/profile",
                json={"rarity": {"Rare Holo": 3}, "set": {}, "tag": {}},
            )
            resp = c.delete("/api/v1/swipe/profile")
            self.assertEqual(resp.status_code, 204)

            self.assertEqual(
                c.get("/api/v1/swipe/profile").json(),
                {"rarity": {}, "set": {}, "tag": {}},
            )


if __name__ == "__main__":
    unittest.main()
