"""Tests for the Sign in with Apple slice (#530).

Same shape as ``tests/test_auth_google.py``. Apple's twists drive a
handful of extras over the Google template:

- ``/auth/apple/callback`` is a **POST** (Apple uses
  ``response_mode=form_post``) rather than a GET, and it arrives as a
  *cross-site* POST from ``appleid.apple.com``. Browsers do not send
  our ``SameSite=Lax`` session cookie on that request, so Apple's
  OAuth ``state`` is signed into a self-contained itsdangerous token
  (no session storage). The test suite drives the callback with real
  signed tokens via ``_make_state`` and explicitly exercises a
  no-cookie request to confirm the cookie-less property.
- The Apple provider verifies the ``id_token`` JWT itself; tests mint
  real ES256 tokens with a local EC key and patch the JWKS fetch to
  return the matching public key.
- The token exchange against Apple's ``/auth/token`` endpoint is a
  direct httpx call (no Authlib in the Apple path); tests patch
  ``api.auth.apple.exchange_code_for_token`` as the single seam.
- The ``user`` form field is JSON carrying the user's first/last name
  on the *first* successful sign-in only — tests cover both the
  first-hit and subsequent-sign-in shapes.
- A ``@privaterelay.appleid.com`` email is treated as verified like
  any other (per ADR-0019 the relay address is the merge anchor).

Covers:

- ``/auth/apple/login`` 404s when the auth scaffold is off, returns
  503 when any Apple env var is missing, 302s to Apple with a signed
  ``state`` parameter on the happy path.
- Callback: state missing, tampered, signed with the wrong secret, or
  carrying a ``link_user_id`` payload (which must not be replayable on
  the sign-in route) → 400 ``oauth_failed``.
- Callback: ``id_token`` signature mismatch → 400.
- Callback: unverified or missing ``email`` claim → 400
  ``no_verified_email``; ``email_verified=false`` does not mint a
  users row.
- Callback: missing ``sub`` → 400 ``no_apple_sub``.
- Callback: fresh signup creates a ``users`` row, sets the session
  cookie, redirects to ``/`` — including the cookie-less case where
  no session cookie was attached on the request.
- Callback: existing email reuses the row; ``display_name`` is **not**
  overwritten when the row already has one (ADR-0019 first-set-wins).
- Callback: existing row with no display_name *does* get populated
  from the first-hit ``user`` form field.
- Private-relay address (``@privaterelay.appleid.com``) is treated as a
  verified email; merge contract holds.
- ``mint_client_secret`` produces a verifiable ES256 JWT with the
  expected header / claims.
- Client-secret cache returns the same token for repeat calls inside
  the TTL window — Apple is *not* signed on every callback.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from authlib.jose import JsonWebKey, jwt
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from api.auth import apple as apple_mod
from api.auth.apple import (
    APPLE_CLIENT_ID_ENV,
    APPLE_ISSUER,
    APPLE_KEY_ID_ENV,
    APPLE_PRIVATE_KEY_ENV,
    APPLE_TEAM_ID_ENV,
    AppleProfile,
    extract_profile,
    mint_client_secret,
)
from api.auth.session import AUTH_ENABLED_ENV, SESSION_SECRET_ENV
from api.db import session as session_mod
from api.db.models import User

# Generate one EC keypair the whole test module reuses — ES256 key gen
# is cheap but not free, and the keys themselves carry no state across
# cases.
_TEST_KEY_ID = "TESTKEYID1"
_TEST_TEAM_ID = "TESTTEAMID"
_TEST_SERVICES_ID = "com.mgz-pkmn.test"
_TEST_JWK = JsonWebKey.generate_key("EC", "P-256", is_private=True)
_TEST_PRIVATE_PEM = _TEST_JWK.as_pem(is_private=True).decode("ascii")
_TEST_PUBLIC_JWK = _TEST_JWK.as_dict(is_private=False)
_TEST_PUBLIC_JWK["kid"] = _TEST_KEY_ID
_TEST_PUBLIC_JWK["alg"] = "ES256"
_TEST_PUBLIC_JWK["use"] = "sig"
_TEST_JWKS = {"keys": [_TEST_PUBLIC_JWK]}


def _make_state(*, link_user_id: int | None = None) -> str:
    """Mint a valid Apple OAuth state token.

    Drives the cookie-less state validation path: tests build a real
    signed state token via the module's serializer (keyed on
    ``MGZ_PKMN_SESSION_SECRET`` which the mixin sets), POST it in the
    Apple callback body, and the callback verifies the signature
    without any cookie. Mirrors how Apple's actual cross-site POST
    would behave.
    """
    return apple_mod._build_state_token(link_user_id=link_user_id)


def _make_id_token(
    *,
    sub: str = "001234.aaa.bbb",
    email: str | None = "alice@example.com",
    email_verified: bool | str | None = True,
    audience: str | None = None,
    issuer: str = APPLE_ISSUER,
    extra_claims: dict | None = None,
    sign_with_pem: str | None = None,
    key_id: str = _TEST_KEY_ID,
) -> str:
    """Mint a test id_token signed with the module's EC key.

    Defaults emit a token verify_id_token will accept against the
    public JWKS exposed via ``_TEST_JWKS``. Pass ``sign_with_pem`` to
    sign with a different (mismatched) key to exercise the verification
    failure path. ``email_verified`` defaults to ``True``; pass ``False``
    (or the string ``"false"``) to exercise the Managed-Apple-Account /
    Work & School path where Apple ships an email it hasn't confirmed.
    """
    now = int(time.time())
    claims = {
        "iss": issuer,
        "aud": audience or _TEST_SERVICES_ID,
        "iat": now,
        "exp": now + 600,
        "sub": sub,
    }
    if email is not None:
        claims["email"] = email
        if email_verified is not None:
            claims["email_verified"] = email_verified
    if extra_claims:
        claims.update(extra_claims)
    headers = {"alg": "ES256", "kid": key_id}
    pem = sign_with_pem if sign_with_pem is not None else _TEST_PRIVATE_PEM
    token_bytes = jwt.encode(headers, claims, pem)
    return token_bytes.decode("ascii") if isinstance(token_bytes, bytes) else str(token_bytes)


class _IsolatedDbMixin(unittest.TestCase):
    """Fresh sqlite per test + env restoration on teardown — same
    pattern as ``test_auth_github.py`` / ``test_auth_google.py``."""

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
                APPLE_CLIENT_ID_ENV,
                APPLE_TEAM_ID_ENV,
                APPLE_KEY_ID_ENV,
                APPLE_PRIVATE_KEY_ENV,
                "MGZ_PKMN_ENV",
            )
        }
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        os.environ[SESSION_SECRET_ENV] = "unit-test-secret-do-not-care"
        os.environ.pop(AUTH_ENABLED_ENV, None)
        for k in (
            APPLE_CLIENT_ID_ENV,
            APPLE_TEAM_ID_ENV,
            APPLE_KEY_ID_ENV,
            APPLE_PRIVATE_KEY_ENV,
        ):
            os.environ.pop(k, None)
        session_mod.reset_engine()
        apple_mod._reset_client_secret_cache()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        apple_mod._reset_client_secret_cache()
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
            r = client.get("/api/v1/auth/apple/login", follow_redirects=False)
            self.assertEqual(r.status_code, 404)
            self.assertEqual(r.json(), {"detail": "Not Found"})

    def test_login_returns_503_when_env_vars_missing(self) -> None:
        # Auth on but the Apple env vars are missing — should 503.
        os.environ[AUTH_ENABLED_ENV] = "1"
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/auth/apple/login", follow_redirects=False)
            self.assertEqual(r.status_code, 503)
            self.assertIn("Apple sign-in not configured", r.json().get("detail", ""))

    def test_login_redirects_to_apple_with_signed_state(self) -> None:
        """The login route 302s to Apple's authorize URL with a signed
        ``state`` parameter. This is the cookie-less state path: the
        only validation material at callback time is the state value
        in Apple's form-POST body, so we assert it round-trips through
        our serializer."""
        from urllib.parse import parse_qs, urlparse

        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[APPLE_CLIENT_ID_ENV] = _TEST_SERVICES_ID
        os.environ[APPLE_TEAM_ID_ENV] = _TEST_TEAM_ID
        os.environ[APPLE_KEY_ID_ENV] = _TEST_KEY_ID
        os.environ[APPLE_PRIVATE_KEY_ENV] = _TEST_PRIVATE_PEM
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/auth/apple/login", follow_redirects=False)
            self.assertEqual(r.status_code, 302)
            parsed = urlparse(r.headers["location"])
            self.assertEqual(
                f"{parsed.scheme}://{parsed.netloc}{parsed.path}",
                apple_mod.APPLE_AUTHORIZE_URL,
            )
            params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            self.assertEqual(params["response_type"], "code")
            self.assertEqual(params["response_mode"], "form_post")
            self.assertEqual(params["client_id"], _TEST_SERVICES_ID)
            self.assertEqual(params["scope"], "name email")
            self.assertIn("state", params)
            # The state must verify against the module's serializer —
            # confirms it's signed with the project session secret and
            # the Apple-state salt.
            payload = apple_mod._verify_state_token(params["state"])
            self.assertIsNotNone(payload)
            self.assertIn("n", payload)
            self.assertNotIn("link", payload)

    def test_login_returns_503_when_only_one_env_var_set(self) -> None:
        # Half-configured should still 503 — exercises the all-or-nothing check.
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[APPLE_CLIENT_ID_ENV] = _TEST_SERVICES_ID
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/auth/apple/login", follow_redirects=False)
            self.assertEqual(r.status_code, 503)


class CallbackErrorTests(_IsolatedDbMixin):
    """Callback handler error branches.

    Apple's sign-in callback is a cross-site POST from
    ``appleid.apple.com``; browsers do not send our ``SameSite=Lax``
    session cookie on that request. These tests therefore drive the
    callback *without* a TestClient cookie jar entry: state validation
    relies entirely on the signed state token in the POST body, and the
    token-exchange / JWKS seams are patched so we never need a real
    Apple server."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[APPLE_CLIENT_ID_ENV] = _TEST_SERVICES_ID
        os.environ[APPLE_TEAM_ID_ENV] = _TEST_TEAM_ID
        os.environ[APPLE_KEY_ID_ENV] = _TEST_KEY_ID
        os.environ[APPLE_PRIVATE_KEY_ENV] = _TEST_PRIVATE_PEM

    def _post(
        self,
        client: TestClient,
        data: dict[str, str],
        *,
        token_exchange_result: dict | None = None,
    ) -> tuple[int, dict]:
        """Drive the Apple sign-in callback with the seams Apple would
        round-trip patched out. State / Apple-error branches don't reach
        the exchange, so the token mock is optional."""
        with contextlib.ExitStack() as stack:
            stack.enter_context(
                patch(
                    "api.auth.apple.fetch_apple_jwks",
                    new=AsyncMock(return_value=_TEST_JWKS),
                )
            )
            if token_exchange_result is not None:
                stack.enter_context(
                    patch(
                        "api.auth.apple.exchange_code_for_token",
                        new=AsyncMock(return_value=token_exchange_result),
                    )
                )
            r = client.post(
                "/api/v1/auth/apple/callback",
                data=data,
                follow_redirects=False,
            )
            return r.status_code, r.json() if r.content else {}

    def test_callback_state_missing_returns_400(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            status, body = self._post(client, {"code": "abc"})
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "oauth_failed")

    def test_callback_state_tampered_returns_400(self) -> None:
        """A signed-state token with the payload swapped or trailing
        garbage must fail signature verification. Exercises the
        cookie-less state path — the only material the callback sees is
        the form body."""
        from api.main import app

        good = _make_state()
        # Flip a character mid-token. itsdangerous's HMAC catches it.
        tampered = good[:-2] + ("a" if good[-2] != "a" else "b") + good[-1]
        with TestClient(app) as client:
            status, body = self._post(client, {"code": "abc", "state": tampered})
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "oauth_failed")

    def test_callback_state_signed_with_wrong_secret_returns_400(self) -> None:
        """A state token signed by a different secret (e.g. a previous
        deploy or an attacker) fails signature verification."""
        from itsdangerous import URLSafeTimedSerializer

        from api.main import app

        wrong = URLSafeTimedSerializer("not-the-real-secret", salt=apple_mod.STATE_TOKEN_SALT)
        bad_state = wrong.dumps({"n": "doesnt-matter"})
        with TestClient(app) as client:
            status, body = self._post(client, {"code": "abc", "state": bad_state})
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "oauth_failed")

    def test_callback_link_state_rejected_on_signin_route(self) -> None:
        """A state token containing ``link_user_id`` must not be
        replayable as a sign-in; otherwise a leaked link-state could be
        used to sign in someone else."""
        from api.main import app

        link_state = _make_state(link_user_id=42)
        with TestClient(app) as client:
            status, body = self._post(client, {"code": "abc", "state": link_state})
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "oauth_failed")

    def test_callback_apple_returned_error_field(self) -> None:
        # Apple posts ``error`` directly when the user refuses or the
        # request is malformed; we short-circuit to 400 without
        # touching the token endpoint or even verifying state.
        from api.main import app

        with TestClient(app) as client:
            status, body = self._post(
                client,
                {"error": "user_cancelled_authorize", "state": _make_state()},
            )
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "oauth_failed")

    def test_callback_id_token_signature_mismatch_returns_400(self) -> None:
        """Token signed with a key not in the published JWKS → 400."""
        from api.main import app

        wrong_jwk = JsonWebKey.generate_key("EC", "P-256", is_private=True)
        wrong_pem = wrong_jwk.as_pem(is_private=True).decode("ascii")
        bad_token = _make_id_token(sign_with_pem=wrong_pem)
        token = {"access_token": "x", "id_token": bad_token, "token_type": "bearer"}

        with TestClient(app) as client:
            status, body = self._post(
                client,
                {"code": "abc", "state": _make_state()},
                token_exchange_result=token,
            )
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "oauth_failed")

    def test_callback_unverified_email_claim_returns_400(self) -> None:
        """Apple ships ``email_verified=false`` for Managed Apple Account /
        Work & School users where the address is attached but not
        confirmed; treating it as verified would let two accounts
        claim the same address. The callback must drop the email and
        surface the same ``no_verified_email`` shape as a missing
        claim — confirms the security finding from PR #532 review."""
        from api.main import app

        token_str = _make_id_token(
            email="managed@example.com",
            email_verified="false",
            sub="001.unverified",
        )
        token = {"access_token": "x", "id_token": token_str, "token_type": "bearer"}
        with TestClient(app) as client:
            status, body = self._post(
                client,
                {"code": "abc", "state": _make_state()},
                token_exchange_result=token,
            )
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "no_verified_email")
            # No users row was created — the unverified email must not
            # leak into the merge anchor.
            with session_mod.get_session_factory()() as s:
                n = s.scalar(
                    select(func.count())
                    .select_from(User)
                    .where(User.email == "managed@example.com")
                )
                self.assertEqual(n, 0)

    def test_callback_missing_email_claim_returns_400(self) -> None:
        from api.main import app

        token_str = _make_id_token(email=None, sub="001.no.email")
        token = {"access_token": "x", "id_token": token_str, "token_type": "bearer"}
        with TestClient(app) as client:
            status, body = self._post(
                client,
                {"code": "abc", "state": _make_state()},
                token_exchange_result=token,
            )
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "no_verified_email")

    def test_callback_missing_sub_returns_400(self) -> None:
        from api.main import app

        token_str = _make_id_token(sub="", email="x@example.com")
        token = {"access_token": "x", "id_token": token_str, "token_type": "bearer"}
        with TestClient(app) as client:
            status, body = self._post(
                client,
                {"code": "abc", "state": _make_state()},
                token_exchange_result=token,
            )
            self.assertEqual(status, 400)
            self.assertEqual(body["detail"], "no_apple_sub")


