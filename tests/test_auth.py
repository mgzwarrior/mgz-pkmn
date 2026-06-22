"""Tests for the auth foundation slice (#407).

Covers:

- ``auth_enabled`` env parse rules.
- ``resolve_session_secret`` fallback + production refusal.
- ``GET /api/v1/me`` returns 204 anon, 200 + user when a session cookie
  is present, 204 again when the cookie's ``user_id`` doesn't exist.
- ``POST /api/v1/auth/logout`` clears the session.
- ``MGZ_PKMN_AUTH_ENABLED=0`` forces anon even with a valid cookie.
- The ``users`` Alembic migration round-trips and the new columns
  accept the expected shapes.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import inspect

from api.auth.session import (
    AUTH_ENABLED_ENV,
    SESSION_SECRET_ENV,
    auth_enabled,
    resolve_session_secret,
)
from api.db import session as session_mod
from api.db.models import User


class _IsolatedDbMixin(unittest.TestCase):
    """Point MGZ_PKMN_DATABASE_URL at a fresh sqlite file per test, and
    reset the auth env so a leak from one test never bleeds into the next."""

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
                "MGZ_PKMN_ENV",
            )
        }
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        os.environ[SESSION_SECRET_ENV] = "unit-test-secret-do-not-care"
        # Each test that needs auth-on flips AUTH_ENABLED_ENV explicitly.
        os.environ.pop(AUTH_ENABLED_ENV, None)
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()


class AuthEnabledFlagTests(unittest.TestCase):
    def test_defaults_off_when_env_unset(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(AUTH_ENABLED_ENV, None)
            self.assertFalse(auth_enabled())

    def test_accepts_truthy_strings(self) -> None:
        for value in ("1", "true", "True"):
            with patch.dict(os.environ, {AUTH_ENABLED_ENV: value}):
                self.assertTrue(auth_enabled(), f"failed for {value!r}")

    def test_rejects_other_strings(self) -> None:
        for value in ("0", "false", "yes", "on", ""):
            with patch.dict(os.environ, {AUTH_ENABLED_ENV: value}):
                self.assertFalse(auth_enabled(), f"failed for {value!r}")


class SessionSecretResolutionTests(unittest.TestCase):
    def test_env_value_wins(self) -> None:
        with patch.dict(os.environ, {SESSION_SECRET_ENV: "ok-real-secret", "MGZ_PKMN_ENV": ""}):
            self.assertEqual(resolve_session_secret(), "ok-real-secret")

    def test_missing_in_dev_falls_back_with_warning_when_auth_on(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(SESSION_SECRET_ENV, None)
            os.environ["MGZ_PKMN_ENV"] = "dev"
            os.environ[AUTH_ENABLED_ENV] = "1"
            with self.assertLogs("api.auth.session", level="WARNING") as cm:
                value = resolve_session_secret()
            self.assertTrue(value)  # non-empty fallback
            self.assertTrue(any("unset" in line for line in cm.output))

    def test_missing_with_auth_off_is_silent_dev_fallback(self) -> None:
        # The whole point of the off-default posture: a self-hoster (or
        # production deploy) that leaves auth disabled doesn't need to
        # configure a secret and shouldn't see a warning.
        import logging

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(SESSION_SECRET_ENV, None)
            os.environ.pop(AUTH_ENABLED_ENV, None)
            os.environ["MGZ_PKMN_ENV"] = "production"
            with self.assertNoLogs("api.auth.session", level=logging.WARNING):
                value = resolve_session_secret()
            self.assertTrue(value)

    def test_missing_in_production_refuses_to_boot(self) -> None:
        # `resolve_session_secret` is only ever called via
        # `install_session_middleware`, which itself is gated on
        # `auth_enabled()`. Set AUTH_ENABLED_ENV=1 here so the test
        # mirrors the only path that actually invokes this function in
        # production — a production deploy with auth *off* doesn't need
        # the secret and shouldn't refuse to boot.
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(SESSION_SECRET_ENV, None)
            os.environ["MGZ_PKMN_ENV"] = "production"
            os.environ[AUTH_ENABLED_ENV] = "1"
            with self.assertRaises(RuntimeError):
                resolve_session_secret()


class UsersTableMigrationTests(_IsolatedDbMixin):
    def test_email_columns_present_after_upgrade(self) -> None:
        from api.main import app

        with TestClient(app):
            insp = inspect(session_mod.get_engine())
            cols = {c["name"] for c in insp.get_columns("users")}
            self.assertIn("email", cols)
            self.assertIn("email_verified_at", cols)
            self.assertIn("display_name", cols)

    def test_email_column_round_trips(self) -> None:
        from api.main import app

        with TestClient(app), session_mod.get_session_factory()() as s:
            u = User(
                name="test-user",
                email="alice@example.com",
                email_verified_at=datetime.now(UTC),
                display_name="Alice",
            )
            s.add(u)
            s.commit()
            fetched = s.get(User, u.id)
            assert fetched is not None
            self.assertEqual(fetched.email, "alice@example.com")
            self.assertEqual(fetched.display_name, "Alice")
            self.assertIsNotNone(fetched.email_verified_at)


def _seed_user(name: str = "alice", email: str = "alice@example.com") -> int:
    """Insert a user via the ORM and return its id.

    Helper for the session-cookie tests: the seeded id is what
    ``request.session["user_id"]`` will carry."""
    with session_mod.get_session_factory()() as s:
        u = User(name=name, email=email, display_name=name.title())
        s.add(u)
        s.commit()
        return u.id


class MeEndpointAnonymousTests(_IsolatedDbMixin):
    def test_me_returns_default_user_when_auth_off(self) -> None:
        """Self-host (auth off) surfaces the sentinel ``default`` user so
        the SPA's collections / wishlists chip-visibility check works
        identically across auth-on and auth-off modes."""
        from api.main import app

        with TestClient(app) as c:
            resp = c.get("/api/v1/me")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertFalse(body["auth_enabled"])
            self.assertIsNotNone(body["user"])
            # The first migration seeds the default user with id=1 and
            # no email / display_name. Assert id; null fields are tested
            # elsewhere via the seeded-row tests.
            self.assertEqual(body["user"]["id"], 1)


class OnboardingTests(_IsolatedDbMixin):
    """First-login onboarding gate (#742): ``/me`` reports completion and
    ``POST /me/onboarding/complete`` flips it, idempotently. Exercised in
    self-host mode against the sentinel default user."""

    def test_onboarding_starts_incomplete_then_completes(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            self.assertFalse(c.get("/api/v1/me").json()["user"]["onboarding_completed"])
            self.assertEqual(c.post("/api/v1/me/onboarding/complete").status_code, 204)
            self.assertTrue(c.get("/api/v1/me").json()["user"]["onboarding_completed"])

    def test_completing_onboarding_is_idempotent(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            self.assertEqual(c.post("/api/v1/me/onboarding/complete").status_code, 204)
            self.assertEqual(c.post("/api/v1/me/onboarding/complete").status_code, 204)
            self.assertTrue(c.get("/api/v1/me").json()["user"]["onboarding_completed"])


class MeEndpointAuthOnTests(_IsolatedDbMixin):
    """End-to-end cookie sign-in is covered by the provider sub-issues
    (#408 GitHub / #409 magic-link / #410 Google) — those wire the routes
    that actually write ``user_id`` to ``request.session``. Until they
    land, the foundation slice exercises ``GET /me`` + ``POST /logout``
    behaviour via FastAPI's ``dependency_overrides`` shim on
    ``get_current_user``, which is the conventional way to test
    auth-gated routes without simulating a full OAuth round-trip."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"

    def test_me_returns_the_overridden_user(self) -> None:
        from api.auth.session import get_current_user
        from api.main import app

        with TestClient(app) as c:
            user_id = _seed_user()
            with session_mod.get_session_factory()() as s:
                user = s.get(User, user_id)

            app.dependency_overrides[get_current_user] = lambda: user
            try:
                resp = c.get("/api/v1/me")
            finally:
                app.dependency_overrides.pop(get_current_user, None)

            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertTrue(body["auth_enabled"])
            self.assertEqual(body["user"]["id"], user_id)
            self.assertEqual(body["user"]["email"], "alice@example.com")
            self.assertEqual(body["user"]["display_name"], "Alice")

    def test_me_returns_null_user_when_auth_on_and_dependency_returns_none(self) -> None:
        from api.auth.session import get_current_user
        from api.main import app

        with TestClient(app) as c:
            app.dependency_overrides[get_current_user] = lambda: None
            try:
                resp = c.get("/api/v1/me")
            finally:
                app.dependency_overrides.pop(get_current_user, None)
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertTrue(body["auth_enabled"])
            self.assertIsNone(body["user"])

    def test_logout_is_idempotent_on_anonymous_session(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            resp = c.post("/api/v1/auth/logout")
            self.assertEqual(resp.status_code, 204)
            # Second call still 204; no state carried between calls.
            resp = c.post("/api/v1/auth/logout")
            self.assertEqual(resp.status_code, 204)


class SignedCookieRoundTripTests(_IsolatedDbMixin):
    """End-to-end cover for the SessionMiddleware integration.

    The dependency-override tests above exercise route behaviour with a
    stubbed user. These tests instead forge a real Starlette session
    cookie via the same ``itsdangerous`` + base64 scheme Starlette uses
    internally, send it through the live middleware, and confirm:

    - A correctly-signed cookie resolves the user (200).
    - A tampered cookie is silently dropped (204), proving the signing
      key is actually checked.
    """

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"

    @staticmethod
    def _sign_session(secret: str, payload: dict) -> str:
        """Mirror Starlette's ``SessionMiddleware`` cookie format:
        ``urlsafe_b64(json(payload))`` then ``itsdangerous.TimestampSigner``.

        Reproducing the format here (rather than importing Starlette's
        private writer) keeps the test resilient to internal Starlette
        refactors and documents exactly what the wire format is."""
        import base64
        import json

        from itsdangerous import TimestampSigner

        encoded = base64.b64encode(json.dumps(payload).encode("utf-8"))
        return TimestampSigner(secret).sign(encoded).decode("utf-8")

    @staticmethod
    def _mounted_session_secret(app: object) -> str:
        """Extract the secret ``SessionMiddleware`` was actually mounted
        with on this app.

        ``install_session_middleware`` runs at ``api.main`` import time
        and the resolved secret is baked into the Starlette middleware
        stack. Since the import is cached for the rest of the test run,
        whatever env was set on first import wins. Reading the live
        ``secret_key`` back from the stack means these tests work
        regardless of which other test class imported the module first."""
        from starlette.middleware.sessions import SessionMiddleware

        for entry in app.user_middleware:  # type: ignore[attr-defined]
            if entry.cls is SessionMiddleware:
                # Starlette 0.40+ stores kwargs under `entry.kwargs`;
                # older versions under `entry.options`. Try both.
                kwargs = getattr(entry, "kwargs", None) or getattr(entry, "options", {})
                return kwargs["secret_key"]
        raise RuntimeError("SessionMiddleware not mounted on app")

    def test_correctly_signed_cookie_authenticates(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            user_id = _seed_user()
            secret = self._mounted_session_secret(app)
            cookie = self._sign_session(secret, {"user_id": user_id})
            c.cookies.set("mgz_pkmn_session", cookie)
            resp = c.get("/api/v1/me")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["user"]["id"], user_id)

    def test_tampered_cookie_is_silently_rejected(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            _seed_user()
            secret = self._mounted_session_secret(app)
            cookie = self._sign_session(secret, {"user_id": 1})
            # Flip one character in the signed payload — itsdangerous's
            # signature check fails, SessionMiddleware drops the session,
            # `request.session` is empty for the route, /me returns the
            # auth-on anonymous envelope (`user: null, auth_enabled: true`).
            tampered = cookie[:-5] + ("A" if cookie[-1] != "A" else "B") + cookie[-4:]
            c.cookies.set("mgz_pkmn_session", tampered)
            resp = c.get("/api/v1/me")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertIsNone(body["user"])
            self.assertTrue(body["auth_enabled"])

    def test_cookie_signed_with_wrong_secret_is_rejected(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            _seed_user()
            cookie = self._sign_session("a-different-secret-entirely", {"user_id": 1})
            c.cookies.set("mgz_pkmn_session", cookie)
            resp = c.get("/api/v1/me")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertIsNone(body["user"])
            self.assertTrue(body["auth_enabled"])


class ProductionAuthOffStartupTests(unittest.TestCase):
    """ADR-0019's "auth default-off" posture: a production deploy with
    auth disabled doesn't need ``MGZ_PKMN_SESSION_SECRET`` and won't
    blow up on startup. The mount happens unconditionally so
    ``request.session`` exists everywhere, but ``resolve_session_secret``
    returns a silent dev placeholder when auth is off — production
    refusal kicks in only when auth is on, which is the only path that
    ever exercises the secret.

    Avoiding ``_IsolatedDbMixin`` and the force-reimport pattern: the
    contract is purely about ``install_session_middleware``'s behaviour
    under a given env, which is fully testable against a bare
    ``FastAPI()`` instance without touching the DB or app-import
    machinery — and avoids orphaning cached module references for
    subsequent test classes."""

    def setUp(self) -> None:
        self._saved = {
            k: os.environ.get(k) for k in (SESSION_SECRET_ENV, AUTH_ENABLED_ENV, "MGZ_PKMN_ENV")
        }

    def tearDown(self) -> None:
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_install_middleware_with_auth_off_in_production_does_not_raise(self) -> None:
        from fastapi import FastAPI

        from api.auth.session import install_session_middleware

        os.environ.pop(SESSION_SECRET_ENV, None)
        os.environ.pop(AUTH_ENABLED_ENV, None)
        os.environ["MGZ_PKMN_ENV"] = "production"

        # The call is the assertion: no exception, no production-refusal.
        install_session_middleware(FastAPI())

    def test_install_middleware_with_auth_on_in_production_refuses_without_secret(self) -> None:
        from fastapi import FastAPI

        from api.auth.session import install_session_middleware

        os.environ.pop(SESSION_SECRET_ENV, None)
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ["MGZ_PKMN_ENV"] = "production"

        with self.assertRaises(RuntimeError):
            install_session_middleware(FastAPI())


class GetCurrentUserBehaviourTests(_IsolatedDbMixin):
    """Direct unit tests of ``get_current_user`` against forged
    ``request.session`` dicts — covers the auth-off short-circuit and
    the cookie-points-at-missing-user fall-through that the
    dependency-override-based ``/me`` tests can't exercise."""

    def _call(self, session_dict: dict) -> User | None:
        """Invoke ``get_current_user`` with a minimal stub Request."""
        from types import SimpleNamespace

        from api.auth.session import get_current_user

        request = SimpleNamespace(session=session_dict)
        with session_mod.get_session_factory()() as s:
            # ``get_current_user`` is sync, so we can just call it.
            return get_current_user(request, s)  # type: ignore[arg-type]

    def test_returns_none_when_auth_disabled_even_with_valid_user_id(self) -> None:
        from api.main import app

        with TestClient(app):
            user_id = _seed_user()
            os.environ.pop(AUTH_ENABLED_ENV, None)
            result = self._call({"user_id": user_id})
            self.assertIsNone(result)

    def test_returns_none_when_session_has_no_user_id(self) -> None:
        from api.main import app

        with TestClient(app):
            os.environ[AUTH_ENABLED_ENV] = "1"
            self.assertIsNone(self._call({}))

    def test_returns_none_when_user_id_points_at_missing_row(self) -> None:
        from api.main import app

        with TestClient(app):
            os.environ[AUTH_ENABLED_ENV] = "1"
            self.assertIsNone(self._call({"user_id": 99999}))

    def test_returns_user_when_id_resolves(self) -> None:
        from api.main import app

        with TestClient(app):
            user_id = _seed_user()
            os.environ[AUTH_ENABLED_ENV] = "1"
            result = self._call({"user_id": user_id})
            assert result is not None
            self.assertEqual(result.email, "alice@example.com")

    def test_returns_none_when_user_id_is_unparseable(self) -> None:
        from api.main import app

        with TestClient(app):
            os.environ[AUTH_ENABLED_ENV] = "1"
            self.assertIsNone(self._call({"user_id": "not-a-number"}))


if __name__ == "__main__":
    unittest.main()
