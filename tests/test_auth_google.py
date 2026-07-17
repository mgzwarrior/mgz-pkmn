"""Tests for the Google OAuth sign-in slice (#410).

Same shape as `tests/test_auth_github.py` — the GitHub provider is the
template. Covers:

- `/auth/google/login` 404s when the auth scaffold is off (the routes
  exist but the dependency makes them inert).
- `/auth/google/login` returns 503 when the Google client env vars
  aren't set, even with auth on.
- Callback: state mismatch (OAuthError) → 400.
- Callback: missing or unverified email → 400.
- Callback: empty `sub` → 400 (we can't ground a unique `users.name`).
- Callback: fresh signup creates a `users` row, sets the session
  cookie, redirects to `/`.
- Callback: existing email reuses the row; `display_name` is **not**
  overwritten when the row already has one (ADR-0019 first-set-wins).
- Callback: existing row with no display_name *does* get populated.
- Concurrent-signup race recovers via `IntegrityError` rollback +
  re-read.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from authlib.integrations.base_client.errors import MismatchingStateError
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from api.auth.google import (
    GOOGLE_CLIENT_ID_ENV,
    GOOGLE_CLIENT_SECRET_ENV,
    GoogleProfile,
)
from api.auth.session import AUTH_ENABLED_ENV, SESSION_COOKIE_NAME, SESSION_SECRET_ENV
from api.db import session as session_mod
from api.db.models import User


class _IsolatedDbMixin(unittest.TestCase):
    """Same isolation pattern as test_auth_github.py — fresh sqlite per
    test, env restoration on teardown."""

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
                GOOGLE_CLIENT_ID_ENV,
                GOOGLE_CLIENT_SECRET_ENV,
                "MGZ_PKMN_ENV",
            )
        }
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        os.environ[SESSION_SECRET_ENV] = "unit-test-secret-do-not-care"
        os.environ.pop(AUTH_ENABLED_ENV, None)
        os.environ.pop(GOOGLE_CLIENT_ID_ENV, None)
        os.environ.pop(GOOGLE_CLIENT_SECRET_ENV, None)
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()


class LoginGateTests(_IsolatedDbMixin):
    def test_login_returns_404_when_auth_off(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/auth/google/login", follow_redirects=False)
            self.assertEqual(r.status_code, 404)
            # Body must match Starlette's default 404 exactly — same
            # casing, same shape — so probes can't distinguish
            # "auth disabled" from "wrong URL".
            self.assertEqual(r.json(), {"detail": "Not Found"})

    def test_login_returns_503_when_env_vars_missing(self) -> None:
        os.environ[AUTH_ENABLED_ENV] = "1"
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/auth/google/login", follow_redirects=False)
            self.assertEqual(r.status_code, 503)
            self.assertIn("Google OAuth not configured", r.json().get("detail", ""))


class CallbackErrorTests(_IsolatedDbMixin):
    """Callback handler error branches. Patches Authlib's
    `authorize_access_token` and `fetch_google_profile` to drive each
    failure mode without standing up a real OAuth server."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[GOOGLE_CLIENT_ID_ENV] = "test-client-id"
        os.environ[GOOGLE_CLIENT_SECRET_ENV] = "test-client-secret"

    def test_callback_state_mismatch_returns_400(self) -> None:
        from api.main import app

        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                new=AsyncMock(side_effect=MismatchingStateError()),
            ),
            TestClient(app) as client,
        ):
            r = client.get(
                "/api/v1/auth/google/callback?code=abc&state=tampered",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "oauth_failed")

    def test_callback_no_verified_email_returns_400(self) -> None:
        """`verified_email=None` covers both "no email claim" and
        "email present but `email_verified=false`" — the fetcher
        collapses them upstream so the callback only sees the union."""
        from api.main import app

        token = {"access_token": "test-token", "token_type": "bearer"}
        no_email_profile = GoogleProfile(sub="12345", name="Alice", verified_email=None)

        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                new=AsyncMock(return_value=token),
            ),
            patch(
                "api.auth.google.fetch_google_profile",
                new=AsyncMock(return_value=no_email_profile),
            ),
            TestClient(app) as client,
        ):
            r = client.get(
                "/api/v1/auth/google/callback?code=abc&state=anything",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "no_verified_email")

    def test_callback_empty_sub_returns_400(self) -> None:
        # A valid Google ID token always carries `sub`. If it doesn't,
        # we can't ground a unique `users.name` row on it — refuse with
        # a clean 400 instead of falling back to a colliding constant.
        from api.main import app

        token = {"access_token": "test-token", "token_type": "bearer"}
        no_sub_profile = GoogleProfile(sub="", name="Anon", verified_email="anon@example.com")

        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                new=AsyncMock(return_value=token),
            ),
            patch(
                "api.auth.google.fetch_google_profile",
                new=AsyncMock(return_value=no_sub_profile),
            ),
            TestClient(app) as client,
        ):
            r = client.get(
                "/api/v1/auth/google/callback?code=abc&state=anything",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "no_google_sub")


