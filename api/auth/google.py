"""Google OAuth sign-in for the hosted-demo auth surface.

Fourth slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61)
auth epic, per [ADR-0019](../../docs/adr/0019-hosted-demo-identity-and-auth.md).
Mirrors `api/auth/github.py` shape: Authlib drives the OAuth dance,
the callback upserts a `users` row keyed on the verified email, and
the session cookie is the only state that crosses requests.

Two differences from the GitHub provider:

1. **OIDC discovery.** Google publishes its full OIDC metadata at
   `https://accounts.google.com/.well-known/openid-configuration`.
   We hand Authlib that URL via `server_metadata_url` so authorize /
   token / userinfo endpoints are pulled at runtime — no risk of
   stale URLs if Google rotates them.
2. **Single userinfo call.** GitHub needs `/user` + `/user/emails`
   because primary-email visibility is opt-in. Google's userinfo
   already carries `email`, `email_verified`, `name`, and `sub` in
   one response (Authlib also stashes the parsed ID-token claims on
   `token["userinfo"]`), so the profile fetcher is a single read.

Account-merge contract is identical to the GitHub provider — same
ADR-0019 first-set-wins for `display_name`, same
`email_verified_at`-on-first-verified-sign-in, same `IntegrityError`
race recovery in the read-then-insert window.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError

from ..db.models import User
from .github import _find_user_by_email
from .session import DbSession, auth_enabled

_log = logging.getLogger(__name__)

#: Google OAuth client credentials. Both env vars must be set when auth
#: is enabled, otherwise the routes return 503 — matching the GitHub
#: provider's posture so a misconfigured deploy fails loudly rather
#: than leaking an Authlib traceback.
GOOGLE_CLIENT_ID_ENV = "MGZ_PKMN_GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET_ENV = "MGZ_PKMN_GOOGLE_CLIENT_SECRET"

#: Google's OpenID Connect discovery document. Authlib reads
#: `authorize_url`, `token_url`, and `userinfo_endpoint` from this so we
#: don't have to encode them statically and chase Google's URL changes.
GOOGLE_OIDC_METADATA_URL = "https://accounts.google.com/.well-known/openid-configuration"

#: Where to send the user after a successful sign-in. Same anchor as the
#: other providers so the SPA's `useEffect(/me)` flips to signed-in.
POST_SIGNIN_REDIRECT = "/"

router = APIRouter()


@dataclass(frozen=True, slots=True)
class GoogleProfile:
    """Normalized view of the Google profile we care about.

    Kept narrow on purpose — the OAuth callback handler reads exactly
    these three fields, so tests don't need to mint full Google userinfo
    payloads. `verified_email` is `None` when Google's userinfo lists an
    email but flags it as unverified; the callback treats that the same
    as a missing email."""

    sub: str
    name: str | None
    verified_email: str | None


def _oauth_client() -> OAuth:
    """Build a fresh Authlib `OAuth` registry with Google registered.

    Constructed per-request rather than module-globally so tests can
    swap env vars between cases without poking at module state, and so
    a self-hoster who never enables auth doesn't pay the registration
    cost at import time. Same lazy-construction pattern as
    `api/auth/github.py`."""
    client_id = os.environ.get(GOOGLE_CLIENT_ID_ENV, "").strip()
    client_secret = os.environ.get(GOOGLE_CLIENT_SECRET_ENV, "").strip()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Google OAuth not configured ({GOOGLE_CLIENT_ID_ENV} "
                f"and {GOOGLE_CLIENT_SECRET_ENV} must both be set)"
            ),
        )
    oauth = OAuth()
    oauth.register(
        name="google",
        client_id=client_id,
        client_secret=client_secret,
        server_metadata_url=GOOGLE_OIDC_METADATA_URL,
        # `openid email profile` is the minimum scope set that yields
        # `sub`, `email`, `email_verified`, and `name` on the userinfo
        # response. We never ask for Gmail / Drive scopes.
        client_kwargs={"scope": "openid email profile"},
    )
    return oauth


def _require_auth_enabled() -> None:
    """Refuse OAuth routes when the scaffold is off.

    Same posture as the GitHub provider: returning 404 (rather than
    403) keeps probes from leaking signal about whether auth is on or
    off. Body matches Starlette's default 404 so the response is
    byte-identical to a route that doesn't exist."""
    if not auth_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


AuthGate = Annotated[None, Depends(_require_auth_enabled)]


