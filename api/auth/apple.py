"""Sign in with Apple for the hosted-demo auth surface.

Fifth slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61)
auth epic, per [ADR-0019](../../docs/adr/0019-hosted-demo-identity-and-auth.md).
Mirrors `api/auth/github.py` / `api/auth/google.py`: Authlib drives the
OAuth dance, the callback upserts a `users` row keyed on the verified
email, and the session cookie is the only state that crosses requests.

Apple-specific deviations from the GitHub / Google providers:

1. **Per-request client secret.** Apple doesn't issue a static client
   secret — clients mint a short-lived JWT signed with their `.p8` key
   (`ES256`, `iss=team_id`, `sub=services_id`, `aud=https://appleid.apple.com`,
   exp ≤ 6 months). We cache the minted JWT for 90 days so a deploy
   doesn't pay the signing cost on every callback.
2. **Form-POST callback.** Apple uses `response_mode=form_post`, so the
   callback handler is a `POST` reading `application/x-www-form-urlencoded`
   — not a `GET` like the other providers.
3. **`id_token` is the source of truth.** Apple returns an `id_token`
   JWT we verify against `https://appleid.apple.com/auth/keys` (their
   JWKS). The `email` claim is treated as verified — Apple only emits
   the claim for emails it has confirmed (including the deterministic
   `@privaterelay.appleid.com` address when the user chose private
   relay).
4. **Name is first-hit only.** Apple includes the user's name on the
   *first* successful authorization; subsequent sign-ins omit it. The
   `user` form field carries the name as JSON; we extract it once on
   the cold-mint path and let the resolver's first-set-wins rule keep
   it stable on later sign-ins.

Account-merge contract is identical to the other providers — same
ADR-0019 first-set-wins for `display_name`, same `email_verified_at`-on-
first-verified-sign-in.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Annotated, Any

import httpx
from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.starlette_client import OAuth
from authlib.jose import JsonWebKey, jwt
from authlib.jose.errors import JoseError
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import RedirectResponse

from ..db.models import PROVIDER_APPLE
from .identity import IdentityConflictError, link_identity_to_user, resolve_or_link_identity
from .linking import (
    POST_LINK_REDIRECT,
    consume_link_request,
    identity_conflict_detail,
    stage_link_request,
)
from .session import CurrentUserRequired, DbSession, auth_enabled

_log = logging.getLogger(__name__)

#: Apple Sign in credentials. All four env vars must be set when auth is
#: enabled, otherwise the routes return 503 — same loud-misconfiguration
#: posture as the GitHub / Google providers.
#:
#: - ``MGZ_PKMN_APPLE_CLIENT_ID`` — the *Services ID* (e.g.
#:   ``com.mgz-pkmn.web``), **not** the App ID. The Services ID is the
#:   identifier registered in the Apple Developer portal for the web
#:   sign-in surface.
#: - ``MGZ_PKMN_APPLE_TEAM_ID`` — the 10-character Apple Developer team
#:   identifier. Used as the JWT ``iss`` claim when minting client
#:   secrets.
#: - ``MGZ_PKMN_APPLE_KEY_ID`` — the 10-character Key ID of the
#:   ``Sign in with Apple`` ``.p8`` key. Used as the JWT header ``kid``.
#: - ``MGZ_PKMN_APPLE_PRIVATE_KEY`` — the PEM-encoded contents of the
#:   ``.p8`` private key file (``-----BEGIN PRIVATE KEY-----`` ...).
#:   Loaded from a secret store; never committed.
APPLE_CLIENT_ID_ENV = "MGZ_PKMN_APPLE_CLIENT_ID"
APPLE_TEAM_ID_ENV = "MGZ_PKMN_APPLE_TEAM_ID"
APPLE_KEY_ID_ENV = "MGZ_PKMN_APPLE_KEY_ID"
APPLE_PRIVATE_KEY_ENV = "MGZ_PKMN_APPLE_PRIVATE_KEY"

#: Apple's well-known endpoints. Hand them to Authlib statically because
#: Apple doesn't publish an OIDC discovery document at the conventional
#: path.
APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

#: Lifetime for the per-deploy client_secret JWT cache. Apple caps the
#: ``exp`` claim at 6 months; we mint at 90 days so a clock-skew miss
#: still has plenty of headroom and the renewal cadence is gentle.
CLIENT_SECRET_TTL_SECONDS = 90 * 24 * 60 * 60

#: Where to send the user after a successful sign-in. Same anchor as the
#: other providers so the SPA's `useEffect(/me)` flips to signed-in.
POST_SIGNIN_REDIRECT = "/"


router = APIRouter()


# Module-level cache for the minted client secret. Indexed by the
# (services_id, team_id, key_id) tuple so a deploy that rotates one of
# the inputs invalidates automatically; the cache value is the
# (jwt_string, expiry_unix_seconds) tuple. Per-process cache only —
# multi-instance deploys re-mint on each instance, which is fine at
# this cadence.
_client_secret_cache: dict[tuple[str, str, str], tuple[str, int]] = {}


@dataclass(frozen=True, slots=True)
class AppleProfile:
    """Normalized view of the Apple id_token / form-POST payload.

    Kept narrow on purpose — the callback reads exactly these fields, so
    tests don't need to mint full Apple JWTs unless they're exercising
    the verification path itself.

    - ``sub`` is the stable per-user identifier ("user" claim in Apple's
      token response).
    - ``email`` is treated as verified; Apple only emits an ``email``
      claim for confirmed addresses (real or ``@privaterelay.appleid.com``).
    - ``name`` is the first-hit display name extracted from the ``user``
      form field, or ``None`` on subsequent sign-ins (Apple omits it).
    """

    sub: str
    email: str | None
    name: str | None


def _require_auth_enabled() -> None:
    """Refuse OAuth routes when the scaffold is off.

    Same posture as the GitHub / Google providers — 404 with the
    Starlette default body so probes can't distinguish "auth disabled"
    from "wrong URL"."""
    if not auth_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


AuthGate = Annotated[None, Depends(_require_auth_enabled)]


def _read_apple_env() -> tuple[str, str, str, str]:
    """Read the four Apple env vars, or raise 503 if any are missing.

    Returns the tuple ``(services_id, team_id, key_id, private_key_pem)``.
    The deploy-time clarity posture matches the other providers — a
    half-configured Apple env yields a clear 503 instead of an Authlib
    traceback."""
    services_id = os.environ.get(APPLE_CLIENT_ID_ENV, "").strip()
    team_id = os.environ.get(APPLE_TEAM_ID_ENV, "").strip()
    key_id = os.environ.get(APPLE_KEY_ID_ENV, "").strip()
    # Don't ``.strip()`` the PEM — embedded newlines are load-bearing
    # for the ``-----BEGIN``/``-----END`` envelope. Strip only the outer
    # whitespace the env-var loader may have introduced.
    private_key = os.environ.get(APPLE_PRIVATE_KEY_ENV, "").strip("\t ")
    if not all([services_id, team_id, key_id, private_key]):
        raise HTTPException(
            status_code=503,
            detail=(
                f"Apple sign-in not configured ({APPLE_CLIENT_ID_ENV}, "
                f"{APPLE_TEAM_ID_ENV}, {APPLE_KEY_ID_ENV}, "
                f"{APPLE_PRIVATE_KEY_ENV} must all be set)"
            ),
        )
    return services_id, team_id, key_id, private_key


def mint_client_secret(
    *,
    services_id: str,
    team_id: str,
    key_id: str,
    private_key_pem: str,
    now: int | None = None,
    ttl_seconds: int = CLIENT_SECRET_TTL_SECONDS,
) -> str:
    """Mint an ES256-signed JWT for Apple's ``client_secret`` slot.

    Apple requires a JWT (not a static secret) for OAuth token exchange.
    The payload spec is fixed:

    - ``iss`` — the team identifier (10-char Apple Developer Team ID).
    - ``sub`` — the Services ID (``MGZ_PKMN_APPLE_CLIENT_ID``).
    - ``aud`` — ``https://appleid.apple.com``.
    - ``iat`` — issued-at, current time.
    - ``exp`` — issued-at + ``ttl_seconds`` (Apple caps at ~6 months;
      we default to 90 days).
    - Header ``kid`` — Apple's Key ID for the ``.p8`` we're signing with.

    Public for test injection — callers should usually go through
    :func:`_get_client_secret` so the result is cached.
    """
    issued_at = int(time.time()) if now is None else int(now)
    headers = {"alg": "ES256", "kid": key_id}
    claims = {
        "iss": team_id,
        "iat": issued_at,
        "exp": issued_at + ttl_seconds,
        "aud": APPLE_ISSUER,
        "sub": services_id,
    }
    token_bytes = jwt.encode(headers, claims, private_key_pem)
    # ``jwt.encode`` returns bytes; Authlib's ``OAuth.register`` and
    # ``authorize_access_token`` both accept ``client_secret`` as ``str``.
    return token_bytes.decode("ascii") if isinstance(token_bytes, bytes) else str(token_bytes)


def _get_client_secret(
    *,
    services_id: str,
    team_id: str,
    key_id: str,
    private_key_pem: str,
) -> str:
    """Cached wrapper around :func:`mint_client_secret`.

    The minted JWT lives in a per-process dict keyed on the
    (services_id, team_id, key_id) tuple. Re-minted on first call after
    expiry (with a 60-second skew margin so a request in flight at the
    moment of expiry can't observe the gap). Multi-instance deploys
    each maintain their own cache — at a 90-day TTL the duplicate work
    is negligible."""
    cache_key = (services_id, team_id, key_id)
    now = int(time.time())
    cached = _client_secret_cache.get(cache_key)
    if cached is not None:
        token, expiry = cached
        if expiry - now > 60:
            return token
    token = mint_client_secret(
        services_id=services_id,
        team_id=team_id,
        key_id=key_id,
        private_key_pem=private_key_pem,
    )
    _client_secret_cache[cache_key] = (token, now + CLIENT_SECRET_TTL_SECONDS)
    return token


def _reset_client_secret_cache() -> None:
    """Invalidate the per-process JWT cache. Test hook only."""
    _client_secret_cache.clear()


def _oauth_client() -> OAuth:
    """Build a fresh Authlib `OAuth` registry with Apple registered.

    Constructed per-request rather than module-globally so a freshly
    minted (or rotated) client secret is picked up on the next request,
    and so a self-hoster who never enables auth doesn't pay the
    registration cost at import time. Same lazy-construction pattern as
    `api/auth/github.py`."""
    services_id, team_id, key_id, private_key_pem = _read_apple_env()
    client_secret = _get_client_secret(
        services_id=services_id,
        team_id=team_id,
        key_id=key_id,
        private_key_pem=private_key_pem,
    )
    oauth = OAuth()
    oauth.register(
        name="apple",
        client_id=services_id,
        client_secret=client_secret,
        access_token_url=APPLE_TOKEN_URL,
        authorize_url=APPLE_AUTHORIZE_URL,
        # ``name email`` returns the user's name + email on first
        # authorization. Apple expects space-separated scopes; the
        # ``response_mode=form_post`` is required when scope is
        # non-empty (otherwise Apple refuses with ``invalid_request``).
        client_kwargs={
            "scope": "name email",
            "response_mode": "form_post",
            # Apple's token endpoint expects ``client_id`` and
            # ``client_secret`` in the body — not the Authorization
            # header. Authlib defaults to header auth; flip to body to
            # match Apple's spec.
            "token_endpoint_auth_method": "client_secret_post",
        },
    )
    return oauth


async def fetch_apple_jwks() -> dict:
    """Fetch Apple's public JWKS used to verify ``id_token`` signatures.

    Factored out so tests can patch this single seam rather than
    mocking httpx at the transport layer. Apple rotates the keys
    periodically — the JWKS endpoint always returns all currently-
    valid keys, so a per-request fetch is safe even though it costs an
    extra network round-trip. Production deploys with a high callback
    rate can add a caching layer here later; for now the simplicity
    is worth more than the saved RTT."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(APPLE_JWKS_URL)
        resp.raise_for_status()
        return resp.json()


async def verify_id_token(id_token: str, *, audience: str) -> dict[str, Any]:
    """Verify Apple's ``id_token`` against the JWKS and return its claims.

    Raises :class:`HTTPException` 400 on any failure — bad signature,
    expired token, audience mismatch, unknown issuer. The audience
    must equal the configured Services ID (Apple sets ``aud`` on the
    token to whichever client requested it).

    Factored from the callback so tests can patch this single seam
    rather than orchestrating a full Apple/Authlib mock stack.
    """
    try:
        jwks = await fetch_apple_jwks()
    except httpx.HTTPError as exc:
        _log.warning("apple jwks fetch failed: %s", exc)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc

    try:
        key_set = JsonWebKey.import_key_set(jwks)
        claims = jwt.decode(
            id_token,
            key=key_set,
            claims_options={
                "iss": {"essential": True, "value": APPLE_ISSUER},
                "aud": {"essential": True, "value": audience},
            },
        )
        claims.validate()
    except JoseError as exc:
        _log.warning("apple id_token verification failed: %s", exc)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc
    return dict(claims)


def extract_profile(claims: dict[str, Any], *, user_payload: str | None) -> AppleProfile:
    """Build an :class:`AppleProfile` from verified id_token claims and the
    optional ``user`` form field Apple posts on first authorization.

    The ``user`` field is a JSON string carrying ``{"name": {"firstName":
    ..., "lastName": ...}, "email": ...}`` on first hit, omitted on
    subsequent sign-ins. We parse it defensively — Apple has been known
    to ship empty strings or partial structures during developer-portal
    misconfigurations — and only extract the name. The email always
    comes from the verified ``id_token`` instead, because the form
    field's ``email`` is not signed and could be tampered.
    """
    sub = str(claims.get("sub") or "")
    email = claims.get("email")
    email_str = str(email).strip() if isinstance(email, str) and email.strip() else None

    name: str | None = None
    if user_payload:
        try:
            parsed = json.loads(user_payload)
        except (ValueError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            name_obj = parsed.get("name")
            if isinstance(name_obj, dict):
                first = (name_obj.get("firstName") or "").strip()
                last = (name_obj.get("lastName") or "").strip()
                combined = " ".join(part for part in (first, last) if part)
                name = combined or None
    return AppleProfile(sub=sub, email=email_str, name=name)


@router.get("/auth/apple/login")
async def apple_login(request: Request, _: AuthGate) -> RedirectResponse:
    """Start the Apple OAuth flow.

    Generates an Authlib state token, stashes it in the session cookie,
    and 302s to Apple's authorize URL with ``response_mode=form_post``.
    The user lands on `/api/v1/auth/apple/callback` via Apple's POST."""
    oauth = _oauth_client()
    redirect_uri = str(request.url_for("apple_callback"))
    return await oauth.apple.authorize_redirect(request, redirect_uri)


@router.post("/auth/link/apple/start")
async def apple_link_start(
    request: Request,
    _: AuthGate,
    user: CurrentUserRequired,
) -> RedirectResponse:
    """Start an Apple OAuth flow for linking to the signed-in account."""
    stage_link_request(request, user)
    oauth = _oauth_client()
    redirect_uri = str(request.url_for("apple_link_callback"))
    return await oauth.apple.authorize_redirect(request, redirect_uri)


@router.post("/auth/apple/callback", name="apple_callback")
async def apple_callback(
    request: Request,
    db: DbSession,
    _: AuthGate,
    code: Annotated[str | None, Form()] = None,
    state: Annotated[str | None, Form()] = None,
    user: Annotated[str | None, Form()] = None,
    error: Annotated[str | None, Form()] = None,
) -> RedirectResponse:
    """Finish the Apple OAuth handshake and sign the user in.

    Apple POSTs the callback as ``application/x-www-form-urlencoded``
    (distinct from the other providers' GETs) — FastAPI's ``Form()``
    pulls the fields out of the body. Authlib's
    ``authorize_access_token`` then validates the state against what
    `apple_login` stored in the session cookie and exchanges the code
    for tokens. We verify the returned ``id_token`` ourselves against
    Apple's JWKS, extract the verified email + first-hit name, and run
    the standard upsert/merge.

    Errors:

    - User refused / Apple flagged an error → 400 ``oauth_failed``.
    - State mismatch / code reuse → Authlib raises ``OAuthError``; we
      surface as 400.
    - ``id_token`` signature / audience mismatch → 400 ``oauth_failed``.
    - ``id_token`` missing the ``email`` claim → 400 ``no_verified_email``.
    - ``id_token`` missing ``sub`` → 400 ``no_apple_sub``."""
    if error or not code:
        _log.warning("apple oauth callback returned error: %s", error or "no_code")
        raise HTTPException(status_code=400, detail="oauth_failed")

    oauth = _oauth_client()
    try:
        token = await oauth.apple.authorize_access_token(request)
    except OAuthError as exc:
        _log.warning("apple oauth state/code exchange failed: %s", exc.error)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc

    services_id = os.environ.get(APPLE_CLIENT_ID_ENV, "").strip()
    id_token_str = token.get("id_token") if isinstance(token, dict) else None
    if not id_token_str:
        raise HTTPException(status_code=400, detail="oauth_failed")
    claims = await verify_id_token(id_token_str, audience=services_id)
    profile = extract_profile(claims, user_payload=user)

    if not profile.email:
        raise HTTPException(status_code=400, detail="no_verified_email")
    if not profile.sub:
        raise HTTPException(status_code=400, detail="no_apple_sub")

    # Same identity-first resolver the other providers use. Apple's
    # ``sub`` is the stable per-(team, services-id, user) identifier;
    # private-relay addresses are deterministic per Services ID so the
    # email-fallback branch also stays consistent across re-signs.
    resolved = resolve_or_link_identity(
        db,
        provider=PROVIDER_APPLE,
        subject=profile.sub,
        email=profile.email,
        display_name=profile.name or None,
        name_prefix="apple",
    )

    request.session["user_id"] = resolved.id
    return RedirectResponse(url=POST_SIGNIN_REDIRECT, status_code=302)


@router.post("/auth/link/apple/callback", name="apple_link_callback")
async def apple_link_callback(
    request: Request,
    db: DbSession,
    _: AuthGate,
    user: CurrentUserRequired,
    code: Annotated[str | None, Form()] = None,
    state: Annotated[str | None, Form()] = None,
    user_payload: Annotated[str | None, Form(alias="user")] = None,
    error: Annotated[str | None, Form()] = None,
) -> RedirectResponse:
    """Finish an Apple OAuth flow and attach it to the signed-in user."""
    if error or not code:
        _log.warning("apple link oauth callback returned error: %s", error or "no_code")
        raise HTTPException(status_code=400, detail="oauth_failed")

    link_user_id = consume_link_request(request, user)
    oauth = _oauth_client()
    try:
        token = await oauth.apple.authorize_access_token(request)
    except OAuthError as exc:
        _log.warning("apple link oauth state/code exchange failed: %s", exc.error)
        raise HTTPException(status_code=400, detail="oauth_failed") from exc

    services_id = os.environ.get(APPLE_CLIENT_ID_ENV, "").strip()
    id_token_str = token.get("id_token") if isinstance(token, dict) else None
    if not id_token_str:
        raise HTTPException(status_code=400, detail="oauth_failed")
    claims = await verify_id_token(id_token_str, audience=services_id)
    profile = extract_profile(claims, user_payload=user_payload)

    if not profile.email:
        raise HTTPException(status_code=400, detail="no_verified_email")
    if not profile.sub:
        raise HTTPException(status_code=400, detail="no_apple_sub")

    try:
        link_identity_to_user(
            db,
            user_id=link_user_id,
            provider=PROVIDER_APPLE,
            subject=profile.sub,
            email=profile.email,
        )
    except IdentityConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail=identity_conflict_detail(exc.provider),
        ) from exc

    return RedirectResponse(url=POST_LINK_REDIRECT, status_code=302)


__all__ = [
    "APPLE_AUTHORIZE_URL",
    "APPLE_CLIENT_ID_ENV",
    "APPLE_ISSUER",
    "APPLE_JWKS_URL",
    "APPLE_KEY_ID_ENV",
    "APPLE_PRIVATE_KEY_ENV",
    "APPLE_TEAM_ID_ENV",
    "APPLE_TOKEN_URL",
    "CLIENT_SECRET_TTL_SECONDS",
    "AppleProfile",
    "extract_profile",
    "fetch_apple_jwks",
    "mint_client_secret",
    "router",
    "verify_id_token",
]
