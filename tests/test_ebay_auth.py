"""Tests for the eBay OAuth client-credentials auth client (#421).

Covers the acceptance contract: ``get_token()`` returns a valid token and
refreshes on expiry, the static-token escape hatch short-circuits minting,
``force_refresh`` (the on-401 retry seam) re-mints, missing creds raise, and
the production / sandbox token hosts are selected correctly.
"""

from __future__ import annotations

import base64
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.sources.ebay import (
    _PROD_TOKEN_URL,
    _SANDBOX_TOKEN_URL,
    EbayAuthClient,
    EbayAuthError,
)


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"status {self.status_code}")

    def json(self) -> dict:
        return self._payload


class StaticTokenTests(unittest.TestCase):
    def test_static_token_short_circuits_minting(self) -> None:
        client = EbayAuthClient(static_token="STATIC-123")
        with patch.object(client.session, "post") as post:
            self.assertEqual(client.get_token(), "STATIC-123")
            self.assertEqual(client.get_token(force_refresh=True), "STATIC-123")
            post.assert_not_called()


class MintAndCacheTests(unittest.TestCase):
    def _client(self) -> EbayAuthClient:
        return EbayAuthClient(client_id="id", client_secret="secret")

    def test_first_call_mints_and_sends_basic_auth(self) -> None:
        client = self._client()
        with patch.object(
            client.session,
            "post",
            return_value=_FakeResponse({"access_token": "TKN", "expires_in": 7200}),
        ) as post:
            self.assertEqual(client.get_token(), "TKN")
            post.assert_called_once()
            _, kwargs = post.call_args
            expected = base64.b64encode(b"id:secret").decode("ascii")
            self.assertEqual(kwargs["headers"]["Authorization"], f"Basic {expected}")
            self.assertEqual(kwargs["data"]["grant_type"], "client_credentials")

    def test_cached_token_reused_within_window(self) -> None:
        client = self._client()
        with patch.object(
            client.session,
            "post",
            return_value=_FakeResponse({"access_token": "TKN", "expires_in": 7200}),
        ) as post:
            client.get_token()
            client.get_token()
            post.assert_called_once()  # second call served from cache

    def test_expiry_triggers_remint(self) -> None:
        client = self._client()
        responses = [
            _FakeResponse({"access_token": "FIRST", "expires_in": 7200}),
            _FakeResponse({"access_token": "SECOND", "expires_in": 7200}),
        ]
        with (
            patch.object(client.session, "post", side_effect=responses),
            patch("mgz_pkmn.sources.ebay.time.time") as now,
        ):
            now.return_value = 1000.0  # first mint
            self.assertEqual(client.get_token(), "FIRST")
            now.return_value = 1000.0 + 7200 + 10  # well past expiry → re-mint
            self.assertEqual(client.get_token(), "SECOND")

    def test_force_refresh_remints(self) -> None:
        client = self._client()
        responses = [
            _FakeResponse({"access_token": "FIRST", "expires_in": 7200}),
            _FakeResponse({"access_token": "SECOND", "expires_in": 7200}),
        ]
        with patch.object(client.session, "post", side_effect=responses):
            self.assertEqual(client.get_token(), "FIRST")
            # On-401 retry seam: force a re-mint even though the cache is warm.
            self.assertEqual(client.get_token(force_refresh=True), "SECOND")

    def test_missing_expires_in_falls_back_to_default(self) -> None:
        client = self._client()
        # A re-mint should not be triggered immediately if the default
        # lifetime was applied — second call serves from cache.
        with (
            patch.object(
                client.session, "post", return_value=_FakeResponse({"access_token": "TKN"})
            ),
            patch.object(client, "_mint", wraps=client._mint) as mint,
        ):
            client.get_token()
            client.get_token()
            mint.assert_called_once()


class ConfigTests(unittest.TestCase):
    def test_missing_credentials_raise(self) -> None:
        client = EbayAuthClient(client_id="", client_secret="", static_token="")
        with self.assertRaises(EbayAuthError):
            client.get_token()

    def test_configured_reflects_available_credentials(self) -> None:
        def _client(**kw) -> EbayAuthClient:
            kw.setdefault("client_id", "")
            kw.setdefault("client_secret", "")
            kw.setdefault("static_token", "")
            return EbayAuthClient(**kw)

        self.assertFalse(_client().configured)
        self.assertFalse(_client(client_id="id").configured)  # secret still missing
        self.assertTrue(_client(client_id="id", client_secret="secret").configured)
        self.assertTrue(_client(static_token="STATIC").configured)

    def test_token_response_without_access_token_raises(self) -> None:
        client = EbayAuthClient(client_id="id", client_secret="secret")
        with (
            patch.object(client.session, "post", return_value=_FakeResponse({"expires_in": 7200})),
            self.assertRaises(EbayAuthError),
        ):
            client.get_token()

    def test_request_failure_wrapped_in_ebay_auth_error(self) -> None:
        client = EbayAuthClient(client_id="id", client_secret="secret")
        with (
            patch.object(client.session, "post", side_effect=requests.ConnectionError("boom")),
            self.assertRaises(EbayAuthError),
        ):
            client.get_token()

    def test_production_is_default_token_url(self) -> None:
        self.assertEqual(
            EbayAuthClient(client_id="id", client_secret="s").token_url, _PROD_TOKEN_URL
        )

    def test_sandbox_environment_selects_sandbox_url(self) -> None:
        client = EbayAuthClient(client_id="id", client_secret="s", environment="sandbox")
        self.assertEqual(client.token_url, _SANDBOX_TOKEN_URL)

    def test_unknown_environment_falls_back_to_production(self) -> None:
        client = EbayAuthClient(client_id="id", client_secret="s", environment="staging")
        self.assertEqual(client.environment, "production")


if __name__ == "__main__":
    unittest.main()
