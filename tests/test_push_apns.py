"""Tests for the APNs `PushSender` (#976, epic #946).

Covers:

- ``mint_provider_token`` produces a verifiable ES256 JWT with the
  expected header/claims (no ``sub``/``aud``/``exp`` — APNs' provider
  token doesn't need them, unlike the Apple Sign-In client secret in
  ``api/auth/apple.py``).
- The provider-token cache returns the same token for repeat calls
  inside the TTL window.
- ``ApnsSender.send`` — happy path (200); only the unambiguous
  410/``Unregistered`` response flags ``invalid_token``.
  ``BadDeviceToken`` and ``DeviceTokenNotForTopic`` (both of which can
  also mean a deploy misconfiguration, not a dead device) and any other
  rejection flag neither, plus the unconfigured-env skip.
- ``MGZ_PKMN_APNS_ENVIRONMENT=sandbox`` targets the sandbox host.

Mirrors the httpx single-seam patch pattern from
``tests/test_subscribe_api.py`` (``patch.object(module.httpx,
"AsyncClient", ...)``) rather than mocking a lower-level transport.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from authlib.jose import JsonWebKey, jwt

from api.push import apns as apns_mod
from api.push.apns import (
    APNS_BUNDLE_ID_ENV,
    APNS_ENVIRONMENT_ENV,
    APNS_KEY_ID_ENV,
    APNS_PRIVATE_KEY_ENV,
    APNS_PRODUCTION_URL,
    APNS_SANDBOX_URL,
    APNS_TEAM_ID_ENV,
    ApnsSender,
    mint_provider_token,
)

_TEST_KEY_ID = "TESTKEYID1"
_TEST_TEAM_ID = "TESTTEAMID"
_TEST_JWK = JsonWebKey.generate_key("EC", "P-256", is_private=True)
_TEST_PRIVATE_PEM = _TEST_JWK.as_pem(is_private=True).decode("ascii")
_TEST_PUBLIC_JWK = _TEST_JWK.as_dict(is_private=False)
_TEST_PUBLIC_JWK["kid"] = _TEST_KEY_ID
_TEST_PUBLIC_JWK["alg"] = "ES256"
_TEST_PUBLIC_JWK["use"] = "sig"
_TEST_JWKS = {"keys": [_TEST_PUBLIC_JWK]}


class _FakeResponse:
    def __init__(self, status_code: int, body: dict | None = None) -> None:
        self.status_code = status_code
        self._body = body or {}

    def json(self) -> dict:
        return self._body


class _FakeClient:
    """Stand-in for ``httpx.AsyncClient`` — captures the single POST."""

    def __init__(self, response: _FakeResponse, *, error: Exception | None = None) -> None:
        self._response = response
        self._error = error
        self.calls: list[dict] = []
        self.init_kwargs: dict | None = None

    async def __aenter__(self) -> _FakeClient:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    async def post(self, url: str, *, json: dict, headers: dict) -> _FakeResponse:
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self._error is not None:
            raise self._error
        return self._response


def _run(coro):
    return asyncio.run(coro)


class ProviderTokenMintingTests(unittest.TestCase):
    def test_mint_produces_es256_token_with_expected_claims(self) -> None:
        token_str = mint_provider_token(
            team_id=_TEST_TEAM_ID,
            key_id=_TEST_KEY_ID,
            private_key_pem=_TEST_PRIVATE_PEM,
            now=1_700_000_000,
        )
        key_set = JsonWebKey.import_key_set(_TEST_JWKS)
        claims = jwt.decode(token_str, key=key_set)
        self.assertEqual(claims.header["kid"], _TEST_KEY_ID)
        self.assertEqual(claims["iss"], _TEST_TEAM_ID)
        self.assertEqual(claims["iat"], 1_700_000_000)
        self.assertNotIn("sub", claims)
        self.assertNotIn("aud", claims)
        self.assertNotIn("exp", claims)

    def test_cache_reuses_token_within_ttl(self) -> None:
        sender = ApnsSender()
        sign_calls = {"n": 0}
        real_mint = apns_mod.mint_provider_token

        def counting_mint(**kwargs):
            sign_calls["n"] += 1
            return real_mint(**kwargs)

        with patch.object(apns_mod, "mint_provider_token", side_effect=counting_mint):
            first = sender._get_provider_token(
                team_id=_TEST_TEAM_ID, key_id=_TEST_KEY_ID, private_key_pem=_TEST_PRIVATE_PEM
            )
            second = sender._get_provider_token(
                team_id=_TEST_TEAM_ID, key_id=_TEST_KEY_ID, private_key_pem=_TEST_PRIVATE_PEM
            )
        self.assertEqual(first, second)
        self.assertEqual(sign_calls["n"], 1)


class _EnvMixin(unittest.TestCase):
    def setUp(self) -> None:
        self._saved = {
            k: os.environ.get(k)
            for k in (
                APNS_TEAM_ID_ENV,
                APNS_KEY_ID_ENV,
                APNS_PRIVATE_KEY_ENV,
                APNS_BUNDLE_ID_ENV,
                APNS_ENVIRONMENT_ENV,
            )
        }
        os.environ[APNS_TEAM_ID_ENV] = _TEST_TEAM_ID
        os.environ[APNS_KEY_ID_ENV] = _TEST_KEY_ID
        os.environ[APNS_PRIVATE_KEY_ENV] = _TEST_PRIVATE_PEM
        os.environ[APNS_BUNDLE_ID_ENV] = "com.mgz-pkmn.test"
        os.environ.pop(APNS_ENVIRONMENT_ENV, None)

    def tearDown(self) -> None:
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class ApnsSenderSendTests(_EnvMixin):
    def test_send_returns_delivered_on_200(self) -> None:
        fake = _FakeClient(_FakeResponse(200))
        with patch.object(apns_mod.httpx, "AsyncClient", return_value=fake):
            result = _run(ApnsSender().send("tok-1", {"aps": {"alert": "hi"}}))
        self.assertTrue(result.delivered)
        self.assertFalse(result.invalid_token)
        call = fake.calls[0]
        self.assertEqual(call["url"], "/3/device/tok-1")
        self.assertEqual(call["json"], {"aps": {"alert": "hi"}})
        self.assertEqual(call["headers"]["apns-topic"], "com.mgz-pkmn.test")
        self.assertTrue(call["headers"]["authorization"].startswith("bearer "))

    def test_send_flags_invalid_token_on_410(self) -> None:
        fake = _FakeClient(_FakeResponse(410, {"reason": "Unregistered"}))
        with patch.object(apns_mod.httpx, "AsyncClient", return_value=fake):
            result = _run(ApnsSender().send("tok-1", {}))
        self.assertFalse(result.delivered)
        self.assertTrue(result.invalid_token)
        self.assertEqual(result.reason, "Unregistered")

    def test_send_does_not_flag_invalid_token_on_bad_device_token_reason(self) -> None:
        """``BadDeviceToken`` can mean a genuinely malformed token, but it can
        also mean a deploy misconfiguration (wrong topic/environment) — since
        that would be true for every token, not just this one, it must not
        trigger pruning (only unambiguous 410/``Unregistered`` does)."""
        fake = _FakeClient(_FakeResponse(400, {"reason": "BadDeviceToken"}))
        with patch.object(apns_mod.httpx, "AsyncClient", return_value=fake):
            result = _run(ApnsSender().send("tok-1", {}))
        self.assertFalse(result.delivered)
        self.assertFalse(result.invalid_token)

    def test_send_does_not_flag_invalid_token_on_wrong_topic_reason(self) -> None:
        fake = _FakeClient(_FakeResponse(400, {"reason": "DeviceTokenNotForTopic"}))
        with patch.object(apns_mod.httpx, "AsyncClient", return_value=fake):
            result = _run(ApnsSender().send("tok-1", {}))
        self.assertFalse(result.delivered)
        self.assertFalse(result.invalid_token)

    def test_send_does_not_flag_invalid_token_on_410_without_unregistered_reason(self) -> None:
        """A 410 with some other reason shouldn't happen per Apple's docs,
        but the check is intentionally conjunctive (status *and* reason) —
        confirms it doesn't fall back to matching on status code alone."""
        fake = _FakeClient(_FakeResponse(410, {"reason": "Something else"}))
        with patch.object(apns_mod.httpx, "AsyncClient", return_value=fake):
            result = _run(ApnsSender().send("tok-1", {}))
        self.assertFalse(result.invalid_token)

    def test_send_does_not_flag_invalid_token_on_other_rejection(self) -> None:
        fake = _FakeClient(_FakeResponse(400, {"reason": "PayloadTooLarge"}))
        with patch.object(apns_mod.httpx, "AsyncClient", return_value=fake):
            result = _run(ApnsSender().send("tok-1", {}))
        self.assertFalse(result.delivered)
        self.assertFalse(result.invalid_token)
        self.assertEqual(result.reason, "PayloadTooLarge")

    def test_send_skips_when_unconfigured(self) -> None:
        os.environ.pop(APNS_BUNDLE_ID_ENV, None)
        with patch.object(apns_mod.httpx, "AsyncClient") as client_cls:
            result = _run(ApnsSender().send("tok-1", {}))
        client_cls.assert_not_called()
        self.assertFalse(result.delivered)
        self.assertFalse(result.invalid_token)
        self.assertEqual(result.reason, "apns_not_configured")

    def test_sandbox_environment_targets_sandbox_host(self) -> None:
        os.environ[APNS_ENVIRONMENT_ENV] = "sandbox"
        fake = _FakeClient(_FakeResponse(200))
        captured_kwargs: dict = {}

        def _capture(*args, **kwargs):
            captured_kwargs.update(kwargs)
            return fake

        with patch.object(apns_mod.httpx, "AsyncClient", side_effect=_capture):
            _run(ApnsSender().send("tok-1", {}))
        self.assertEqual(captured_kwargs["base_url"], APNS_SANDBOX_URL)

    def test_production_is_the_default_environment(self) -> None:
        fake = _FakeClient(_FakeResponse(200))
        captured_kwargs: dict = {}

        def _capture(*args, **kwargs):
            captured_kwargs.update(kwargs)
            return fake

        with patch.object(apns_mod.httpx, "AsyncClient", side_effect=_capture):
            _run(ApnsSender().send("tok-1", {}))
        self.assertEqual(captured_kwargs["base_url"], APNS_PRODUCTION_URL)


if __name__ == "__main__":
    unittest.main()