class CallbackHappyPathTests(_IsolatedDbMixin):
    """End-to-end behaviour with Authlib + Apple's JWKS patched out."""

    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[APPLE_CLIENT_ID_ENV] = _TEST_SERVICES_ID
        os.environ[APPLE_TEAM_ID_ENV] = _TEST_TEAM_ID
        os.environ[APPLE_KEY_ID_ENV] = _TEST_KEY_ID
        os.environ[APPLE_PRIVATE_KEY_ENV] = _TEST_PRIVATE_PEM

    def _drive_callback(
        self,
        client: TestClient,
        *,
        sub: str = "001234.aaa.bbb",
        email: str | None = "alice@example.com",
        user_payload: str | None = None,
    ) -> tuple[int, str | None]:
        token_str = _make_id_token(sub=sub, email=email)
        token = {"access_token": "x", "id_token": token_str, "token_type": "bearer"}
        data: dict[str, str] = {"code": "abc", "state": _make_state()}
        if user_payload is not None:
            data["user"] = user_payload
        with (
            patch(
                "api.auth.apple.exchange_code_for_token",
                new=AsyncMock(return_value=token),
            ),
            patch(
                "api.auth.apple.fetch_apple_jwks",
                new=AsyncMock(return_value=_TEST_JWKS),
            ),
        ):
            r = client.post(
                "/api/v1/auth/apple/callback",
                data=data,
                follow_redirects=False,
            )
            return r.status_code, r.headers.get("location")

    def test_fresh_signup_creates_user_and_redirects_to_root(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            status, location = self._drive_callback(
                client,
                sub="001234.aabbcc",
                email="alice@example.com",
                user_payload=json.dumps({"name": {"firstName": "Alice", "lastName": "Liddell"}}),
            )
            self.assertEqual(status, 302)
            self.assertEqual(location, "/")
            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == "alice@example.com"))
                assert user is not None
                self.assertEqual(user.email, "alice@example.com")
                self.assertEqual(user.display_name, "Alice Liddell")
                self.assertIsNotNone(user.email_verified_at)
                self.assertEqual(user.name, "apple:001234.aabbcc")

    def test_callback_issues_session_cookie_that_authenticates_subsequent_me(
        self,
    ) -> None:
        from api.main import app

        with TestClient(app) as client:
            status, _ = self._drive_callback(
                client,
                sub="002.session.cookie",
                email="dani@example.com",
                user_payload=json.dumps({"name": {"firstName": "Dani", "lastName": "Reyes"}}),
            )
            self.assertEqual(status, 302)
            me = client.get("/api/v1/me")
            self.assertEqual(me.status_code, 200)
            payload = me.json()["user"]
            self.assertEqual(payload["email"], "dani@example.com")
            self.assertEqual(payload["display_name"], "Dani Reyes")
            self.assertIsInstance(payload["id"], int)

    def test_existing_user_is_reused_display_name_preserved(self) -> None:
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

            # Apple sign-in for the same email — even on first hit,
            # the existing display_name must stick.
            status, location = self._drive_callback(
                client,
                sub="003.bob.apple",
                email="bob@example.com",
                user_payload=json.dumps({"name": {"firstName": "Robert", "lastName": "Builder"}}),
            )
            self.assertEqual(status, 302)
            self.assertEqual(location, "/")
            with session_mod.get_session_factory()() as s:
                user = s.get(User, existing_id)
                assert user is not None
                self.assertEqual(user.display_name, "bob-the-builder")
                self.assertEqual(user.email, "bob@example.com")
                n = s.scalar(
                    select(func.count()).select_from(User).where(User.email == "bob@example.com")
                )
                self.assertEqual(n, 1)

    def test_existing_user_without_display_name_gets_first_hit_name(self) -> None:
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
                sub="004.carol.apple",
                email="carol@example.com",
                user_payload=json.dumps({"name": {"firstName": "Carol", "lastName": "Danvers"}}),
            )
            self.assertEqual(status, 302)
            with session_mod.get_session_factory()() as s:
                user = s.get(User, existing_id)
                assert user is not None
                self.assertEqual(user.display_name, "Carol Danvers")

    def test_subsequent_signin_without_user_payload_keeps_display_name(self) -> None:
        # First sign-in supplies ``user``; the second won't (Apple omits
        # it). The display_name must still be present after the second
        # call — set on the first, untouched by first-set-wins after.
        from api.main import app

        with TestClient(app) as client:
            self._drive_callback(
                client,
                sub="005.repeat",
                email="repeat@example.com",
                user_payload=json.dumps({"name": {"firstName": "Repeat", "lastName": "User"}}),
            )
            # Second sign-in, no user payload.
            status, _ = self._drive_callback(
                client,
                sub="005.repeat",
                email="repeat@example.com",
                user_payload=None,
            )
            self.assertEqual(status, 302)
            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == "repeat@example.com"))
                assert user is not None
                self.assertEqual(user.display_name, "Repeat User")

    def test_private_relay_email_is_treated_as_verified(self) -> None:
        """``@privaterelay.appleid.com`` is the merge anchor for any
        user that picked private relay — same contract as a real email."""
        from api.main import app

        relay = "abc123.def456@privaterelay.appleid.com"
        with TestClient(app) as client:
            status, location = self._drive_callback(
                client,
                sub="006.relay.user",
                email=relay,
                user_payload=json.dumps({"name": {"firstName": "Relay", "lastName": "User"}}),
            )
            self.assertEqual(status, 302)
            self.assertEqual(location, "/")
            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == relay))
                assert user is not None
                self.assertEqual(user.email, relay)
                self.assertEqual(user.display_name, "Relay User")

    def test_callback_succeeds_without_any_session_cookie(self) -> None:
        """The core property: Apple's cross-site POST arrives with **no
        cookies attached** because the browser strips our SameSite=Lax
        session cookie on cross-site POSTs. The callback has to succeed
        anyway, relying purely on the signed state token in the body —
        otherwise no real Apple sign-in would ever work in production.

        Concretely: we use the requests library directly with an empty
        cookie jar (TestClient inside a fresh context that's never
        seen ``/auth/apple/login``), confirm the callback returns 302,
        and confirm `/me` works after."""
        from api.main import app

        token_str = _make_id_token(
            sub="007.no.cookie",
            email="cross-site@example.com",
        )
        exchange = {"access_token": "x", "id_token": token_str, "token_type": "bearer"}

        with TestClient(app) as client:
            # Sanity: the client starts with no cookies. Apple's POST
            # to our callback would carry none for the same reason
            # (cross-site origin + Lax session cookie).
            self.assertEqual(len(client.cookies), 0)
            with (
                patch(
                    "api.auth.apple.exchange_code_for_token",
                    new=AsyncMock(return_value=exchange),
                ),
                patch(
                    "api.auth.apple.fetch_apple_jwks",
                    new=AsyncMock(return_value=_TEST_JWKS),
                ),
            ):
                r = client.post(
                    "/api/v1/auth/apple/callback",
                    data={
                        "code": "abc",
                        "state": _make_state(),
                        "user": json.dumps({"name": {"firstName": "Cross", "lastName": "Site"}}),
                    },
                    # Disable any cookie the TestClient might have
                    # picked up between cases — this case must
                    # explicitly run against a cold cookie jar.
                    cookies={},
                    follow_redirects=False,
                )
            self.assertEqual(r.status_code, 302)
            self.assertEqual(r.headers["location"], "/")
            # Session cookie is set on the *response* (signing the user
            # in), so the subsequent `/me` works against the same client.
            me = client.get("/api/v1/me")
            self.assertEqual(me.status_code, 200)
            self.assertEqual(me.json()["user"]["email"], "cross-site@example.com")


