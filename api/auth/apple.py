"""Sign in with Apple for the hosted-demo auth surface.

Fifth slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61)
auth epic, per [ADR-0019](../../docs/adr/0019-hosted-demo-identity-and-auth.md).
Same upsert / merge contract as the GitHub / Google providers (identity
resolution via ``resolve_or_link_identity``, ADR-0019 first-set-wins on
``display_name``), with several Apple-specific deviations.

Apple-specific deviations from the GitHub / Google providers:

1. **Per-deploy client secret.** Apple doesn't issue a static client
   secret — clients mint a short-lived JWT signed with their `.p8` key
   (``ES256``, ``iss=team_id``, ``sub=services_id``,
   ``aud=https://appleid.apple.com``, exp ≤ 6 months). We cache the
   minted JWT for 90 days so a deploy doesn't pay the signing cost on
   every callback.
2. **Form-POST callback.** Apple uses ``response_mode=form_post``, so
   the callback handler is a ``POST`` reading
   ``application/x-www-form-urlencoded`` — not a ``GET`` like the other
   providers.
3. **Stateless signed OAuth state.** Because Apple's callback arrives
   as a *cross-site* POST from ``appleid.apple.com``, browsers do not
   send our ``SameSite=Lax`` session cookie on the callback request.
   That would defeat Authlib's default session-stored state validation
   (the state Authlib stashed at ``/auth/apple/login`` time is invisible
   to the callback). We work around this by signing the OAuth ``state``
   parameter ourselves with itsdangerous and the project session
   secret — same trust model the magic-link path uses. The state value
   travels in Apple's POST body, the signature lets us validate without
   any cookie, and the link flow piggybacks ``link_user_id`` into the
   same signed payload so the cross-site POST doesn't need session
   identity either. As a side effect, we don't go through Authlib's
   ``authorize_redirect`` / ``authorize_access_token`` for Apple at all
   — Apple's flow is the most bespoke of the four providers and the
   manual httpx round-trip is small and explicit.
4. **``id_token`` is the source of truth.** Apple returns an
   ``id_token`` JWT we verify against
   ``https://appleid.apple.com/auth/keys`` (their JWKS). The ``email``
   claim is only trusted when the companion ``email_verified`` claim is
   truthy — Apple ships unverified addresses for some Managed Apple
   Account / Work & School users, and ADR-0019's email-anchor merge
   contract depends on the address actually being confirmed.
   Private-relay addresses (``@privaterelay.appleid.com``) are always
   returned as verified, so they ride the same path.
5. **Name is first-hit only.** Apple includes the user's name on the
   *first* successful authorization; subsequent sign-ins omit it. The
   ``user`` form field carries the name as JSON; we extract it once on
   the cold-mint path and let the resolver's first-set-wins rule keep
   it stable on later sign-ins.

Account-merge contract is identical to the other providers — same
ADR-0019 first-set-wins for ``display_name``, same
``email_verified_at``-on-first-verified-sign-in.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
from authlib.jose import JsonWebKey, jwt
from authlib.jose.errors import JoseError
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from ..db.models import PROVIDER_APPLE
from .identity import IdentityConflictError, link_identity_to_user, resolve_or_link_identity
from .linking import POST_LINK_REDIRECT, post_link_error_redirect
from .session import CurrentUserRequired, DbSession, auth_enabled, resolve_session_secret

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

#: Apple's well-known endpoints. Hand them to httpx statically because
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

#: itsdangerous salt for OAuth state tokens — keeps Apple state
#: domain-separated from the magic-link salt that shares the session
#: secret, so a token leaked from one surface can't be replayed against
#: the other.
STATE_TOKEN_SALT = "auth-apple-oauth-state"

#: OAuth state TTL. Generous enough for the user to "go make coffee
#: between clicking and authenticating", short enough that a leaked
#: state value can't be replayed days later. Apple's own ``code`` has a
#: similar window so the looser bound here is the user's reading speed.
STATE_TOKEN_MAX_AGE_SECONDS = 10 * 60

#: Where to send the user after a successful sign-in. Same anchor as
#: the other providers so the SPA's ``useEffect(/me)`` flips to
#: signed-in.
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
    - ``email`` is the verified address (or ``None`` when Apple's
      ``email_verified`` claim is missing or ``false``). The
      ``extract_profile`` helper enforces this so callers can treat a
      non-None ``email`` as authoritative without re-checking the
      claim.
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
    half-configured Apple env yields a clear 503 instead of a vague
    network or signing error."""
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