class CallbackHappyPathTests(_IsolatedDbMixin):
    """End-to-end behaviour with Authlib + Google patched out."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[GOOGLE_CLIENT_ID_ENV] = "test-client-id"
        os.environ[GOOGLE_CLIENT_SECRET_ENV] = "test-client-secret"

    def _drive_callback(self, client: TestClient, profile: GoogleProfile) -> tuple[int, str | None]:
        """Drive a callback request with the supplied profile patched in.

        The caller owns the `TestClient(app)` context so DB seeding +
        the request share the lifespan that runs auto-migrations."""
        token = {"access_token": "test-token", "token_type": "bearer"}
        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                new=AsyncMock(return_value=token),
            ),
            patch(
                "api.auth.google.fetch_google_profile",
                new=AsyncMock(return_value=profile),
            ),
        ):
            r = client.get(
                "/api/v1/auth/google/callback?code=abc&state=anything",
                follow_redirects=False,
            )
            return r.status_code, r.headers.get("location")

    def test_fresh_signup_creates_user_and_redirects_to_root(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            status, location = self._drive_callback(
                client,
                GoogleProfile(
                    sub="111122223333",
                    name="Alice Liddell",
                    verified_email="alice@example.com",
                ),
            )
            self.assertEqual(status, 302)
            self.assertEqual(location, "/")
            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == "alice@example.com"))
                assert user is not None
                self.assertEqual(user.email, "alice@example.com")
                self.assertEqual(user.display_name, "Alice Liddell")
                self.assertIsNotNone(user.email_verified_at)
                # Provider-tagged name: `google:` prefix + the Google
                # `sub` we passed in.
                self.assertEqual(user.name, "google:111122223333")

    def test_callback_issues_session_cookie_that_authenticates_subsequent_me(
        self,
    ) -> None:
        """Acceptance criterion — the session cookie set by the
        callback must actually authenticate the next request, not just
        write a `user_id` the test inspects through ORM. Drive the
        callback, then call `/me` against the same TestClient (which
        persists cookies) and confirm it returns 200 with the new
        user's payload."""
        from api.main import app

        with TestClient(app) as client:
            status, _ = self._drive_callback(
                client,
                GoogleProfile(
                    sub="444455556666",
                    name="Dani Reyes",
                    verified_email="dani@example.com",
                ),
            )
            self.assertEqual(status, 302)
            me = client.get("/api/v1/me")
            self.assertEqual(me.status_code, 200)
            payload = me.json()["user"]
            self.assertEqual(payload["email"], "dani@example.com")
            self.assertEqual(payload["display_name"], "Dani Reyes")
            self.assertIsInstance(payload["id"], int)

    def test_existing_user_is_reused_display_name_preserved(self) -> None:
        # Seed an existing row that already has a display_name set via
        # some prior sign-in (e.g. magic-link, GitHub).
        from datetime import UTC, datetime

        from api.main import app

        with TestClient(app) as client:
            with session_mod.get_session_factory()() as s:
                existing = User(
                    name="seed-user",
                    email="bob@example.com",
                    email_verified_at=datetime.now(UTC),
                    display_name="bob-the-builder",
                )
                s.add(existing)
                s.commit()
                existing_id = existing.id

            # Google sign-in for the same email returns a different
            # name. Per ADR-0019 first-set-wins, the existing
            # display_name must stick — the Google-returned name is
            # dropped.
            status, location = self._drive_callback(
                client,
                GoogleProfile(
                    sub="777788889999",
                    name="Robert Builder",
                    verified_email="bob@example.com",
                ),
            )
            self.assertEqual(status, 302)
            self.assertEqual(location, "/")
            with session_mod.get_session_factory()() as s:
                user = s.get(User, existing_id)
                assert user is not None
                self.assertEqual(user.display_name, "bob-the-builder")
                self.assertEqual(user.email, "bob@example.com")
                # Count users with this email — must still be exactly one.
                n = s.scalar(
                    select(func.count()).select_from(User).where(User.email == "bob@example.com")
                )
                self.assertEqual(n, 1)

    def test_existing_user_without_display_name_gets_one(self) -> None:
        from datetime import UTC, datetime

        from api.main import app

        with TestClient(app) as client:
            with session_mod.get_session_factory()() as s:
                existing = User(
                    name="seed-user-2",
                    email="carol@example.com",
                    email_verified_at=datetime.now(UTC),
                    display_name=None,
                )
                s.add(existing)
                s.commit()
                existing_id = existing.id

            status, _ = self._drive_callback(
                client,
                GoogleProfile(
                    sub="aaaabbbbcccc",
                    name="Carol Danvers",
                    verified_email="carol@example.com",
                ),
            )
            self.assertEqual(status, 302)
            with session_mod.get_session_factory()() as s:
                user = s.get(User, existing_id)
                assert user is not None
                self.assertEqual(user.display_name, "Carol Danvers")

    def test_concurrent_signup_race_is_recovered(self) -> None:
        """Read-then-insert race recovery: two callbacks for the same
        verified email both see no row, the second INSERT trips
        `users.email`'s unique constraint, and the handler must roll
        back + re-read the winning row instead of 500ing.

        Same emulation pattern as the GitHub provider's race test:
        seed the winner row, patch `_find_user_by_email` to miss on
        the first call (forcing the INSERT branch), and let the real
        flush trip the unique constraint."""
        from datetime import UTC, datetime

        from api.main import app

        with TestClient(app) as client:
            with session_mod.get_session_factory()() as s:
                winner = User(
                    name="seed-winner",
                    email="eve@example.com",
                    email_verified_at=datetime.now(UTC),
                    display_name="Eve First",
                )
                s.add(winner)
                s.commit()
                winner_id = winner.id

            # #491 slice 1 promoted the email lookup into a single helper
            # in `api.auth.identity`. The Google callback now delegates
            # there instead of importing from `.github`; patch the helper's
            # binding at its new home.
            from api.auth import identity as identity_mod

            real_lookup = identity_mod._find_user_by_email
            calls = {"n": 0}

            def lookup_side_effect(db, email):
                calls["n"] += 1
                if calls["n"] == 1:
                    return None  # force INSERT branch
                return real_lookup(db, email)

            with patch("api.auth.identity._find_user_by_email", side_effect=lookup_side_effect):
                status, location = self._drive_callback(
                    client,
                    GoogleProfile(
                        sub="raceyracerson",
                        name="Eve Late",
                        verified_email="eve@example.com",
                    ),
                )

            self.assertEqual(status, 302)
            self.assertEqual(location, "/")
            self.assertEqual(calls["n"], 2)  # confirms recovery path ran
            with session_mod.get_session_factory()() as s:
                # Only the seeded row should still exist; its
                # display_name must be untouched (race-recover branch
                # does no display_name update).
                user = s.get(User, winner_id)
                assert user is not None
                self.assertEqual(user.display_name, "Eve First")
                # And no duplicate was minted.
                n = s.scalar(
                    select(func.count()).select_from(User).where(User.email == "eve@example.com")
                )
                self.assertEqual(n, 1)


