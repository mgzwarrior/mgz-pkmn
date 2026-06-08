"""Discord OAuth sign-in for the hosted-demo auth surface.

Follow-up provider for the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61)
auth epic, per
[ADR-0019](../../docs/adr/0019-hosted-demo-identity-and-auth.md).
Mirrors the GitHub / Google provider shape: Authlib owns the OAuth
state + code exchange, the callback fetches the Discord profile from
``/users/@me``, and ``resolve_or_link_identity`` owns the account-merge
contract.

Discord returns the email claim from ``/users/@me`` only when the
``email`` scope is granted, and consumers must check ``verified`` before
trusting it as an account-merge anchor. We request only ``identify`` and
``email``; no guild, posting, or bot scopes are involved.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Annotated

from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from ..db.models import PROVIDER_DISCORD
from .identity import IdentityConflictError, link_identity_to_user, resolve_or_link_identity
from .linking import (
    POST_LINK_REDIRECT,
    consume_link_request,
    identity_conflict_detail,
    stage_link_request,
)
from .session import CurrentUserRequired, DbSession, auth_enabled

_log = logging.getLogger(__name__)

DISCORD_CLIENT_ID_ENV = "MGZ_PKMN_DISCORD_CLIENT_ID"
DISCORD_CLIENT_SECRET_ENV = "MGZ_PKMN_DISCORD_CLIENT_SECRET"

DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
DISCORD_ACCESS_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_API_BASE_URL = "https://discord.com/api/"

POST_SIGNIN_REDIRECT = "/"

router = APIRouter()


@dataclass(frozen=True, slots=True)
class DiscordProfile:
    """Normalized view of the Discord user payload we care about."""

    user_id: str
    username: str | None
    global_name: str | None
    verified_email: str | None

    @property
    def display_name(self) -> str | None:
        return self.global_name or self.username


def _oauth_client() -> OAuth:
    """Build a fresh Authlib registry with Discord registered."""
    client_id = os.environ.get(DISCORD_CLIENT_ID_ENV, "").strip()
    client_secret = os.environ.get(DISCORD_CLIENT_SECRET_ENV, "").strip()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Discord OAuth not configured ({DISCORD_CLIENT_ID_ENV} "
                f"and {DISCORD_CLIENT_SECRET_ENV} must both be set)"
            ),
        )
    oauth = OAuth()
    oauth.register(
        name="discord",
        client_id=client_id,
        client_secret=client_secret,
        access_token_url=DISCORD_ACCESS_TOKEN_URL,
        authorize_url=DISCORD_AUTHORIZE_URL,
        api_base_url=DISCORD_API_BASE_URL,
        client_kwargs={"scope": "identify email"},
    )
    return oauth


def _require_auth_enabled() -> None:
    """Refuse OAuth routes when the auth scaffold is off."""
    if not auth_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


AuthGate = Annotated[None, Depends(_require_auth_enabled)]


async def fetch_discord_profile(oauth: OAuth, token: dict) -> DiscordProfile:
    """Fetch and normalize Discord's ``/users/@me`` payload."""
    resp = await oauth.discord.get("users/@me", token=token)
    resp.raise_for_status()
    data = resp.json()
    email = data.get("email")
    email_verified = bool(data.get("verified"))
    return DiscordProfile(
        user_id=str(data.get("id") or ""),
        username=data.get("username"),
        global_name=data.get("global_name"),
        verified_email=email if (email and email_verified) else None,
    )


@router.get("/auth/discord/login")
async def discord_login(request: Request, _: AuthGate) -> RedirectResponse:
    """Start the Discord OAuth flow."""
    oauth = _oauth_client()
    redirect_uri = str(request.url_for("discord_callback"))
    return await oauth.discord.authorize_redirect(request, redirect_uri)


@router.post("/auth/link/discord/start")
async def discord_link_start(
    request: Request,
    _: AuthGate,
    user: CurrentUserRequired,
) -> RedirectResponse:
    """Start a Discord OAuth flow for linking to the signed-in account."""
    stage_link_request(request, user)
    oauth = _oauth_client()
    redirect_uri = str(request.url_for("discord_link_callback"))
    return await oauth.discord.authorize_redirect(request, redirect_uri)


@router.get("/auth/discord/callback", name="discord_callback")
async def discord_callback(request: Request, db: DbSession, _: AuthGate) -> RedirectResponse:
    """Finish the OAuth handshake and sign the user in."""
    oauth = _oauth_client()
    try:
        token = await oauth.discord.authorize_access_token(request)
    except OAuthError as exc:
        _log.warning("discord oauth state/code exchange failed: %s", exc.error)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc

    profile = await fetch_discord_profile(oauth, token)
    if not profile.verified_email:
        raise HTTPException(status_code=400, detail="no_verified_email")
    if not profile.user_id:
        raise HTTPException(status_code=400, detail="no_discord_user_id")

    user = resolve_or_link_identity(
        db,
        provider=PROVIDER_DISCORD,
        subject=profile.user_id,
        email=profile.verified_email,
        display_name=profile.display_name,
        name_prefix="discord",
    )

    request.session["user_id"] = user.id
    return RedirectResponse(url=POST_SIGNIN_REDIRECT, status_code=302)


@router.get("/auth/link/discord/callback", name="discord_link_callback")
async def discord_link_callback(
    request: Request,
    db: DbSession,
    _: AuthGate,
    user: CurrentUserRequired,
) -> RedirectResponse:
    """Finish a Discord OAuth flow and attach it to the signed-in user."""
    link_user_id = consume_link_request(request, user)
    oauth = _oauth_client()
    try:
        token = await oauth.discord.authorize_access_token(request)
    except OAuthError as exc:
        _log.warning("discord link oauth state/code exchange failed: %s", exc.error)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc

    profile = await fetch_discord_profile(oauth, token)
    if not profile.verified_email:
        raise HTTPException(status_code=400, detail="no_verified_email")
    if not profile.user_id:
        raise HTTPException(status_code=400, detail="no_discord_user_id")

    try:
        link_identity_to_user(
            db,
            user_id=link_user_id,
            provider=PROVIDER_DISCORD,
            subject=profile.user_id,
            email=profile.verified_email,
        )
    except IdentityConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail=identity_conflict_detail(exc.provider),
        ) from exc

    return RedirectResponse(url=POST_LINK_REDIRECT, status_code=302)
