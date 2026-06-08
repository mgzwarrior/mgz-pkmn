"""Tests for the Discord OAuth sign-in slice (#517)."""

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

from api.auth.discord import (
    DISCORD_CLIENT_ID_ENV,
    DISCORD_CLIENT_SECRET_ENV,
    DiscordProfile,
)
from api.auth.session import AUTH_ENABLED_ENV, SESSION_SECRET_ENV
from api.db import session as session_mod
from api.db.models import PROVIDER_DISCORD, User, UserIdentity


class _IsolatedDbMixin(unittest.TestCase):
    """Fresh sqlite + env reset per test, matching the auth test pattern."""

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
                DISCORD_CLIENT_ID_ENV,
                DISCORD_CLIENT_SECRET_ENV,
                "MGZ_PKMN_ENV",
            )
        }
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        os.environ[SESSION_SECRET_ENV] = "unit-test-secret-do-not-care"
        os.environ.pop(AUTH_ENABLED_ENV, None)
        os.environ.pop(DISCORD_CLIENT_ID_ENV, None)
        os.environ.pop(DISCORD_CLIENT_SECRET_ENV, None)
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
            r = client.get("/api/v1/auth/discord/login", follow_redirects=False)
            self.assertEqual(r.status_code, 404)
            self.assertEqual(r.json(), {"detail": "Not Found"})

    def test_login_returns_503_when_env_vars_missing(self) -> None:
        os.environ[AUTH_ENABLED_ENV] = "1"
        from api.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/auth/discord/login", follow_redirects=False)
            self.assertEqual(r.status_code, 503)
            self.assertIn("Discord OAuth not configured", r.json().get("detail", ""))


class CallbackErrorTests(_IsolatedDbMixin):
    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[DISCORD_CLIENT_ID_ENV] = "test-client-id"
        os.environ[DISCORD_CLIENT_SECRET_ENV] = "test-client-secret"

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
                "/api/v1/auth/discord/callback?code=abc&state=tampered",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "oauth_failed")

    def test_callback_no_verified_email_returns_400(self) -> None:
        from api.main import app

        token = {"access_token": "test-token", "token_type": "bearer"}
        no_email_profile = DiscordProfile(
            user_id="1234567890",
            username="alice",
            global_name="Alice",
            verified_email=None,
        )

        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                new=AsyncMock(return_value=token),
            ),
            patch(
                "api.auth.discord.fetch_discord_profile",
                new=AsyncMock(return_value=no_email_profile),
            ),
            TestClient(app) as client,
        ):
            r = client.get(
                "/api/v1/auth/discord/callback?code=abc&state=anything",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "no_verified_email")

    def test_callback_empty_user_id_returns_400(self) -> None:
        from api.main import app

        token = {"access_token": "test-token", "token_type": "bearer"}
        no_id_profile = DiscordProfile(
            user_id="",
            username="anon",
            global_name=None,
            verified_email="anon@example.com",
        )

        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                new=AsyncMock(return_value=token),
            ),
            patch(
                "api.auth.discord.fetch_discord_profile",
                new=AsyncMock(return_value=no_id_profile),
            ),
            TestClient(app) as client,
        ):
            r = client.get(
                "/api/v1/auth/discord/callback?code=abc&state=anything",
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["detail"], "no_discord_user_id")


class CallbackHappyPathTests(_IsolatedDbMixin):
    def setUp(self) -> None:
        super().setUp()
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[DISCORD_CLIENT_ID_ENV] = "test-client-id"
        os.environ[DISCORD_CLIENT_SECRET_ENV] = "test-client-secret"

    def _drive_callback(
        self,
        client: TestClient,
        profile: DiscordProfile,
    ) -> tuple[int, str | None]:
        token = {"access_token": "test-token", "token_type": "bearer"}
        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                new=AsyncMock(return_value=token),
            ),
            patch(
                "api.auth.discord.fetch_discord_profile",
                new=AsyncMock(return_value=profile),
            ),
        ):
            r = client.get(
                "/api/v1/auth/discord/callback?code=abc&state=anything",
                follow_redirects=False,
            )
            return r.status_code, r.headers.get("location")

    def test_fresh_signup_creates_user_identity_and_redirects_to_root(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            status, location = self._drive_callback(
                client,
                DiscordProfile(
                    user_id="111122223333444455",
                    username="alice",
                    global_name="Alice Liddell",
                    verified_email="alice@example.com",
                ),
            )
            self.assertEqual(status, 302)
            self.assertEqual(location, "/")
            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == "alice@example.com"))
                assert user is not None
                self.assertEqual(user.name, "discord:111122223333444455")
                self.assertEqual(user.display_name, "Alice Liddell")
                self.assertIsNotNone(user.email_verified_at)
                identity = s.scalar(select(UserIdentity).where(UserIdentity.user_id == user.id))
                assert identity is not None
                self.assertEqual(identity.provider, PROVIDER_DISCORD)
                self.assertEqual(identity.provider_subject, "111122223333444455")

    def test_callback_issues_session_cookie_that_authenticates_subsequent_me(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            status, _ = self._drive_callback(
                client,
                DiscordProfile(
                    user_id="444455556666777788",
                    username="dani",
                    global_name="Dani Reyes",
                    verified_email="dani@example.com",
                ),
            )
            self.assertEqual(status, 302)
            me = client.get("/api/v1/me")
            self.assertEqual(me.status_code, 200)
            payload = me.json()["user"]
            self.assertEqual(payload["email"], "dani@example.com")
            self.assertEqual(payload["display_name"], "Dani Reyes")
            self.assertEqual(payload["identities"][0]["provider"], PROVIDER_DISCORD)

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

            status, location = self._drive_callback(
                client,
                DiscordProfile(
                    user_id="777788889999000011",
                    username="bobby",
                    global_name="Robert Builder",
                    verified_email="bob@example.com",
                ),
            )
            self.assertEqual(status, 302)
            self.assertEqual(location, "/")
            with session_mod.get_session_factory()() as s:
                user = s.get(User, existing_id)
                assert user is not None
                self.assertEqual(user.display_name, "bob-the-builder")
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
                DiscordProfile(
                    user_id="222233334444555566",
                    username="carol",
                    global_name=None,
                    verified_email="carol@example.com",
                ),
            )
            self.assertEqual(status, 302)
            with session_mod.get_session_factory()() as s:
                user = s.get(User, existing_id)
                assert user is not None
                self.assertEqual(user.display_name, "carol")


if __name__ == "__main__":
    unittest.main()