class NativeHandoffTests(_IsolatedDbMixin):
    """`?next=app` (#924) — native-app one-time-code handoff instead of
    the browser session cookie. See `tests/test_auth_native.py` for the
    code-mint/burn/exchange mechanics themselves."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[GOOGLE_CLIENT_ID_ENV] = "test-client-id"
        os.environ[GOOGLE_CLIENT_SECRET_ENV] = "test-client-secret"

    def test_login_next_app_survives_to_callback_as_native_redirect(self) -> None:
        """Drive login (which stashes the flag in the session cookie the
        TestClient persists) then the callback, and confirm the
        callback redirects to the custom scheme with a code instead of
        `/` with a `Set-Cookie`."""
        from api.main import app

        token = {"access_token": "test-token", "token_type": "bearer"}
        profile = GoogleProfile(sub="55556666", name="App User", verified_email="app@example.com")

        from fastapi.responses import RedirectResponse

        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_redirect",
                new=AsyncMock(
                    return_value=RedirectResponse(
                        url="https://accounts.google.com/x", status_code=302
                    )
                ),
            ),
            TestClient(app) as client,
        ):
            login_resp = client.get("/api/v1/auth/google/login?next=app", follow_redirects=False)
            self.assertEqual(login_resp.status_code, 302)

            with (
                patch(
                    "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                    new=AsyncMock(return_value=token),
                ),
                patch(
                    "api.auth.google.fetch_google_profile",
                    new=AsyncMock(return_value=profile),
                ),
            ):
                callback_resp = client.get(
                    "/api/v1/auth/google/callback?code=abc&state=anything",
                    follow_redirects=False,
                )
            self.assertEqual(callback_resp.status_code, 302)
            location = callback_resp.headers["location"]
            self.assertTrue(location.startswith("mgzpkmn://auth/callback?code="))
            # No session cookie for the native path — the code is the
            # handoff, not a cookie the app's ephemeral browser jar
            # can't read anyway.
            self.assertNotIn(SESSION_COOKIE_NAME, client.cookies)

            code = location.split("code=", 1)[1]
            exchange_resp = client.post("/api/v1/auth/native/exchange", json={"code": code})
            self.assertEqual(exchange_resp.status_code, 200)
            self.assertTrue(exchange_resp.json()["session_token"])

    def test_login_next_app_error_redirects_to_native_scheme(self) -> None:
        from api.main import app

        no_email_profile = GoogleProfile(sub="1", name="Anon", verified_email=None)
        token = {"access_token": "test-token", "token_type": "bearer"}

        from fastapi.responses import RedirectResponse

        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_redirect",
                new=AsyncMock(
                    return_value=RedirectResponse(
                        url="https://accounts.google.com/x", status_code=302
                    )
                ),
            ),
            TestClient(app) as client,
        ):
            client.get("/api/v1/auth/google/login?next=app", follow_redirects=False)

            with (
                patch(
                    "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                    new=AsyncMock(return_value=token),
                ),
                patch(
                    "api.auth.google.fetch_google_profile",
                    new=AsyncMock(return_value=no_email_profile),
                ),
            ):
                r = client.get(
                    "/api/v1/auth/google/callback?code=abc&state=anything",
                    follow_redirects=False,
                )
            self.assertEqual(r.status_code, 302)
            self.assertEqual(
                r.headers["location"],
                "mgzpkmn://auth/callback?error=no_verified_email",
            )


if __name__ == "__main__":
    unittest.main()