async def fetch_google_profile(oauth: OAuth, request: Request, token: dict) -> GoogleProfile:
    """Read the OIDC userinfo claims into a normalized profile.

    Factored out so tests can patch this single seam rather than
    deep-mocking Authlib's HTTP client.

    Authlib stashes the parsed ID-token claims under `token["userinfo"]`
    once `authorize_access_token` returns (since `nonce` and discovery
    are in play). We prefer that cached read; if it's absent — older
    Authlib versions, or a flow that skipped ID-token parsing — we fall
    back to the OIDC userinfo endpoint. Either path produces the same
    claims for the fields we care about.

    Email is treated as verified-or-nothing: an `email` claim without
    `email_verified=true` is dropped. The callback's 400-no_verified_email
    branch then fires uniformly across "no email" and "unverified email"
    inputs."""
    userinfo = token.get("userinfo")
    if userinfo is None:
        resp = await oauth.google.userinfo(token=token)
        userinfo = dict(resp) if not isinstance(resp, dict) else resp
    email = userinfo.get("email")
    email_verified = bool(userinfo.get("email_verified"))
    return GoogleProfile(
        sub=str(userinfo.get("sub") or ""),
        name=userinfo.get("name"),
        verified_email=email if (email and email_verified) else None,
    )


@router.get("/auth/google/login")
async def google_login(request: Request, _: AuthGate) -> RedirectResponse:
    """Start the Google OAuth flow.

    Generates an Authlib state token + nonce, stashes both in the
    session cookie, and 302s to Google's authorize URL pulled from the
    OIDC discovery doc. The user lands on
    `/api/v1/auth/google/callback` after granting consent."""
    oauth = _oauth_client()
    redirect_uri = str(request.url_for("google_callback"))
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/google/callback", name="google_callback")
async def google_callback(request: Request, db: DbSession, _: AuthGate) -> RedirectResponse:
    """Finish the OAuth handshake and sign the user in.

    Authlib's `authorize_access_token` validates the state + nonce
    against what `google_login` stored in the session cookie, exchanges
    the code for tokens, and parses the ID token. We then read the
    profile via `fetch_google_profile`, upsert the `users` row keyed
    on the verified email, issue the session cookie by writing
    `user_id`, and 302 back to the SPA root.

    Errors:

    - State mismatch / code reuse / refused consent → Authlib raises
      `OAuthError`; we surface as 400. The user can retry from the
      header chip.
    - Google returns no verified email (claim missing, or
      `email_verified=false`) → 400 `no_verified_email`. Account-merge
      depends on a verified email anchor.
    - Google returns no `sub` → 400 `no_google_sub`. We can't ground a
      unique `users.name` row without a stable identifier; refuse
      cleanly instead of falling back to a colliding constant."""
    oauth = _oauth_client()
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as exc:
        _log.warning("google oauth state/code exchange failed: %s", exc.error)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc

    profile = await fetch_google_profile(oauth, request, token)
    if not profile.verified_email:
        raise HTTPException(status_code=400, detail="no_verified_email")
    if not profile.sub:
        raise HTTPException(status_code=400, detail="no_google_sub")

    existing = _find_user_by_email(db, profile.verified_email)
    if existing is None:
        # Fresh signup. `name` must be unique on `User`; `sub` is
        # Google's stable, opaque per-user identifier (typically a
        # 21-digit numeric string) so collisions inside the
        # `google:` namespace effectively can't happen. Stays
        # domain-separated from `gh:` (api/auth/github.py) and
        # `magic:` (api/auth/magic.py) by the prefix.
        candidate_name = f"google:{profile.sub}"[:64]
        user = User(
            name=candidate_name,
            email=profile.verified_email,
            email_verified_at=datetime.now(UTC),
            display_name=profile.name or None,
        )
        db.add(user)
        try:
            # Flush rather than commit — `get_db` already commits on
            # normal return. Flush is enough to trigger the unique
            # constraint on `users.email` and let us recover from the
            # race below.
            db.flush()
        except IntegrityError:
            # Two callbacks for the same verified email landed within
            # the read-then-insert window. The other transaction won
            # the INSERT; roll back and re-read so this request can
            # proceed idempotently with the existing row. No
            # display_name / email_verified_at update on this path —
            # whichever callback committed first already filled them.
            db.rollback()
            user = _find_user_by_email(db, profile.verified_email)
            if user is None:
                # The unique constraint fired but the row isn't
                # readable — something unrelated raised the
                # IntegrityError. Let the original error surface.
                raise
    else:
        user = existing
        if user.email_verified_at is None:
            user.email_verified_at = datetime.now(UTC)
        if not user.display_name:
            # Per ADR-0019, the provider only fills `display_name` when
            # the row has none yet. Lets the user keep whatever they
            # had on first sign-in even if Google reports a different
            # name.
            user.display_name = profile.name or None

    # `get_db` commits on normal return; no explicit commit here.
    request.session["user_id"] = user.id
    return RedirectResponse(url=POST_SIGNIN_REDIRECT, status_code=302)
