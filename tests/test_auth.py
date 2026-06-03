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

    def test_missing_in_dev_falls_back_with_warning(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(SESSION_SECRET_ENV, None)
            os.environ["MGZ_PKMN_ENV"] = "dev"
            with self.assertLogs("api.auth.session", level="WARNING") as cm:
                value = resolve_session_secret()
            self.assertTrue(value)  # non-empty fallback
            self.assertTrue(any("unset" in line for line in cm.output))

    def test_missing_in_production_refuses_to_boot(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(SESSION_SECRET_ENV, None)
            os.environ["MGZ_PKMN_ENV"] = "production"
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
    def test_me_returns_204_when_no_cookie(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            resp = c.get("/api/v1/me")
            self.assertEqual(resp.status_code, 204)


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
            self.assertEqual(body["id"], user_id)
            self.assertEqual(body["email"], "alice@example.com")
            self.assertEqual(body["display_name"], "Alice")

    def test_me_returns_204_when_dependency_returns_none(self) -> None:
        from api.auth.session import get_current_user
        from api.main import app

        with TestClient(app) as c:
            app.dependency_overrides[get_current_user] = lambda: None
            try:
                resp = c.get("/api/v1/me")
            finally:
                app.dependency_overrides.pop(get_current_user, None)
            self.assertEqual(resp.status_code, 204)

    def test_logout_is_idempotent_on_anonymous_session(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            resp = c.post("/api/v1/auth/logout")
            self.assertEqual(resp.status_code, 204)
            # Second call still 204; no state carried between calls.
            resp = c.post("/api/v1/auth/logout")
            self.assertEqual(resp.status_code, 204)


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
