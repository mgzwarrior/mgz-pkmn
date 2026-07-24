"""Tests for `/api/v1/device-tokens` — push device registration (#974).

Covers:

- Alembic migration up/down round-trip for the `device_tokens` table.
- CRUD: list, register, multi-device registration, upsert-by-token
  reassignment, deregister (including deregister-of-unregistered no-op).

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


class DeviceTokensMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_table_then_downgrade_drops_it(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        insp = inspect(engine)
        self.assertIn("device_tokens", insp.get_table_names())
        cols = {c["name"] for c in insp.get_columns("device_tokens")}
        self.assertEqual(
            cols,
            {"id", "user_id", "device_token", "platform", "created_at", "last_seen_at"},
        )
        self.assertIn(
            "ix_device_tokens_user_id",
            {i["name"] for i in insp.get_indexes("device_tokens")},
        )

        from alembic.command import downgrade
        from alembic.config import Config

        cfg = Config(str(Path(__file__).resolve().parents[1] / "api" / "alembic.ini"))
        downgrade(cfg, "4d3b4ffb3653")
        self.assertNotIn("device_tokens", inspect(session_mod.get_engine()).get_table_names())


class DeviceTokensCrudTests(_IsolatedDbMixin):
    def test_list_is_empty_initially(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/device-tokens")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"devices": []})

    def test_register_then_list(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.post(
                    "/api/v1/device-tokens",
                    json={"device_token": "tok-1", "platform": "ios"},
                ).status_code,
                204,
            )
            body = c.get("/api/v1/device-tokens").json()
            self.assertEqual(len(body["devices"]), 1)
            device = body["devices"][0]
            self.assertEqual(device["device_token"], "tok-1")
            self.assertEqual(device["platform"], "ios")
            self.assertIn("created_at", device)
            self.assertIn("last_seen_at", device)

    def test_multi_device_registration(self) -> None:
        with self._client() as c:
            c.post("/api/v1/device-tokens", json={"device_token": "tok-1", "platform": "ios"})
            c.post("/api/v1/device-tokens", json={"device_token": "tok-2", "platform": "ios"})
            tokens = {d["device_token"] for d in c.get("/api/v1/device-tokens").json()["devices"]}
            self.assertEqual(tokens, {"tok-1", "tok-2"})

    def test_reregister_same_token_upserts_not_duplicates(self) -> None:
        with self._client() as c:
            c.post("/api/v1/device-tokens", json={"device_token": "tok-1", "platform": "ios"})
            c.post("/api/v1/device-tokens", json={"device_token": "tok-1", "platform": "ios"})
            body = c.get("/api/v1/device-tokens").json()["devices"]
            self.assertEqual(len(body), 1)

    def test_register_rejects_blank_token(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/device-tokens", json={"device_token": "", "platform": "ios"})
            self.assertEqual(resp.status_code, 422)

    def test_register_rejects_blank_platform(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/device-tokens", json={"device_token": "tok-1", "platform": ""})
            self.assertEqual(resp.status_code, 422)

    def test_deregister_removes_only_that_device(self) -> None:
        with self._client() as c:
            c.post("/api/v1/device-tokens", json={"device_token": "tok-1", "platform": "ios"})
            c.post("/api/v1/device-tokens", json={"device_token": "tok-2", "platform": "ios"})
            self.assertEqual(c.delete("/api/v1/device-tokens/tok-1").status_code, 204)
            remaining = [
                d["device_token"] for d in c.get("/api/v1/device-tokens").json()["devices"]
            ]
            self.assertEqual(remaining, ["tok-2"])

    def test_deregister_unregistered_is_a_noop(self) -> None:
        with self._client() as c:
            self.assertEqual(c.delete("/api/v1/device-tokens/never-registered").status_code, 204)


if __name__ == "__main__":
    unittest.main()