def _state_serializer() -> URLSafeTimedSerializer:
    """Build a serializer keyed on the session secret with the Apple-state
    salt.

    Constructed per-call so a rotated ``MGZ_PKMN_SESSION_SECRET`` takes
    effect on the next request — same semantics as the magic-link
    serializer in :mod:`api.auth.magic`."""
    return URLSafeTimedSerializer(resolve_session_secret(), salt=STATE_TOKEN_SALT)


def _build_state_token(*, link_user_id: int | None = None) -> str:
    """Sign an OAuth ``state`` value carrying a random nonce.

    The state token survives Apple's cross-site POST callback because
    it rides the POST body itself — no cookie required. Optionally
    carries ``link_user_id`` so the link-flow callback can attach the
    proved identity to the originally-signed-in user without needing a
    session cookie either (browsers won't send our ``SameSite=Lax``
    session cookie on Apple's cross-site POST).
    """
    payload: dict[str, Any] = {"n": secrets.token_urlsafe(16)}
    if link_user_id is not None:
        payload["link"] = link_user_id
    return _state_serializer().dumps(payload)


def _verify_state_token(token: str | None) -> dict[str, Any] | None:
    """Verify an OAuth ``state`` value and return its payload, or ``None``
    if the token is missing, tampered, or past its TTL. The caller is
    responsible for the bad-state HTTP shape (400 ``oauth_failed``)."""
    if not token:
        return None
    try:
        payload = _state_serializer().loads(token, max_age=STATE_TOKEN_MAX_AGE_SECONDS)
    except SignatureExpired:
        _log.info("apple oauth state rejected: expired")
        return None
    except BadSignature:
        _log.warning("apple oauth state rejected: bad signature")
        return None
    return payload if isinstance(payload, dict) else None


