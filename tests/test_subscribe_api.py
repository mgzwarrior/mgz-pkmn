"""Tests for the newsletter signup route (#821, #826).

Covers:

- `POST /subscribe` 503s when the Resend env vars aren't set.
- Each of the three reasons → 202 + a Resend contact create (reason in
  `properties`) *and* a `New Signup` event (reason in `payload`), both patched
  at their seams — no real request.
- An unknown reason → 422 (our own form's contract, not user-enumerable).
- A Resend failure on either call (non-2xx / network) surfaces as 502.
- CR/LF/whitespace in the email is normalized before it reaches Resend.
- The contact seam and the event seam each build the request Resend expects.
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
from api.routes.subscribe import (
    RESEND_API_KEY_ENV,
    RESEND_AUDIENCE_ID_ENV,
    RESEND_SIGNUP_EVENT,
)

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

    def test_each_reason_creates_contact_and_fires_event(self) -> None:
        for reason in ("collector", "show", "builder"):
            with self.subTest(reason=reason):
                with (
                    patch.object(
                        subscribe_mod, "_create_resend_contact", new=AsyncMock()
                    ) as mock_contact,
                    patch.object(
                        subscribe_mod, "_send_resend_event", new=AsyncMock()
                    ) as mock_event,
                ):
                    resp = self.client.post(
                        SUBSCRIBE_URL, json={"email": "fan@example.com", "reason": reason}
                    )
                self.assertEqual(resp.status_code, 202)
                self.assertEqual(resp.content, b"")
                # Contact create: (api_key, audience_id, email, reason)
                mock_contact.assert_awaited_once()
                contact_args = mock_contact.await_args.args
                self.assertEqual(contact_args[0], "re_test_key")
                self.assertEqual(contact_args[1], "aud_123")
                self.assertEqual(contact_args[2], "fan@example.com")
                self.assertEqual(contact_args[3], reason)
                # Event send: (api_key, email, reason)
                mock_event.assert_awaited_once()
                event_args = mock_event.await_args.args
                self.assertEqual(event_args[0], "re_test_key")
                self.assertEqual(event_args[1], "fan@example.com")
                self.assertEqual(event_args[2], reason)

    def test_unknown_reason_is_rejected(self) -> None:
        resp = self.client.post(SUBSCRIBE_URL, json={"email": "a@b.com", "reason": "tourist"})
        self.assertEqual(resp.status_code, 422)

    def test_email_is_normalized_before_resend(self) -> None:
        with (
            patch.object(subscribe_mod, "_create_resend_contact", new=AsyncMock()) as mock_contact,
            patch.object(subscribe_mod, "_send_resend_event", new=AsyncMock()) as mock_event,
        ):
            resp = self.client.post(
                SUBSCRIBE_URL,
                json={"email": "  fan@example.com\r\n", "reason": "collector"},
            )
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(mock_contact.await_args.args[2], "fan@example.com")
        self.assertEqual(mock_event.await_args.args[1], "fan@example.com")

    def test_contact_failure_surfaces_as_502(self) -> None:
        # Drive the real seams, but make the first Resend POST (contact create)
        # fail. Any httpx error becomes a 502 the form can show a retry hint for.
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

    def test_event_failure_surfaces_as_502(self) -> None:
        # Contact create succeeds; the event send fails. The route must still
        # 502 — a contact with no drip is a failed signup from the form's view.
        class _BoomClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, *args, **kwargs):
                raise httpx.ConnectError("resend unreachable")

        with (
            patch.object(subscribe_mod, "_create_resend_contact", new=AsyncMock()),
            patch.object(subscribe_mod.httpx, "AsyncClient", return_value=_BoomClient()),
        ):
            resp = self.client.post(SUBSCRIBE_URL, json={"email": "a@b.com", "reason": "collector"})
        self.assertEqual(resp.status_code, 502)

    def test_contact_seam_sends_expected_resend_payload(self) -> None:
        # Verify the contact seam builds the Resend request correctly: URL,
        # bearer header, and the reason stamped into `properties`.
        captured = self._capture_resend_post(
            lambda: subscribe_mod._create_resend_contact("re_k", "aud_9", "x@y.com", "builder")
        )
        self.assertEqual(captured["url"], "https://api.resend.com/audiences/aud_9/contacts")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer re_k")
        self.assertEqual(captured["json"]["email"], "x@y.com")
        self.assertFalse(captured["json"]["unsubscribed"])
        self.assertEqual(captured["json"]["properties"], {"reason": "builder"})

    def test_event_seam_sends_expected_resend_payload(self) -> None:
        # Verify the event seam builds the Resend request correctly: URL, bearer
        # header, the trigger event name, and the reason carried in `payload`.
        captured = self._capture_resend_post(
            lambda: subscribe_mod._send_resend_event("re_k", "x@y.com", "show")
        )
        self.assertEqual(captured["url"], "https://api.resend.com/events/send")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer re_k")
        self.assertEqual(captured["json"]["event"], RESEND_SIGNUP_EVENT)
        self.assertEqual(captured["json"]["email"], "x@y.com")
        self.assertEqual(captured["json"]["payload"], {"reason": "show"})

    def test_resend_post_maps_non_2xx_to_http_exception(self) -> None:
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
                await subscribe_mod._resend_post("k", "http://x", {}, action="contact create")

        import asyncio

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(run())
        self.assertEqual(ctx.exception.status_code, 502)

    @staticmethod
    def _capture_resend_post(call) -> dict:
        """Run an awaitable-returning ``call`` with httpx patched to capture the
        single Resend POST it issues, returning the captured url/headers/json."""
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
                await call()

        import asyncio

        asyncio.run(run())
        return captured


if __name__ == "__main__":
    unittest.main()
