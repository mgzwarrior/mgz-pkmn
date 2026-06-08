"""GitHub OAuth sign-in for the hosted-demo auth surface.

Second slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61)
auth epic, per [ADR-0019](../../docs/adr/0019-hosted-demo-identity-and-auth.md).
Layers on top of the foundation in
[session.py](session.py) — Authlib handles the OAuth dance using the
same Starlette `SessionMiddleware` already installed for the signed
cookie, so state tokens never leave the session shape that #407
established.

Account-merge contract (ADR-0019):

- The `users` row is keyed on the *verified primary* email returned by
  GitHub. If a row with that email already exists (from a prior sign-in
  via GitHub or a future Google / magic-link), it's reused.
- `display_name` follows a "first-set wins" policy: a provider only
  populates it if the existing row has no `display_name` yet. Lets the
  user keep whatever name they chose on their first sign-in even when
  they sign in later via a provider that returns a different one.
- `email_verified_at` is stamped on the first sign-in that brings a
  verified email through. Not refreshed on subsequent sign-ins.
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

from ..db.models import PROVIDER_GITHUB
from .identity import IdentityConflictError, link_identity_to_user, resolve_or_link_identity
from .linking import (
    POST_LINK_REDIRECT,
    consume_link_request,
    identity_conflict_detail,
    stage_link_request,
)
from .session import CurrentUserRequired, DbSession, auth_enabled

_log = logging.getLogger(__name__)

#: GitHub OAuth app credentials. Both env vars must be set when auth is
#: enabled, otherwise the routes return 503 — we'd rather a clear
#: misconfiguration error than a vague Authlib traceback.
GITHUB_CLIENT_ID_ENV = "MGZ_PKMN_GITHUB_CLIENT_ID"
GITHUB_CLIENT_SECRET_ENV = "MGZ_PKMN_GITHUB_CLIENT_SECRET"

#: Where to send the user after a successful sign-in. Relative path so
#: the same value works locally, on the hosted demo, and behind a
#: reverse proxy. Anchor on `/` (the SPA root) so the header chip's
#: useEffect re-fetches `/me` and flips to signed-in.
POST_SIGNIN_REDIRECT = "/"

router = APIRouter()


@dataclass(frozen=True, slots=True)
class GitHubProfile:
    """Normalized view of the GitHub profile we care about.

    Kept narrow on purpose — the OAuth callback handler reads exactly
    these three fields, so tests don't need to mint full GitHub API
    payloads."""

    login: str
    name: str | None
    verified_primary_email: str | None


def _oauth_client() -> OAuth:
    """Build a fresh Authlib `OAuth` registry with GitHub registered.

    Constructed per-request rather than module-globally so tests can
    swap the env vars between cases without poking at module state, and
    so a self-hoster who never enables auth doesn't pay the registration
    cost at import time."""
    client_id = os.environ.get(GITHUB_CLIENT_ID_ENV, "").strip()
    client_secret = os.environ.get(GITHUB_CLIENT_SECRET_ENV, "").strip()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail=(
                f"GitHub OAuth not configured ({GITHUB_CLIENT_ID_ENV} "
                f"and {GITHUB_CLIENT_SECRET_ENV} must both be set)"
            ),
        )
    oauth = OAuth()
    oauth.register(
        name="github",
        client_id=client_id,
        client_secret=client_secret,
        access_token_url="https://github.com/login/oauth/access_token",
        authorize_url="https://github.com/login/oauth/authorize",
        api_base_url="https://api.github.com/",
        # `read:user` for the profile, `user:email` for the verified
        # primary email. Both are user-readable scopes; we don't ask
        # for repo access.
        client_kwargs={"scope": "read:user user:email"},
    )
    return oauth


def _require_auth_enabled() -> None:
    """Refuse OAuth routes when the scaffold is off.

    Self-hosters with `MGZ_PKMN_AUTH_ENABLED` unset shouldn't be able to
    start an OAuth flow that has nowhere to land. Returning 404 (rather
    than 403) keeps probes from leaking signal about whether auth is on
    or off — both unconfigured and absent look the same. The routes
    still appear in the OpenAPI schema regardless (FastAPI generates
    schema from the router, not from dependency results); we accept
    that trade and document it here rather than hiding the routes with
    `include_in_schema=False`, since a configured deploy needs the
    schema entries to be discoverable."""
    if not auth_enabled():
        # Match FastAPI/Starlette's default 404 body exactly so the
        # response is byte-identical to a route that doesn't exist —
        # probing can't distinguish "auth disabled" from "wrong URL".
        raise HTTPException(status_code=404, detail="Not Found")


AuthGate = Annotated[None, Depends(_require_auth_enabled)]


async def fetch_github_profile(oauth: OAuth, token: dict) -> GitHubProfile:
    """Pull the profile + verified primary email for the signed-in user.

    Factored out so tests can patch this single seam rather than
    deep-mocking Authlib's HTTP client. The real call hits two GitHub
    endpoints — `/user` (profile) and `/user/emails` (the email list,
    which `/user` doesn't include for users with private emails)."""
    user_resp = await oauth.github.get("user", token=token)
    user_resp.raise_for_status()
    user_data = user_resp.json()
    emails_resp = await oauth.github.get("user/emails", token=token)
    emails_resp.raise_for_status()
    emails = emails_resp.json() or []
    verified_primary = next(
        (
            e["email"]
            for e in emails
            if isinstance(e, dict) and e.get("verified") and e.get("primary") and e.get("email")
        ),
        None,
    )
    return GitHubProfile(
        login=str(user_data.get("login") or ""),
        name=user_data.get("name"),
        verified_primary_email=verified_primary,
    )


@router.get("/auth/github/login")
async def github_login(request: Request, _: AuthGate) -> RedirectResponse:
    """Start the GitHub OAuth flow.

    Generates an Authlib state token, stashes it in the session cookie,
    and 302s to GitHub's authorize URL. The user lands on
    `/api/v1/auth/github/callback` after granting access."""
    oauth = _oauth_client()
    redirect_uri = str(request.url_for("github_callback"))
    return await oauth.github.authorize_redirect(request, redirect_uri)


@router.post("/auth/link/github/start")
async def github_link_start(
    request: Request,
    _: AuthGate,
    user: CurrentUserRequired,
) -> RedirectResponse:
    """Start a GitHub OAuth flow for linking to the signed-in account."""
    stage_link_request(request, user)
    oauth = _oauth_client()
    redirect_uri = str(request.url_for("github_link_callback"))
    return await oauth.github.authorize_redirect(request, redirect_uri)


@router.get("/auth/github/callback", name="github_callback")
async def github_callback(request: Request, db: DbSession, _: AuthGate) -> RedirectResponse:
    """Finish the OAuth handshake and sign the user in.

    Authlib's `authorize_access_token` validates the state against what
    `github_login` stored in the session cookie and exchanges the code
    for a token. We then read the profile + verified primary email via
    `fetch_github_profile`, upsert the `users` row keyed on the email,
    issue the session cookie by writing `user_id`, and 302 the user
    back to the SPA root.

    Errors:

    - State mismatch / code reuse / refused consent → Authlib raises
      `OAuthError`; we surface as 400. The user can retry from the
      header chip.
    - GitHub returns no verified primary email → 400 with a clear
      message. Account-merge depends on a verified email anchor."""
    oauth = _oauth_client()
    try:
        token = await oauth.github.authorize_access_token(request)
    except OAuthError as exc:
        _log.warning("github oauth state/code exchange failed: %s", exc.error)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc

    profile = await fetch_github_profile(oauth, token)
    if not profile.verified_primary_email:
        # ADR-0019: account-merge needs an email anchor. No anchor →
        # we refuse rather than minting an anonymous-shaped row.
        raise HTTPException(status_code=400, detail="no_verified_email")
    if not profile.login:
        # A valid GitHub `/user` response always carries a login. An
        # empty one means GitHub gave us something we can't ground a
        # `users.name` row on — fall back to a constant ("gh:user")
        # would collide on the next empty-login signup and 500 at
        # commit on the unique constraint. Refuse cleanly instead.
        raise HTTPException(status_code=400, detail="no_github_login")

    # Slice 1 of #491: the identity-first resolver in `api/auth/identity.py`
    # owns the email-fallback + cold-mint + race-recovery branches that
    # used to be inlined here. ``provider_subject`` is GitHub's login —
    # stable enough that login-rename is rare (and the email-fallback
    # branch handles even that case the next time the user signs in).
    user = resolve_or_link_identity(
        db,
        provider=PROVIDER_GITHUB,
        subject=profile.login,
        email=profile.verified_primary_email,
        display_name=profile.name or profile.login or None,
        name_prefix="gh",
    )

    # `get_db` commits on normal return; no explicit commit here.
    request.session["user_id"] = user.id
    return RedirectResponse(url=POST_SIGNIN_REDIRECT, status_code=302)


@router.get("/auth/link/github/callback", name="github_link_callback")
async def github_link_callback(
    request: Request,
    db: DbSession,
    _: AuthGate,
    user: CurrentUserRequired,
) -> RedirectResponse:
    """Finish a GitHub OAuth flow and attach it to the signed-in user."""
    link_user_id = consume_link_request(request, user)
    oauth = _oauth_client()
    try:
        token = await oauth.github.authorize_access_token(request)
    except OAuthError as exc:
        _log.warning("github link oauth state/code exchange failed: %s", exc.error)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc

    profile = await fetch_github_profile(oauth, token)
    if not profile.verified_primary_email:
        raise HTTPException(status_code=400, detail="no_verified_email")
    if not profile.login:
        raise HTTPException(status_code=400, detail="no_github_login")

    try:
        link_identity_to_user(
            db,
            user_id=link_user_id,
            provider=PROVIDER_GITHUB,
            subject=profile.login,
            email=profile.verified_primary_email,
        )
    except IdentityConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail=identity_conflict_detail(exc.provider),
        ) from exc

    return RedirectResponse(url=POST_LINK_REDIRECT, status_code=302)
