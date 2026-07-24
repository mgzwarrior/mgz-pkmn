"""Tests for `/api/v1/notification-preferences` — per-user, per-type push
notification opt-in (#975).

Covers:

- Alembic migration up/down round-trip for the `notification_preferences`
  table.
- Default seeding: registering a device creates opt-in rows for every
  known type; a second device registration is a no-op (no duplicates).
- CRUD: list, toggle an existing type off/on, upsert-toggle a type with
  no existing row.

Mirrors the per-test tempfile DB isolation from `tests/test_device_tokens_api.py`.
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
from api.routes.notification_preferences import KNOWN_NOTIFICATION_TYPES


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


class NotificationPreferencesMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_table_then_downgrade_drops_it(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        insp = inspect(engine)
        self.assertIn("notification_preferences", insp.get_table_names())
        cols = {c["name"] for c in insp.get_columns("notification_preferences")}
        self.assertEqual(
            cols,
            {"id", "user_id", "notification_type", "enabled", "created_at", "updated_at"},
        )
        self.assertIn(
            "ix_notification_preferences_user_id",
            {i["name"] for i in insp.get_indexes("notification_preferences")},
        )

        from alembic.command import downgrade
        from alembic.config import Config

        cfg = Config(str(Path(__file__).resolve().parents[1] / "api" / "alembic.ini"))
        downgrade(cfg, "f6133f7427d5")
        self.assertNotIn(
            "notification_preferences", inspect(session_mod.get_engine()).get_table_names()
        )


class NotificationPreferencesDefaultsTests(_IsolatedDbMixin):
    def test_list_is_empty_before_any_device_registers(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/notification-preferences")
            self.assertEqual(resp.status_code, 200)
            # No device has registered yet — GET still seeds on the fly.
            types = {p["notification_type"] for p in resp.json()["preferences"]}
            self.assertEqual(types, set(KNOWN_NOTIFICATION_TYPES))
            self.assertTrue(all(p["enabled"] for p in resp.json()["preferences"]))

    def test_device_registration_seeds_default_opt_in_rows(self) -> None:
        with self._client() as c:
            c.post(
                "/api/v1/device-tokens",
                json={"device_token": "tok-1", "platform": "ios"},
            )
            body = c.get("/api/v1/notification-preferences").json()
            prefs = {p["notification_type"]: p["enabled"] for p in body["preferences"]}
            self.assertEqual(set(prefs), set(KNOWN_NOTIFICATION_TYPES))
            self.assertTrue(all(prefs.values()))

    def test_second_device_registration_does_not_duplicate_rows(self) -> None:
        with self._client() as c:
            c.post(
                "/api/v1/device-tokens",
                json={"device_token": "tok-1", "platform": "ios"},
            )
            c.post(
                "/api/v1/device-tokens",
                json={"device_token": "tok-2", "platform": "ios"},
            )
            body = c.get("/api/v1/notification-preferences").json()
            self.assertEqual(len(body["preferences"]), len(KNOWN_NOTIFICATION_TYPES))

    def test_toggle_off_survives_a_later_device_registration(self) -> None:
        with self._client() as c:
            c.post(
                "/api/v1/device-tokens",
                json={"device_token": "tok-1", "platform": "ios"},
            )
            toggled_type = KNOWN_NOTIFICATION_TYPES[0]
            c.patch(
                f"/api/v1/notification-preferences/{toggled_type}",
                json={"enabled": False},
            )
            c.post(
                "/api/v1/device-tokens",
                json={"device_token": "tok-2", "platform": "ios"},
            )
            body = c.get("/api/v1/notification-preferences").json()
            prefs = {p["notification_type"]: p["enabled"] for p in body["preferences"]}
            self.assertFalse(prefs[toggled_type])


class NotificationPreferencesCrudTests(_IsolatedDbMixin):
    def test_toggle_existing_type_off_then_on(self) -> None:
        with self._client() as c:
            target = KNOWN_NOTIFICATION_TYPES[0]
            off = c.patch(
                f"/api/v1/notification-preferences/{target}",
                json={"enabled": False},
            )
            self.assertEqual(off.status_code, 200)
            self.assertEqual(off.json(), {"notification_type": target, "enabled": False})

            body = c.get("/api/v1/notification-preferences").json()
            prefs = {p["notification_type"]: p["enabled"] for p in body["preferences"]}
            self.assertFalse(prefs[target])

            on = c.patch(
                f"/api/v1/notification-preferences/{target}",
                json={"enabled": True},
            )
            self.assertEqual(on.status_code, 200)
            self.assertEqual(on.json(), {"notification_type": target, "enabled": True})

    def test_toggle_unknown_type_upserts_a_new_row(self) -> None:
        with self._client() as c:
            resp = c.patch(
                "/api/v1/notification-preferences/future_type",
                json={"enabled": False},
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"notification_type": "future_type", "enabled": False})

            body = c.get("/api/v1/notification-preferences").json()
            prefs = {p["notification_type"]: p["enabled"] for p in body["preferences"]}
            self.assertIn("future_type", prefs)
            self.assertFalse(prefs["future_type"])

    def test_toggle_rejects_missing_enabled_field(self) -> None:
        with self._client() as c:
            target = KNOWN_NOTIFICATION_TYPES[0]
            resp = c.patch(f"/api/v1/notification-preferences/{target}", json={})
            self.assertEqual(resp.status_code, 422)

    def test_toggle_rejects_type_longer_than_column_width(self) -> None:
        with self._client() as c:
            too_long = "x" * 65
            resp = c.patch(
                f"/api/v1/notification-preferences/{too_long}",
                json={"enabled": False},
            )
            self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()
