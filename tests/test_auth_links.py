"""Tests for #491 slice 2: explicit provider link / unlink endpoints."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient
from sqlalchemy import select

from api.auth.discord import DISCORD_CLIENT_ID_ENV, DISCORD_CLIENT_SECRET_ENV, DiscordProfile
from api.auth.github import (
    GITHUB_CLIENT_ID_ENV,
    GITHUB_CLIENT_SECRET_ENV,
    GitHubProfile,
)
from api.auth.google import GOOGLE_CLIENT_ID_ENV, GOOGLE_CLIENT_SECRET_ENV
from api.auth.magic import (
    SENDER_ENV,
    SMTP_HOST_ENV,
    SMTP_PASSWORD_ENV,
    SMTP_PORT_ENV,
    SMTP_USERNAME_ENV,
    sign_token,
)
from api.auth.session import AUTH_ENABLED_ENV, SESSION_SECRET_ENV
from api.db import session as session_mod
from api.db.models import PROVIDER_DISCORD, PROVIDER_GITHUB, PROVIDER_MAGIC, User, UserIdentity


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
                GITHUB_CLIENT_ID_ENV,
                GITHUB_CLIENT_SECRET_ENV,
                GOOGLE_CLIENT_ID_ENV,
                GOOGLE_CLIENT_SECRET_ENV,
                DISCORD_CLIENT_ID_ENV,
                DISCORD_CLIENT_SECRET_ENV,
                SMTP_HOST_ENV,
                SMTP_PORT_ENV,
                SMTP_USERNAME_ENV,
                SMTP_PASSWORD_ENV,
                SENDER_ENV,
                "MGZ_PKMN_ENV",
            )
        }
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[SESSION_SECRET_ENV] = "unit-test-secret-do-not-care"
        os.environ[GITHUB_CLIENT_ID_ENV] = "test-client-id"
        os.environ[GITHUB_CLIENT_SECRET_ENV] = "test-client-secret"
        os.environ[GOOGLE_CLIENT_ID_ENV] = "test-google-client-id"
        os.environ[GOOGLE_CLIENT_SECRET_ENV] = "test-google-client-secret"
        os.environ[DISCORD_CLIENT_ID_ENV] = "test-discord-client-id"
        os.environ[DISCORD_CLIENT_SECRET_ENV] = "test-discord-client-secret"
        os.environ[SMTP_HOST_ENV] = "smtp.test.local"
        os.environ[SMTP_PORT_ENV] = "587"
        os.environ[SMTP_USERNAME_ENV] = "test-user"
        os.environ[SMTP_PASSWORD_ENV] = "test-pass"
        os.environ[SENDER_ENV] = "noreply@example.com"
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()


def _sign_in_magic(client: TestClient, email: str) -> int:
    """Drive the real magic callback so the TestClient has a session cookie."""
    r = client.get(
        f"/api/v1/auth/magic/callback?token={sign_token(email)}",
        follow_redirects=False,
    )
    assert r.status_code == 302
    with session_mod.get_session_factory()() as s:
        user = s.scalar(select(User).where(User.email == email))
        assert user is not None
        return user.id


class LinkStartTests(_IsolatedDbMixin):
    def test_oauth_link_start_requires_signed_in_user(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            r = client.post("/api/v1/auth/link/github/start", follow_redirects=False)
            self.assertEqual(r.status_code, 401)
            self.assertEqual(r.json()["detail"], "sign-in required")

    def test_oauth_link_start_redirects_to_provider_when_signed_in(self) -> None:
        from api.main import app

        with (
            patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_redirect",
                new=AsyncMock(return_value=RedirectResponse("https://github.example/auth")),
            ) as authorize_redirect,
            TestClient(app) as client,
        ):
            _sign_in_magic(client, "primary@example.com")
            r = client.post("/api/v1/auth/link/github/start", follow_redirects=False)

        self.assertEqual(r.status_code, 307)
        self.assertEqual(r.headers["location"], "https://github.example/auth")
        self.assertEqual(authorize_redirect.await_count, 1)


class OAuthLinkCallbackTests(_IsolatedDbMixin):
    def test_github_link_callback_attaches_mismatched_email_to_current_user(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            user_id = _sign_in_magic(client, "primary@example.com")
            with patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_redirect",
                new=AsyncMock(return_value=RedirectResponse("https://github.example/auth")),
            ):
                start = client.post("/api/v1/auth/link/github/start", follow_redirects=False)
            self.assertEqual(start.status_code, 307)

            with (
                patch(
                    "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                    new=AsyncMock(return_value={"access_token": "test-token"}),
                ),
                patch(
                    "api.auth.github.fetch_github_profile",
                    new=AsyncMock(
                        return_value=GitHubProfile(
                            login="workhub",
                            name="Work Hub",
                            verified_primary_email="work@example.com",
                        )
                    ),
                ),
            ):
                r = client.get(
                    "/api/v1/auth/link/github/callback?code=abc&state=anything",
                    follow_redirects=False,
                )
            me = client.get("/api/v1/me")

        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["location"], "/account")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(
            sorted(i["provider"] for i in me.json()["user"]["identities"]),
            [PROVIDER_GITHUB, PROVIDER_MAGIC],
        )
        with session_mod.get_session_factory()() as s:
            user = s.get(User, user_id)
            assert user is not None
            self.assertEqual(user.email, "primary@example.com")
            identities = sorted((i.provider, i.provider_subject, i.email) for i in user.identities)
            self.assertEqual(
                identities,
                [
                    (PROVIDER_GITHUB, "workhub", "work@example.com"),
                    (PROVIDER_MAGIC, "primary@example.com", "primary@example.com"),
                ],
            )

    def test_discord_link_callback_attaches_mismatched_email_to_current_user(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            user_id = _sign_in_magic(client, "primary@example.com")
            with patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_redirect",
                new=AsyncMock(return_value=RedirectResponse("https://discord.example/auth")),
            ):
                start = client.post("/api/v1/auth/link/discord/start", follow_redirects=False)
            self.assertEqual(start.status_code, 307)

            with (
                patch(
                    "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                    new=AsyncMock(return_value={"access_token": "test-token"}),
                ),
                patch(
                    "api.auth.discord.fetch_discord_profile",
                    new=AsyncMock(
                        return_value=DiscordProfile(
                            user_id="123456789012345678",
                            username="communityhub",
                            global_name="Community Hub",
                            verified_email="discord@example.com",
                        )
                    ),
                ),
            ):
                r = client.get(
                    "/api/v1/auth/link/discord/callback?code=abc&state=anything",
                    follow_redirects=False,
                )

        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["location"], "/account")
        with session_mod.get_session_factory()() as s:
            user = s.get(User, user_id)
            assert user is not None
            identities = sorted((i.provider, i.provider_subject, i.email) for i in user.identities)
            self.assertEqual(
                identities,
                [
                    (PROVIDER_DISCORD, "123456789012345678", "discord@example.com"),
                    (PROVIDER_MAGIC, "primary@example.com", "primary@example.com"),
                ],
            )

    def test_link_callback_conflicts_when_provider_identity_belongs_to_other_user(
        self,
    ) -> None:
        from api.main import app

        with TestClient(app) as client:
            _sign_in_magic(client, "primary@example.com")
            with session_mod.get_session_factory()() as s:
                other = User(
                    name="gh:taken",
                    email="taken@example.com",
                    email_verified_at=datetime.now(UTC),
                    display_name="Taken",
                )
                s.add(other)
                s.flush()
                s.add(
                    UserIdentity(
                        user_id=other.id,
                        provider=PROVIDER_GITHUB,
                        provider_subject="taken",
                        email="taken@example.com",
                    )
                )
                s.commit()

            with patch(
                "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_redirect",
                new=AsyncMock(return_value=RedirectResponse("https://github.example/auth")),
            ):
                start = client.post("/api/v1/auth/link/github/start", follow_redirects=False)
            self.assertEqual(start.status_code, 307)

            with (
                patch(
                    "authlib.integrations.starlette_client.StarletteOAuth2App.authorize_access_token",
                    new=AsyncMock(return_value={"access_token": "test-token"}),
                ),
                patch(
                    "api.auth.github.fetch_github_profile",
                    new=AsyncMock(
                        return_value=GitHubProfile(
                            login="taken",
                            name="Taken Elsewhere",
                            verified_primary_email="elsewhere@example.com",
                        )
                    ),
                ),
            ):
                r = client.get(
                    "/api/v1/auth/link/github/callback?code=abc&state=anything",
                    follow_redirects=False,
                )

        # Round-trips back into the Account modal with a recoverable error
        # instead of a JSON 409 — the AccountPanel reads link_error +
        # provider from the URL on first render (see #536).
        self.assertEqual(r.status_code, 302)
        self.assertEqual(
            r.headers["location"],
            f"/account?link_error=identity_already_linked&provider={PROVIDER_GITHUB}",
        )


class MagicLinkCallbackTests(_IsolatedDbMixin):
    def test_magic_link_callback_can_attach_second_email_to_current_user(self) -> None:
        from api.main import app

        sent_to: list[str] = []

        def record_send(self_mailer, message) -> None:
            sent_to.append(message["To"])

        with (
            patch("api.auth.magic.SmtpMailer.send", new=record_send),
            TestClient(app) as client,
        ):
            user_id = _sign_in_magic(client, "primary@example.com")
            start = client.post(
                "/api/v1/auth/link/magic/start",
                json={"email": "alias@example.com"},
            )
            self.assertEqual(start.status_code, 202)
            self.assertEqual(sent_to, ["alias@example.com"])
            r = client.get(
                f"/api/v1/auth/link/magic/callback?token={sign_token('alias@example.com')}",
                follow_redirects=False,
            )

        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["location"], "/account")
        with session_mod.get_session_factory()() as s:
            user = s.get(User, user_id)
            assert user is not None
            identities = sorted((i.provider, i.provider_subject, i.email) for i in user.identities)
            self.assertEqual(
                identities,
                [
                    (PROVIDER_MAGIC, "alias@example.com", "alias@example.com"),
                    (PROVIDER_MAGIC, "primary@example.com", "primary@example.com"),
                ],
            )


class UnlinkTests(_IsolatedDbMixin):
    def test_unlink_removes_non_last_identity_and_rejects_last_identity(self) -> None:
        from api.main import app

        with TestClient(app) as client:
            _sign_in_magic(client, "primary@example.com")
            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == "primary@example.com"))
                assert user is not None
                s.add(
                    UserIdentity(
                        user_id=user.id,
                        provider=PROVIDER_GITHUB,
                        provider_subject="primaryhub",
                        email="primary@example.com",
                    )
                )
                s.commit()

            with session_mod.get_session_factory()() as s:
                user = s.scalar(select(User).where(User.email == "primary@example.com"))
                assert user is not None
                github_identity = next(i for i in user.identities if i.provider == PROVIDER_GITHUB)
                magic_identity = next(i for i in user.identities if i.provider == PROVIDER_MAGIC)
                github_id = github_identity.id
                magic_id = magic_identity.id

            removed = client.delete(f"/api/v1/auth/identities/{github_id}")
            self.assertEqual(removed.status_code, 204)

            last = client.delete(f"/api/v1/auth/identities/{magic_id}")
            self.assertEqual(last.status_code, 400)
            self.assertEqual(last.json()["detail"], "cannot_unlink_last_identity")


if __name__ == "__main__":
    unittest.main()
