"""Tests for the eBay marketplace account-deletion endpoint.

Covers eBay's step-7 contract: the challenge-code GET returns the SHA-256 of
``challengeCode + verificationToken + endpoint`` (exact order), a
half-configured deploy returns 503, and the closure-notification POST
acknowledges with 200.
"""

from __future__ import annotations

import hashlib
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from api.routes.ebay import DELETION_ENDPOINT_ENV, VERIFICATION_TOKEN_ENV

_TOKEN = "verification-token-abcdefghijklmnop1234"
_ENDPOINT = "https://mgz-pkmn.onrender.com/api/v1/ebay/account-deletion"


class _EnvMixin(unittest.TestCase):
    """Save/restore eBay + automigrate env around each test."""

    def setUp(self) -> None:
        self._saved = {
            k: os.environ.get(k)
            for k in (VERIFICATION_TOKEN_ENV, DELETION_ENDPOINT_ENV, "MGZ_PKMN_AUTOMIGRATE")
        }
        # The endpoint touches no DB; skip startup migrations so the
        # TestClient lifespan doesn't need a configured database.
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"
        os.environ.pop(VERIFICATION_TOKEN_ENV, None)
        os.environ.pop(DELETION_ENDPOINT_ENV, None)

    def tearDown(self) -> None:
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class ChallengeTests(_EnvMixin):
    def test_challenge_returns_expected_hash(self) -> None:
        os.environ[VERIFICATION_TOKEN_ENV] = _TOKEN
        os.environ[DELETION_ENDPOINT_ENV] = _ENDPOINT
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/ebay/account-deletion?challenge_code=abc123")
        self.assertEqual(r.status_code, 200)
        expected = hashlib.sha256(("abc123" + _TOKEN + _ENDPOINT).encode("utf-8")).hexdigest()
        self.assertEqual(r.json(), {"challengeResponse": expected})

    def test_missing_config_returns_503(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/ebay/account-deletion?challenge_code=abc123")
        self.assertEqual(r.status_code, 503)

    def test_missing_challenge_code_returns_422(self) -> None:
        os.environ[VERIFICATION_TOKEN_ENV] = _TOKEN
        os.environ[DELETION_ENDPOINT_ENV] = _ENDPOINT
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/ebay/account-deletion")
        self.assertEqual(r.status_code, 422)


class NotificationTests(_EnvMixin):
    def test_post_acknowledges_with_200(self) -> None:
        from api.main import app

        payload = {
            "metadata": {"notificationId": "n-1"},
            "notification": {"data": {"username": "someuser", "userId": "abc"}},
        }
        with TestClient(app) as client:
            r = client.post("/api/v1/ebay/account-deletion", json=payload)
        self.assertEqual(r.status_code, 200)

    def test_post_with_malformed_body_still_acknowledges(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            r = client.post(
                "/api/v1/ebay/account-deletion",
                content=b"not json",
                headers={"Content-Type": "application/json"},
            )
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
