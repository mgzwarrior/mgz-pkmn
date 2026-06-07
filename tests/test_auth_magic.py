"""Tests for the magic-link sign-in slice (#409).

Covers:

- `/auth/magic/request` 404s when auth scaffold is off (matches
  Starlette's default body — same posture as the GitHub provider).
- `/auth/magic/request` 503s when SMTP env vars aren't set.
- `/auth/magic/request` returns 202 with no body once SMTP is wired,
  for both a known and an unknown email — no enumeration leak.
- `/auth/magic/request` queues an SMTP send via the patched mailer
  rather than blocking the response on it.
- `/auth/magic/callback` happy path: fresh email creates the row,
  existing email reuses it, expired / tampered token → 400.
- Callback issues a session cookie that authenticates `/me` on the
  next request.
- Account-merge contract: an existing row's `display_name` is left
  untouched (first-set-wins).
- Concurrent-signup race recovery via `IntegrityError`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from api.auth import magic as magic_mod
from api.auth.magic import (
    SENDER_ENV,
    SMTP_HOST_ENV,
    SMTP_PASSWORD_ENV,
    SMTP_PORT_ENV,
    SMTP_USERNAME_ENV,
    sign_token,
)
from api.auth.session import AUTH_ENABLED_ENV, SESSION_SECRET_ENV
from api.db import session as session_mod
from api.db.models import User


class _IsolatedDbMixin(unittest.TestCase):
    """Fresh sqlite + env reset per test, matching the patterns from
    `test_auth.py` and `test_auth_github.py`."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "test.db"
        self._saved_env = {
            k: os.environ.get(k)
            for k in (
                "MGZ_PKMN_DATABASE_URL",
                "MGZ_PKMN_AUTOMIGRATE",
                AUTH_ENABLED_ENV,
                SESSION_SECRET_ENV,
                SMTP_HOST_ENV,
                SMTP_PORT_ENV,
                SMTP_USERNAME_ENV,
                SMTP_PASSWORD_ENV,
                SENDER_ENV,
                "MGZ_PKMN_ENV",
            )
        }
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        os.environ[SESSION_SECRET_ENV] = "unit-test-secret-do-not-care"
        for k in (
            AUTH_ENABLED_ENV,
            SMTP_HOST_ENV,
            SMTP_PORT_ENV,
            SMTP_USERNAME_ENV,
            SMTP_PASSWORD_ENV,
            SENDER_ENV,
        ):
            os.environ.pop(k, None)
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()


def _set_smtp_env() -> None:
    """Populate the SMTP env vars with test-only values."""
    os.environ[SMTP_HOST_ENV] = "smtp.test.local"
    os.environ[SMTP_PORT_ENV] = "587"
    os.environ[SMTP_USERNAME_ENV] = "test-user"
    os.environ[SMTP_PASSWORD_ENV] = "test-pass"
    os.environ[SENDER_ENV] = "noreply@example.com"


