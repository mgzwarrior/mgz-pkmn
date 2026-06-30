"""Tests for the newsletter signup route (#821).

Covers:

- `POST /subscribe` 503s when the Resend env vars aren't set.
- Each of the three reasons → 202 + a Resend contact create with the reason
  stamped into `properties` (the Resend network call is patched at the
  `_create_resend_contact` seam — no real request).
- An unknown reason → 422 (our own form's contract, not user-enumerable).
- A Resend failure (non-2xx / network) surfaces as 502.
- CR/LF/whitespace in the email is normalized before it reaches Resend.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.main import app
from api.routes import subscribe as subscribe_mod
from api.routes.subscribe import RESEND_API_KEY_ENV, RESEND_AUDIENCE_ID_ENV

SUBSCRIBE_URL = "/api/v1/subscribe"


class SubscribeApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self._saved_env = {
            k: os.environ.get(k) for k in (RESEND_API_KEY_ENV, RESEND_AUDIENCE_ID_ENV)
        }
        os.environ[RESEND_API_KEY_ENV] = "re_test_key"
        os.environ[RESEND_AUDIENCE_ID_ENV] = "aud_123"

    def tearDown(self) -> None:
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_missing_config_returns_503(self) -> None:
        os.environ.pop(RESEND_API_KEY_ENV, None)
        resp = self.client.post(SUBSCRIBE_URL, json={"email": "a@b.com", "reason": "collector"})
        self.assertEqual(resp.status_code, 503)

    def test_each_reason_creates_a_resend_contact(self) -> None:
        for reason in ("collector", "show", "builder"):
            with self.subTest(reason=reason):
                with patch.object(
                    subscribe_mod, "_create_resend_contact", new=AsyncMock()
                ) as mock_create:
                    resp = self.client.post(
                        SUBSCRIBE_URL, json={"email": "fan@example.com", "reason": reason}
                    )
                self.assertEqual(resp.status_code, 202)
                self.assertEqual(resp.content, b"")
                mock_create.assert_awaited_once()
                # Positional args: (api_key, audience_id, email, reason)
                args = mock_create.await_args.args
                self.assertEqual(args[0], "re_test_key")
                self.assertEqual(args[1], "aud_123")
                self.assertEqual(args[2], "fan@example.com")
                self.assertEqual(args[3], reason)

    def test_unknown_reason_is_rejected(self) -> None:
        resp = self.client.post(SUBSCRIBE_URL, json={"email": "a@b.com", "reason": "tourist"})
        self.assertEqual(resp.status_code, 422)

    def test_email_is_normalized_before_resend(self) -> None:
        with patch.object(subscribe_mod, "_create_resend_contact", new=AsyncMock()) as mock_create:
            resp = self.client.post(
                SUBSCRIBE_URL,
                json={"email": "  fan@example.com\r\n", "reason": "collector"},
            )
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(mock_create.await_args.args[2], "fan@example.com")

    def test_resend_failure_surfaces_as_502(self) -> None:
        # Drive the real seam, but make the Resend HTTP POST fail. The seam maps
        # any httpx error to a 502 the form can show a retry hint for.
        class _BoomClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, *args, **kwargs):
                raise httpx.ConnectError("resend unreachable")

        with patch.object(subscribe_mod.httpx, "AsyncClient", return_value=_BoomClient()):
            resp = self.client.post(SUBSCRIBE_URL, json={"email": "a@b.com", "reason": "collector"})
        self.assertEqual(resp.status_code, 502)

    def test_seam_sends_expected_resend_payload(self) -> None:
        # Verify the seam itself builds the Resend request correctly: URL,
        # bearer header, and the reason stamped into `properties`.
        captured: dict = {}

        class _CaptureResp:
            def raise_for_status(self) -> None:
                return None

        class _CaptureClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, headers=None, json=None):
                captured["url"] = url
                captured["headers"] = headers
                captured["json"] = json
                return _CaptureResp()

        async def run() -> None:
            with patch.object(subscribe_mod.httpx, "AsyncClient", return_value=_CaptureClient()):
                await subscribe_mod._create_resend_contact("re_k", "aud_9", "x@y.com", "builder")

        import asyncio

        asyncio.run(run())
        self.assertEqual(captured["url"], "https://api.resend.com/audiences/aud_9/contacts")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer re_k")
        self.assertEqual(captured["json"]["email"], "x@y.com")
        self.assertFalse(captured["json"]["unsubscribed"])
        self.assertEqual(captured["json"]["properties"], {"reason": "builder"})

    def test_create_seam_maps_non_2xx_to_http_exception(self) -> None:
        class _ErrResp:
            def raise_for_status(self) -> None:
                raise httpx.HTTPStatusError(
                    "bad", request=httpx.Request("POST", "http://x"), response=httpx.Response(422)
                )

        class _ErrClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, *a, **k):
                return _ErrResp()

        async def run() -> None:
            with patch.object(subscribe_mod.httpx, "AsyncClient", return_value=_ErrClient()):
                await subscribe_mod._create_resend_contact("k", "a", "x@y.com", "show")

        import asyncio

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(run())
        self.assertEqual(ctx.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