class ClientSecretMintingTests(unittest.TestCase):
    """Direct coverage of the client_secret JWT minting + caching."""

    def setUp(self) -> None:
        apple_mod._reset_client_secret_cache()

    def tearDown(self) -> None:
        apple_mod._reset_client_secret_cache()

    def test_mint_produces_es256_token_with_expected_claims(self) -> None:
        token_str = mint_client_secret(
            services_id=_TEST_SERVICES_ID,
            team_id=_TEST_TEAM_ID,
            key_id=_TEST_KEY_ID,
            private_key_pem=_TEST_PRIVATE_PEM,
            now=1_700_000_000,
            ttl_seconds=3600,
        )
        # Verify with the matching public JWK — confirms ES256 signing
        # works end-to-end without us hand-rolling the base64 inspection.
        key_set = JsonWebKey.import_key_set(_TEST_JWKS)
        claims = jwt.decode(token_str, key=key_set)
        self.assertEqual(claims["iss"], _TEST_TEAM_ID)
        self.assertEqual(claims["sub"], _TEST_SERVICES_ID)
        self.assertEqual(claims["aud"], APPLE_ISSUER)
        self.assertEqual(claims["iat"], 1_700_000_000)
        self.assertEqual(claims["exp"], 1_700_003_600)

    def test_cache_reuses_token_within_ttl(self) -> None:
        """``_get_client_secret`` must not re-sign on every callback."""
        sign_calls = {"n": 0}
        real_mint = apple_mod.mint_client_secret

        def counting_mint(**kwargs):
            sign_calls["n"] += 1
            return real_mint(**kwargs)

        with patch.object(apple_mod, "mint_client_secret", side_effect=counting_mint):
            first = apple_mod._get_client_secret(
                services_id=_TEST_SERVICES_ID,
                team_id=_TEST_TEAM_ID,
                key_id=_TEST_KEY_ID,
                private_key_pem=_TEST_PRIVATE_PEM,
            )
            second = apple_mod._get_client_secret(
                services_id=_TEST_SERVICES_ID,
                team_id=_TEST_TEAM_ID,
                key_id=_TEST_KEY_ID,
                private_key_pem=_TEST_PRIVATE_PEM,
            )
        self.assertEqual(first, second)
        self.assertEqual(sign_calls["n"], 1)


