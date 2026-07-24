"""Tests for `api.push.send_notification` — the delivery orchestration
seam (#976, epic #946).

Covers:

- Sends to a registered device when no preference row exists (opt-in
  by default, matching ``api.routes.notification_preferences``'
  seeding contract) and when the row is explicitly enabled.
- Skips entirely — sender never called — when the preference row is
  disabled.
- Fans out to every device a user has registered.
- A device the sender reports as an invalid token is removed from
  ``DeviceToken``; a device that fails for any other reason is left
  alone (not counted as delivered, not removed).

Mirrors the per-test tempfile DB isolation from
``tests/test_device_tokens_api.py``.
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from api.db import session as session_mod
from api.db.migrate import upgrade_head
from api.db.models import DeviceToken, NotificationPreference
from api.push.base import PushResult
from api.push.service import send_notification


class _FakeSender:
    """Records every call and returns a canned result per device token."""

    def __init__(self, results: dict[str, PushResult] | None = None) -> None:
        self._results = results or {}
        self.calls: list[tuple[str, dict]] = []

    async def send(self, device_token: str, payload: dict) -> PushResult:
        self.calls.append((device_token, payload))
        return self._results.get(device_token, PushResult(delivered=True, invalid_token=False))


def _run(coro):
    return asyncio.run(coro)


class _IsolatedDbMixin(unittest.TestCase):
    """Point MGZ_PKMN_DATABASE_URL at a fresh sqlite file per test."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "test.db"
        self._old_url = os.environ.get("MGZ_PKMN_DATABASE_URL")
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        session_mod.reset_engine()
        upgrade_head(session_mod.get_engine())

    def tearDown(self) -> None:
        session_mod.reset_engine()
        if self._old_url is None:
            os.environ.pop("MGZ_PKMN_DATABASE_URL", None)
        else:
            os.environ["MGZ_PKMN_DATABASE_URL"] = self._old_url
        self._tmp.cleanup()

    def _session(self):
        return session_mod.get_session_factory()()


class SendNotificationTests(_IsolatedDbMixin):
    def test_sends_when_no_preference_row_exists(self) -> None:
        with self._session() as db:
            db.add(DeviceToken(user_id=1, device_token="tok-1", platform="ios"))
            db.commit()
            sender = _FakeSender()
            delivered = _run(send_notification(db, 1, "price_drop", {"a": 1}, sender=sender))
        self.assertEqual(delivered, 1)
        self.assertEqual(sender.calls, [("tok-1", {"a": 1})])

    def test_sends_when_preference_explicitly_enabled(self) -> None:
        with self._session() as db:
            db.add(DeviceToken(user_id=1, device_token="tok-1", platform="ios"))
            db.add(NotificationPreference(user_id=1, notification_type="price_drop", enabled=True))
            db.commit()
            sender = _FakeSender()
            delivered = _run(send_notification(db, 1, "price_drop", {}, sender=sender))
        self.assertEqual(delivered, 1)

    def test_skips_entirely_when_preference_disabled(self) -> None:
        with self._session() as db:
            db.add(DeviceToken(user_id=1, device_token="tok-1", platform="ios"))
            db.add(NotificationPreference(user_id=1, notification_type="price_drop", enabled=False))
            db.commit()
            sender = _FakeSender()
            delivered = _run(send_notification(db, 1, "price_drop", {}, sender=sender))
        self.assertEqual(delivered, 0)
        self.assertEqual(sender.calls, [])

    def test_no_registered_devices_is_a_noop(self) -> None:
        with self._session() as db:
            sender = _FakeSender()
            delivered = _run(send_notification(db, 1, "price_drop", {}, sender=sender))
        self.assertEqual(delivered, 0)
        self.assertEqual(sender.calls, [])

    def test_fans_out_to_every_registered_device(self) -> None:
        with self._session() as db:
            db.add(DeviceToken(user_id=1, device_token="tok-1", platform="ios"))
            db.add(DeviceToken(user_id=1, device_token="tok-2", platform="ios"))
            db.commit()
            sender = _FakeSender()
            delivered = _run(send_notification(db, 1, "price_drop", {}, sender=sender))
        self.assertEqual(delivered, 2)
        self.assertEqual({c[0] for c in sender.calls}, {"tok-1", "tok-2"})

    def test_invalid_token_removes_the_device_row(self) -> None:
        with self._session() as db:
            db.add(DeviceToken(user_id=1, device_token="tok-1", platform="ios"))
            db.commit()
            sender = _FakeSender(
                {"tok-1": PushResult(delivered=False, invalid_token=True, reason="Unregistered")}
            )
            delivered = _run(send_notification(db, 1, "price_drop", {}, sender=sender))
            remaining = db.scalars(select(DeviceToken).where(DeviceToken.user_id == 1)).all()
        self.assertEqual(delivered, 0)
        self.assertEqual(remaining, [])

    def test_other_failure_leaves_the_device_row_in_place(self) -> None:
        with self._session() as db:
            db.add(DeviceToken(user_id=1, device_token="tok-1", platform="ios"))
            db.commit()
            sender = _FakeSender(
                {
                    "tok-1": PushResult(
                        delivered=False, invalid_token=False, reason="InternalServerError"
                    )
                }
            )
            delivered = _run(send_notification(db, 1, "price_drop", {}, sender=sender))
            remaining = db.scalars(select(DeviceToken).where(DeviceToken.user_id == 1)).all()
        self.assertEqual(delivered, 0)
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0].device_token, "tok-1")

    def test_a_disabled_type_does_not_affect_other_types(self) -> None:
        with self._session() as db:
            db.add(DeviceToken(user_id=1, device_token="tok-1", platform="ios"))
            db.add(NotificationPreference(user_id=1, notification_type="price_drop", enabled=False))
            db.commit()
            sender = _FakeSender()
            delivered = _run(send_notification(db, 1, "show_reminder", {}, sender=sender))
        self.assertEqual(delivered, 1)


if __name__ == "__main__":
    unittest.main()