def _build_authorize_url(*, services_id: str, redirect_uri: str, state: str) -> str:
    """Construct the Apple authorize URL with ``response_mode=form_post``.

    ``name email`` returns the user's name + email on first
    authorization; Apple requires ``response_mode=form_post`` when
    scope is non-empty (otherwise it refuses with ``invalid_request``)
    — and the form-POST return is what makes the cookie-less state
    handling above necessary."""
    params = {
        "response_type": "code",
        "response_mode": "form_post",
        "client_id": services_id,
        "redirect_uri": redirect_uri,
        "scope": "name email",
        "state": state,
    }
    return f"{APPLE_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code_for_token(
    *,
    code: str,
    redirect_uri: str,
    services_id: str,
    client_secret: str,
) -> dict[str, Any]:
    """POST the authorization code to Apple's token endpoint.

    Factored out so tests can patch this single seam rather than
    mocking httpx at the transport layer (mirrors the existing
    :func:`fetch_apple_jwks` and :func:`verify_id_token` seams). Raises
    :class:`HTTPException(400, "oauth_failed")` for any HTTP error;
    the caller never sees an httpx exception."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                APPLE_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": services_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                },
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            _log.warning("apple token exchange failed: %s", exc)
            raise HTTPException(status_code=400, detail="oauth_failed") from exc
    return resp.json()


async def fetch_apple_jwks() -> dict:
    """Fetch Apple's public JWKS used to verify ``id_token`` signatures.

    Factored out so tests can patch this single seam rather than
    mocking httpx at the transport layer. Apple rotates the keys
    periodically — the JWKS endpoint always returns all currently-
    valid keys, so a per-request fetch is safe even though it costs an
    extra network round-trip."""
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


def _claim_is_true(value: Any) -> bool:
    """Apple's id_token boolean claims arrive as either Python booleans
    or the JSON strings ``"true"`` / ``"false"`` depending on the user
    pool (regular Apple IDs vs. Managed Apple Account / Work & School).
    Treat both shapes uniformly and reject anything else."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return False


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

    Apple documents that Managed Apple Account / Work & School users can
    return an ``email`` claim with ``email_verified=false`` — the user
    has the address attached to their Apple ID but Apple hasn't
    confirmed ownership. Treating that as verified would let two
    accounts claim the same address and merge incorrectly under
    ADR-0019's email anchor, so we drop the email entirely in that case
    (and the callback's ``no_verified_email`` branch fires uniformly).
    See https://developer.apple.com/documentation/signinwithapplerestapi/tokenresponse.
    """
    sub = str(claims.get("sub") or "")
    email = claims.get("email")
    email_verified = _claim_is_true(claims.get("email_verified"))
    email_str = (
        str(email).strip() if isinstance(email, str) and email.strip() and email_verified else None
    )

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


async def _process_apple_callback(
    *,
    request: Request,
    code: str,
    state_payload: dict[str, Any],
    user_form: str | None,
    redirect_uri: str,
) -> tuple[AppleProfile, str]:
    """Shared back half of the sign-in / link callbacks.

    Mints the client secret, exchanges ``code`` at Apple's token
    endpoint, verifies the returned ``id_token`` against Apple's JWKS,
    and returns the normalized profile + the Services ID (the caller
    needs the latter for logging and identity-resolution comments).
    The ``state_payload`` is unused inside the helper but takes part in
    the signature so callers can't accidentally call this before
    verifying state."""
    del state_payload  # state verification happens above; signature pins ordering
    services_id, team_id, key_id, pem = _read_apple_env()
    client_secret = _get_client_secret(
        services_id=services_id,
        team_id=team_id,
        key_id=key_id,
        private_key_pem=pem,
    )
    token = await exchange_code_for_token(
        code=code,
        redirect_uri=redirect_uri,
        services_id=services_id,
        client_secret=client_secret,
    )
    id_token_str = token.get("id_token") if isinstance(token, dict) else None
    if not id_token_str:
        raise HTTPException(status_code=400, detail="oauth_failed")
    claims = await verify_id_token(id_token_str, audience=services_id)
    profile = extract_profile(claims, user_payload=user_form)
    if not profile.email:
        raise HTTPException(status_code=400, detail="no_verified_email")
    if not profile.sub:
        raise HTTPException(status_code=400, detail="no_apple_sub")
    return profile, services_id


@router.get("/auth/apple/login")
async def apple_login(request: Request, _: AuthGate) -> RedirectResponse:
    """Start the Apple OAuth flow.

    Builds Apple's authorize URL with ``response_mode=form_post`` and a
    signed ``state`` token (no session storage), then 302s the browser
    to Apple. The user lands on ``/api/v1/auth/apple/callback`` via
    Apple's cross-site POST."""
    services_id, *_ = _read_apple_env()
    redirect_uri = str(request.url_for("apple_callback"))
    state = _build_state_token()
    return RedirectResponse(
        url=_build_authorize_url(
            services_id=services_id,
            redirect_uri=redirect_uri,
            state=state,
        ),
        status_code=302,
    )


@router.post("/auth/link/apple/start")
async def apple_link_start(
    request: Request,
    _: AuthGate,
    user: CurrentUserRequired,
) -> RedirectResponse:
    """Start an Apple OAuth flow for linking to the signed-in account.

    The link flow piggybacks ``link_user_id`` into the signed state
    token — Apple's cross-site POST callback won't carry our session
    cookie, so we can't rely on ``request.session["link_for_user_id"]``
    the way the GitHub / Google providers do. Trusting the signed
    state at callback time is the same trust model the magic-link
    flow uses for its email tokens."""
    services_id, *_ = _read_apple_env()
    redirect_uri = str(request.url_for("apple_link_callback"))
    state = _build_state_token(link_user_id=user.id)
    return RedirectResponse(
        url=_build_authorize_url(
            services_id=services_id,
            redirect_uri=redirect_uri,
            state=state,
        ),
        status_code=302,
    )


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
    pulls the fields out of the body. We verify the signed ``state``
    parameter ourselves (no session cookie required), exchange ``code``
    at Apple's token endpoint, verify the returned ``id_token`` against
    Apple's JWKS, extract the verified email + first-hit name, and run
    the standard upsert/merge.

    Errors:

    - User refused or Apple flagged an error → 400 ``oauth_failed``.
    - State missing / tampered / expired → 400 ``oauth_failed``.
    - Token exchange or JWKS / id_token verification failed → 400
      ``oauth_failed``.
    - ``id_token`` missing or unverified ``email`` claim → 400
      ``no_verified_email``.
    - ``id_token`` missing ``sub`` → 400 ``no_apple_sub``.
    """
    if error or not code:
        _log.warning("apple oauth callback returned error: %s", error or "no_code")
        raise HTTPException(status_code=400, detail="oauth_failed")
    state_payload = _verify_state_token(state)
    if state_payload is None:
        raise HTTPException(status_code=400, detail="oauth_failed")
    if "link" in state_payload:
        # A link-flow state token must not be replayable as a sign-in.
        # Refuse here so a leaked link state can't be used to sign in
        # someone else.
        _log.warning("apple oauth state rejected: link payload used on sign-in callback")
        raise HTTPException(status_code=400, detail="oauth_failed")

    redirect_uri = str(request.url_for("apple_callback"))
    profile, _services_id = await _process_apple_callback(
        request=request,
        code=code,
        state_payload=state_payload,
        user_form=user,
        redirect_uri=redirect_uri,
    )

    # Same identity-first resolver the other providers use. Apple's
    # ``sub`` is the stable per-(team, services-id, user) identifier;
    # private-relay addresses are deterministic per Services ID so the
    # email-fallback branch also stays consistent across re-signs.
    resolved = resolve_or_link_identity(
        db,
        provider=PROVIDER_APPLE,
        subject=profile.sub,
        email=profile.email,  # not-None enforced inside _process_apple_callback
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
    code: Annotated[str | None, Form()] = None,
    state: Annotated[str | None, Form()] = None,
    user_payload: Annotated[str | None, Form(alias="user")] = None,
    error: Annotated[str | None, Form()] = None,
) -> RedirectResponse:
    """Finish an Apple OAuth flow and attach the proved identity to the
    user named in the signed state token.

    Unlike the GitHub / Google link callbacks, this route does **not**
    require ``CurrentUserRequired`` — browsers won't send our
    ``SameSite=Lax`` session cookie on Apple's cross-site POST, so we
    can't authenticate the request via the session. Instead we trust
    the ``link_user_id`` baked into the signed state token (same trust
    model as the magic-link email tokens; the secret signing the state
    is the project's ``MGZ_PKMN_SESSION_SECRET``)."""
    if error or not code:
        _log.warning("apple link oauth callback returned error: %s", error or "no_code")
        raise HTTPException(status_code=400, detail="oauth_failed")
    state_payload = _verify_state_token(state)
    if state_payload is None:
        raise HTTPException(status_code=400, detail="oauth_failed")
    link_user_id_raw = state_payload.get("link")
    if not isinstance(link_user_id_raw, int):
        # A sign-in state token must not be replayable as a link
        # request — link payload missing means the caller is using the
        # wrong state for this route.
        raise HTTPException(status_code=400, detail="link_not_started")
    link_user_id = link_user_id_raw

    redirect_uri = str(request.url_for("apple_link_callback"))
    profile, _services_id = await _process_apple_callback(
        request=request,
        code=code,
        state_payload=state_payload,
        user_form=user_payload,
        redirect_uri=redirect_uri,
    )

    try:
        link_identity_to_user(
            db,
            user_id=link_user_id,
            provider=PROVIDER_APPLE,
            subject=profile.sub,
            email=profile.email,
        )
    except IdentityConflictError as exc:
        # Round-trip back into the Account modal with a recoverable error
        # rather than terminating on a JSON 409 page — see #536.
        return RedirectResponse(url=post_link_error_redirect(exc.provider), status_code=302)

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
    "STATE_TOKEN_MAX_AGE_SECONDS",
    "STATE_TOKEN_SALT",
    "AppleProfile",
    "exchange_code_for_token",
    "extract_profile",
    "fetch_apple_jwks",
    "mint_client_secret",
    "router",
    "verify_id_token",
]