class ExtractProfileTests(unittest.TestCase):
    """Direct unit coverage of the small ``extract_profile`` helper.

    The callback's name handling is the most behavior-rich piece —
    parking it behind a pure helper lets us assert the matrix without
    standing up an HTTP client."""

    def test_first_hit_user_payload_parses_full_name(self) -> None:
        payload = json.dumps({"name": {"firstName": "Ada", "lastName": "Lovelace"}})
        profile = extract_profile(
            {"sub": "abc", "email": "ada@example.com", "email_verified": True},
            user_payload=payload,
        )
        self.assertEqual(
            profile, AppleProfile(sub="abc", email="ada@example.com", name="Ada Lovelace")
        )

    def test_first_hit_with_only_first_name(self) -> None:
        payload = json.dumps({"name": {"firstName": "Cher"}})
        profile = extract_profile(
            {"sub": "abc", "email": "cher@example.com", "email_verified": True},
            user_payload=payload,
        )
        self.assertEqual(profile.name, "Cher")

    def test_subsequent_signin_user_payload_omitted(self) -> None:
        profile = extract_profile(
            {"sub": "abc", "email": "ada@example.com", "email_verified": True},
            user_payload=None,
        )
        self.assertIsNone(profile.name)

    def test_malformed_user_payload_treated_as_no_name(self) -> None:
        profile = extract_profile(
            {"sub": "abc", "email": "ada@example.com", "email_verified": True},
            user_payload="not-json{",
        )
        self.assertIsNone(profile.name)

    def test_empty_email_collapses_to_none(self) -> None:
        profile = extract_profile(
            {"sub": "abc", "email": "   ", "email_verified": True},
            user_payload=None,
        )
        self.assertIsNone(profile.email)

    def test_unverified_email_string_false_drops_email(self) -> None:
        # Apple's id_token boolean claims arrive as JSON strings for
        # the Managed Apple Account / Work & School pool.
        profile = extract_profile(
            {"sub": "abc", "email": "managed@example.com", "email_verified": "false"},
            user_payload=None,
        )
        self.assertIsNone(profile.email)

    def test_unverified_email_bool_false_drops_email(self) -> None:
        profile = extract_profile(
            {"sub": "abc", "email": "managed@example.com", "email_verified": False},
            user_payload=None,
        )
        self.assertIsNone(profile.email)

    def test_missing_email_verified_claim_drops_email(self) -> None:
        # Belt-and-braces: if Apple omits ``email_verified`` entirely
        # (shouldn't happen, but is the safer-by-default branch in
        # ``_claim_is_true``) we must still refuse the email.
        profile = extract_profile(
            {"sub": "abc", "email": "managed@example.com"},
            user_payload=None,
        )
        self.assertIsNone(profile.email)

    def test_verified_email_string_true_accepted(self) -> None:
        profile = extract_profile(
            {"sub": "abc", "email": "ada@example.com", "email_verified": "true"},
            user_payload=None,
        )
        self.assertEqual(profile.email, "ada@example.com")


if __name__ == "__main__":
    unittest.main()