class RequestGateTests(_IsolatedDbMixin):
    def test_request_returns_404_when_auth_off_with_starlette_default_body(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            r = client.post("/api/v1/auth/magic/request", json={"email": "a@example.com"})
            self.assertEqual(r.status_code, 404)
            self.assertEqual(r.json(), {"detail": "Not Found"})

    def test_request_returns_503_when_smtp_env_missing(self) -> None:
        os.environ[AUTH_ENABLED_ENV] = "1"
        from api.main import app

        with TestClient(app) as client:
            r = client.post("/api/v1/auth/magic/request", json={"email": "a@example.com"})
            self.assertEqual(r.status_code, 503)
            self.assertIn("Magic-link SMTP not configured", r.json().get("detail", ""))


class RequestNoEnumerationTests(_IsolatedDbMixin):
    """The /request route's 202 contract must hold regardless of
    whether the email matches an existing user or even looks
    well-formed."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        _set_smtp_env()

    def _post(self, client: TestClient, email: str) -> tuple[int, bytes]:
        r = client.post("/api/v1/auth/magic/request", json={"email": email})
        return r.status_code, r.content

    def test_request_returns_202_with_empty_body_for_unknown_email(self) -> None:
        from api.main import app

        with patch("api.auth.magic.SmtpMailer.send", new=MagicMock()), TestClient(app) as client:
            status, body = self._post(client, "stranger@example.com")
            self.assertEqual(status, 202)
            self.assertEqual(body, b"")

    def test_request_returns_202_for_existing_email_too(self) -> None:
        from api.main import app

        with patch("api.auth.magic.SmtpMailer.send", new=MagicMock()), TestClient(app) as client:
            with session_mod.get_session_factory()() as s:
                s.add(
                    User(
                        name="seed",
                        email="known@example.com",
                        email_verified_at=datetime.now(UTC),
                        display_name="Known",
                    )
                )
                s.commit()
            status, body = self._post(client, "known@example.com")
            self.assertEqual(status, 202)
            self.assertEqual(body, b"")

    def test_request_returns_202_for_malformed_email(self) -> None:
        # Garbage input still gets a 202 — validation that returned
        # 422 would leak signal about email shape.
        from api.main import app

        with patch("api.auth.magic.SmtpMailer.send", new=MagicMock()), TestClient(app) as client:
            status, _ = self._post(client, "not-an-email")
            self.assertEqual(status, 202)

    def test_request_queues_send_via_mailer(self) -> None:
        from api.main import app

        sends: list[EmailMessage] = []

        def record_send(self_mailer, message: EmailMessage) -> None:
            sends.append(message)

        with (
            patch("api.auth.magic.SmtpMailer.send", new=record_send),
            TestClient(app) as client,
        ):
            r = client.post("/api/v1/auth/magic/request", json={"email": "click@example.com"})
            self.assertEqual(r.status_code, 202)

        self.assertEqual(len(sends), 1)
        msg = sends[0]
        self.assertEqual(msg["To"], "click@example.com")
        self.assertEqual(msg["From"], "noreply@example.com")
        # Body carries the absolute callback URL.
        body = msg.get_content()
        self.assertIn("/api/v1/auth/magic/callback?token=", body)


class CallbackTokenTests(_IsolatedDbMixin):
    """Token verification branches."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        _set_smtp_env()

    def test_callback_tampered_token_returns_400(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            r = client.get(
                "/api/v1/auth/magic/callback?token=garbage",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "invalid_or_expired_token")

    def test_callback_expired_token_returns_400(self) -> None:
        # Sign a token, then move the clock past the TTL by patching
        # itsdangerous's view of "now". Cheaper than sleeping.
        from api.main import app

        token = sign_token("late@example.com")
        # Token TTL is 15 minutes; nudge well past it.
        with (
            patch(
                "itsdangerous.timed.time.time",
                return_value=time.time() + magic_mod.TOKEN_MAX_AGE_SECONDS + 60,
            ),
            TestClient(app) as client,
        ):
            r = client.get(
                f"/api/v1/auth/magic/callback?token={token}",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "invalid_or_expired_token")


class CallbackHappyPathTests(_IsolatedDbMixin):
    """Upsert + session-cookie behaviour."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        _set_smtp_env()

    def test_callback_fresh_signup_creates_row_and_redirects(self) -> None:
        from api.main import app

        token = sign_token("rose@example.com")
        with TestClient(app) as client:
            r = client.get(
                f"/api/v1/auth/magic/callback?token={token}",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 302)
            self.assertEqual(r.headers["location"], "/")
            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == "rose@example.com"))
                assert user is not None
                self.assertEqual(user.email, "rose@example.com")
                self.assertTrue(user.name.startswith("magic:"))
                self.assertIsNone(user.display_name)
                self.assertIsNotNone(user.email_verified_at)

    def test_callback_existing_user_reused_display_name_preserved(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            with session_mod.get_session_factory()() as s:
                s.add(
                    User(
                        name="gh:thorne",
                        email="thorne@example.com",
                        email_verified_at=datetime.now(UTC),
                        display_name="Thorne (from GitHub)",
                    )
                )
                s.commit()
            token = sign_token("thorne@example.com")
            r = client.get(
                f"/api/v1/auth/magic/callback?token={token}",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 302)
            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == "thorne@example.com"))
                assert user is not None
                # display_name from the prior GitHub sign-in must
                # survive — magic-link signup doesn't carry one.
                self.assertEqual(user.display_name, "Thorne (from GitHub)")
                n = s.scalar(
                    select(func.count()).select_from(User).where(User.email == "thorne@example.com")
                )
                self.assertEqual(n, 1)

    def test_callback_session_cookie_authenticates_subsequent_me(self) -> None:
        from api.main import app

        token = sign_token("loop@example.com")
        with TestClient(app) as client:
            r = client.get(
                f"/api/v1/auth/magic/callback?token={token}",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 302)
            me = client.get("/api/v1/me")
            self.assertEqual(me.status_code, 200)
            payload = me.json()["user"]
            self.assertEqual(payload["email"], "loop@example.com")
            self.assertIsInstance(payload["id"], int)

    def test_callback_concurrent_signup_race_is_recovered(self) -> None:
        """Same read-then-insert race as the GitHub provider —
        emulated by patching `_find_user_by_email` to miss on the
        first call and hit on the second, after the seeded row has
        already taken the email."""
        from api.main import app

        with TestClient(app) as client:
            with session_mod.get_session_factory()() as s:
                s.add(
                    User(
                        name="seed-winner",
                        email="race@example.com",
                        email_verified_at=datetime.now(UTC),
                        display_name="Race First",
                    )
                )
                s.commit()

            # #491 slice 1: the email lookup is now in `api.auth.identity`
            # (the magic callback delegates there instead of importing
            # `_find_user_by_email` from `.github`).
            from api.auth import identity as identity_mod

            real_lookup = identity_mod._find_user_by_email
            calls = {"n": 0}

            def lookup_side_effect(db, email):
                calls["n"] += 1
                if calls["n"] == 1:
                    return None
                return real_lookup(db, email)

            token = sign_token("race@example.com")
            with patch("api.auth.identity._find_user_by_email", side_effect=lookup_side_effect):
                r = client.get(
                    f"/api/v1/auth/magic/callback?token={token}",
                    follow_redirects=False,
                )

            self.assertEqual(r.status_code, 302)
            self.assertEqual(calls["n"], 2)  # recovery path ran
            with session_mod.get_session_factory()() as s:
                n = s.scalar(
                    select(func.count()).select_from(User).where(User.email == "race@example.com")
                )
                self.assertEqual(n, 1)


if __name__ == "__main__":
    unittest.main()
