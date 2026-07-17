"""Tests for the native-app session handoff (#924).

Covers the pieces that are specific to `api/auth/native.py` itself —
provider-specific `?next=app` wiring is covered in each provider's own
test module (`test_auth_google.py`, `test_auth_github.py`,
`test_auth_discord.py`, `test_auth_apple.py`, `test_auth_magic.py`).

- `POST /auth/native/exchange` 404s when the auth scaffold is off.
- `mint_native_code` / `burn_native_code` round-trip a user id.
- A burned code can't be replayed (single-use).
- An expired code is rejected.
- A tampered code is rejected.
- `/auth/native/exchange` with an unknown/garbage code → 400.
- `/auth/native/exchange` happy path: burns the code, sets the session
  cookie via `SessionMiddleware`, and returns a `session_token` in the
  body that is byte-identical to the `Set-Cookie` value and actually
  authenticates a subsequent `/me` call when replayed as a cookie.
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from api.auth import native as native_mod
from api.auth.native import (
    CODE_TTL_SECONDS,
    NATIVE_CALLBACK_SCHEME,
    burn_native_code,
    mint_native_code,
)
from api.auth.session import AUTH_ENABLED_ENV, SESSION_COOKIE_NAME, SESSION_SECRET_ENV
from api.db import session as session_mod
from api.db.models import User


class _IsolatedDbMixin(unittest.TestCase):
    """Fresh sqlite + env reset per test, same pattern as the other auth
    test modules."""

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
        os.environ.pop(AUTH_ENABLED_ENV, None)
        session_mod.reset_engine()
        native_mod._burned_jtis.clear()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        native_mod._burned_jtis.clear()
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()


class ExchangeGateTests(_IsolatedDbMixin):
    def test_exchange_returns_404_when_auth_off(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            r = client.post("/api/v1/auth/native/exchange", json={"code": "whatever"})
            self.assertEqual(r.status_code, 404)
            self.assertEqual(r.json(), {"detail": "Not Found"})


class MintBurnCodeTests(_IsolatedDbMixin):
    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"

    def test_mint_then_burn_returns_user_id(self) -> None:
        code = mint_native_code(42)
        self.assertEqual(burn_native_code(code), 42)

    def test_burn_is_single_use(self) -> None:
        code = mint_native_code(7)
        self.assertEqual(burn_native_code(code), 7)
        # Same code replayed — already spent, even though it's still
        # within the TTL window.
        self.assertIsNone(burn_native_code(code))

    def test_burn_rejects_tampered_code(self) -> None:
        code = mint_native_code(9)
        self.assertIsNone(burn_native_code(code + "tampered"))

    def test_burn_rejects_expired_code(self) -> None:
        code = mint_native_code(11)
        with patch(
            "itsdangerous.timed.time.time",
            return_value=time.time() + CODE_TTL_SECONDS + 5,
        ):
            self.assertIsNone(burn_native_code(code))

    def test_burn_rejects_garbage_input(self) -> None:
        self.assertIsNone(burn_native_code("not-a-real-token"))

    def test_two_codes_for_same_user_are_independent(self) -> None:
        first = mint_native_code(5)
        second = mint_native_code(5)
        self.assertNotEqual(first, second)
        self.assertEqual(burn_native_code(first), 5)
        self.assertEqual(burn_native_code(second), 5)


class ExchangeEndpointTests(_IsolatedDbMixin):
    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"

    def _seed_user(self, *, email: str = "native@example.com") -> int:
        with session_mod.get_session_factory()() as s:
            user = User(
                name="native-user",
                email=email,
                email_verified_at=datetime.now(UTC),
                display_name="Native User",
            )
            s.add(user)
            s.commit()
            return user.id

    def test_invalid_code_returns_400(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            r = client.post("/api/v1/auth/native/exchange", json={"code": "garbage"})
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "invalid_or_expired_code")

    def test_code_for_deleted_user_returns_400(self) -> None:
        from api.main import app

        code = mint_native_code(999999)
        with TestClient(app) as client:
            r = client.post("/api/v1/auth/native/exchange", json={"code": code})
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "invalid_or_expired_code")

    def test_exchange_sets_cookie_and_returns_matching_session_token(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            user_id = self._seed_user()
            code = mint_native_code(user_id)
            r = client.post("/api/v1/auth/native/exchange", json={"code": code})
            self.assertEqual(r.status_code, 200)
            session_token = r.json()["session_token"]
            self.assertTrue(session_token)
            # The Set-Cookie header's value must be byte-identical to
            # the body's `session_token` — that's the whole point of
            # the two-ways-at-once contract.
            cookie_value = client.cookies.get(SESSION_COOKIE_NAME)
            self.assertEqual(cookie_value, session_token)

    def test_returned_session_token_authenticates_me_when_replayed(self) -> None:
        """The acceptance criterion: a client with *no* cookie jar can
        take just the `session_token` string and replay it as the
        `mgz_pkmn_session` cookie to authenticate."""
        from api.main import app

        with TestClient(app) as client:
            user_id = self._seed_user(email="replay@example.com")
            code = mint_native_code(user_id)
            r = client.post("/api/v1/auth/native/exchange", json={"code": code})
            self.assertEqual(r.status_code, 200)
            session_token = r.json()["session_token"]

        # Fresh client, fresh cookie jar — only the raw token string
        # survives, exactly as a Keychain-backed native client would.
        with TestClient(app) as fresh_client:
            fresh_client.cookies.set(SESSION_COOKIE_NAME, session_token)
            me = fresh_client.get("/api/v1/me")
            self.assertEqual(me.status_code, 200)
            payload = me.json()["user"]
            self.assertEqual(payload["email"], "replay@example.com")
            self.assertEqual(payload["id"], user_id)

    def test_exchange_code_cannot_be_replayed(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            user_id = self._seed_user(email="onceonly@example.com")
            code = mint_native_code(user_id)
            first = client.post("/api/v1/auth/native/exchange", json={"code": code})
            self.assertEqual(first.status_code, 200)
            second = client.post("/api/v1/auth/native/exchange", json={"code": code})
            self.assertEqual(second.status_code, 400)
            self.assertEqual(second.json()["detail"], "invalid_or_expired_code")


class RedirectHelperTests(unittest.TestCase):
    def test_success_redirect_uses_fixed_scheme(self) -> None:
        resp = native_mod.native_success_redirect("abc123")
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.headers["location"], f"{NATIVE_CALLBACK_SCHEME}?code=abc123")

    def test_error_redirect_uses_fixed_scheme(self) -> None:
        resp = native_mod.native_error_redirect("oauth_failed")
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.headers["location"], f"{NATIVE_CALLBACK_SCHEME}?error=oauth_failed")


if __name__ == "__main__":
    unittest.main()
