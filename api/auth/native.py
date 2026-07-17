"""Native-app session handoff for the iOS OAuth sign-in flow (#924).

A native app runs the OAuth dance inside ``ASWebAuthenticationSession``
(Apple's sanctioned in-app browser). That browser's cookie jar is not
readable by the app, and the auth session only completes when the flow
redirects to the app's custom URL scheme — so the normal
``302 /``-then-``Set-Cookie`` contract the SPA relies on never reaches
the app. This module bridges the gap with a one-time code handoff:

1. ``GET /api/v1/auth/{provider}/login?next=app`` — the provider login
   routes accept ``next=app`` and remember it for the callback (session
   cookie for GitHub / Google / Discord, since Authlib already stashes
   state there; the signed OAuth ``state`` token for Apple, whose
   cross-site form-POST callback can't rely on the session cookie).
2. The callback finishes the normal upsert/merge, then — instead of
   ``302 /`` with a ``Set-Cookie`` — mints a short-lived single-use code
   via :func:`mint_native_code` and 302s to
   ``mgzpkmn://auth/callback?code=<code>``. Errors redirect to
   ``mgzpkmn://auth/callback?error=<reason>`` using the same ``detail``
   strings the browser flow already raises as 400s.
3. ``POST /api/v1/auth/native/exchange`` verifies and burns the code,
   then hands back the session two ways at once: it writes
   ``request.session["user_id"]`` (so ``SessionMiddleware`` emits a
   normal ``Set-Cookie``) *and* returns the same signed cookie value in
   the response body, so a native client with no cookie jar can stash it
   in the Keychain and replay it as the ``mgz_pkmn_session`` cookie on
   every subsequent request. No new session model — same signed cookie,
   same expiry semantics as the browser flow.

The custom scheme is fixed server-side (never a client-supplied redirect
URL), so this isn't an open redirect. Codes are single-use and expire in
under a minute, so a leaked redirect URL in a device log is near-useless.
The exchange endpoint is unauthenticated by design (it *creates* the
session); rate-limiting it is tracked alongside the broader abuse-hardening
work in #710.
"""

from __future__ import annotations

import base64
import json
import logging
import secrets
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner, URLSafeTimedSerializer
from pydantic import BaseModel

from ..db.models import User
from .session import DbSession, auth_enabled, resolve_session_secret

_log = logging.getLogger(__name__)

#: Fixed server-side redirect target for the native handoff. Never
#: derived from a client-supplied value — that's what keeps this from
#: being an open redirect.
NATIVE_CALLBACK_SCHEME = "mgzpkmn://auth/callback"

#: Query-string value the provider login routes look for to switch into
#: the native handoff (``?next=app``).
NATIVE_NEXT_VALUE = "app"

#: Session key GitHub / Google / Discord logins use to carry the
#: ``next=app`` flag across the Authlib-managed OAuth round trip — same
#: session cookie Authlib already stashes its own state token in. Apple
#: can't use this (its callback is a cross-site POST that won't carry
#: our session cookie) so it bakes an equivalent flag into the signed
#: OAuth state token instead.
NATIVE_NEXT_SESSION_KEY = "auth_next_app"

#: itsdangerous salt for the one-time handoff code — domain-separated
#: from the magic-link and Apple-state salts that share the session
#: secret.
CODE_SALT = "auth-native-code"

#: Code lifetime. Long enough for the app to receive the redirect and
#: immediately call ``/auth/native/exchange``; short enough that a code
#: leaked via a device log is worthless by the time anyone could use it.
CODE_TTL_SECONDS = 60

router = APIRouter()


def _require_auth_enabled() -> None:
    """Refuse the native routes when the auth scaffold is off. Same 404
    posture as the other providers — see ``api/auth/github.py``."""
    if not auth_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


AuthGate = Annotated[None, Depends(_require_auth_enabled)]


def sync_native_next(request: Request, *, next_app: bool) -> None:
    """Set or clear the native-handoff flag for this login attempt.

    Called from the GitHub / Google / Discord login routes on every
    login, not just native ones. The flag lives in the same session
    cookie Authlib stashes its own OAuth state in, and that cookie can
    outlive a single attempt — e.g. an in-app native login started with
    ``ASWebAuthenticationSession`` (which by default shares Safari's
    cookie jar) gets abandoned, then the user later signs in from a
    plain browser tab on the same device with no ``?next=app``. If a
    non-native login only set the flag when true and left it alone
    otherwise, that abandoned attempt's flag would still be sitting in
    the session, and the *next* callback — a legitimate browser
    sign-in — would wrongly take the native branch and redirect to
    ``mgzpkmn://...`` instead of setting the session cookie. Always
    writing an explicit value (set or cleared) closes that gap."""
    if next_app:
        request.session[NATIVE_NEXT_SESSION_KEY] = True
    else:
        request.session.pop(NATIVE_NEXT_SESSION_KEY, None)


def consume_native_next(request: Request) -> bool:
    """Read and clear the native-handoff flag set by :func:`mark_native_next`."""
    return bool(request.session.pop(NATIVE_NEXT_SESSION_KEY, False))


def native_error_redirect(reason: str) -> RedirectResponse:
    """Build the ``mgzpkmn://auth/callback?error=<reason>`` redirect.

    ``reason`` is the same ``detail`` string the browser flow would have
    raised as a 400 (``oauth_failed``, ``no_verified_email``, etc.) so
    the two surfaces stay consistent."""
    return RedirectResponse(
        url=f"{NATIVE_CALLBACK_SCHEME}?error={reason}",
        status_code=302,
    )


def native_success_redirect(code: str) -> RedirectResponse:
    """Build the ``mgzpkmn://auth/callback?code=<code>`` redirect."""
    return RedirectResponse(
        url=f"{NATIVE_CALLBACK_SCHEME}?code={code}",
        status_code=302,
    )


def _code_serializer() -> URLSafeTimedSerializer:
    """Build a serializer keyed on the session secret with the native-code
    salt. Constructed per-call so a rotated ``MGZ_PKMN_SESSION_SECRET``
    takes effect on the next request — same pattern as the magic-link and
    Apple-state serializers."""
    return URLSafeTimedSerializer(resolve_session_secret(), salt=CODE_SALT)


#: Per-process record of already-burned code ``jti``s, mapped to the
#: unix timestamp after which they can be forgotten. Enforces single-use
#: within a code's short TTL. Per-process only, matching the tradeoff
#: `api/auth/apple.py`'s client-secret cache documents: the hosted demo
#: runs a single instance, and at a 60-second TTL a multi-instance deploy
#: replaying a code against a different instance is a narrow, low-value
#: attack even without cross-instance sharing.
_burned_jtis: dict[str, float] = {}


def _forget_expired_jtis(now: float) -> None:
    expired = [jti for jti, expiry in _burned_jtis.items() if expiry <= now]
    for jti in expired:
        del _burned_jtis[jti]


def mint_native_code(user_id: int) -> str:
    """Sign a one-time handoff code carrying ``user_id``.

    Public for test injection. Callers should mint exactly once per
    successful sign-in/link — a second mint for the same login attempt
    produces an independent, equally-valid code."""
    payload: dict[str, Any] = {"uid": user_id, "jti": secrets.token_urlsafe(16)}
    return _code_serializer().dumps(payload)


def burn_native_code(code: str) -> int | None:
    """Verify and consume a one-time handoff code.

    Returns the carried ``user_id``, or ``None`` if the code is missing,
    tampered, expired, or already used. Marks the code's ``jti`` as spent
    so a second exchange attempt (replay of a leaked redirect URL) fails
    even within the TTL window."""
    try:
        payload = _code_serializer().loads(code, max_age=CODE_TTL_SECONDS)
    except SignatureExpired:
        _log.info("native auth code rejected: expired")
        return None
    except BadSignature:
        _log.warning("native auth code rejected: bad signature")
        return None
    if not isinstance(payload, dict):
        return None
    jti = payload.get("jti")
    uid = payload.get("uid")
    if not isinstance(jti, str) or not isinstance(uid, int):
        return None

    now = time.time()
    _forget_expired_jtis(now)
    if jti in _burned_jtis:
        _log.warning("native auth code rejected: already used")
        return None
    _burned_jtis[jti] = now + CODE_TTL_SECONDS
    return uid


def _session_cookie_value(request: Request, session_data: dict[str, Any]) -> str:
    """Reproduce the exact cookie value Starlette's ``SessionMiddleware``
    would sign for ``session_data``.

    Mirrors ``starlette.middleware.sessions.SessionMiddleware`` byte for
    byte (``TimestampSigner`` over base64url(JSON), no salt) so the value
    handed back in the exchange response body is interchangeable with the
    ``Set-Cookie`` the same middleware emits on this response — a native
    client can replay it verbatim as the ``mgz_pkmn_session`` cookie.

    Signs with ``request.app.state.session_secret`` — the exact secret
    ``install_session_middleware`` handed to ``SessionMiddleware`` at
    construction — rather than calling :func:`resolve_session_secret`
    again. That function re-reads the env var on every call so magic-link
    / Apple-state tokens can pick up a rotated secret without a restart,
    but ``SessionMiddleware``'s own ``secret_key`` is fixed at mount
    time; re-resolving here would silently diverge from the cookie the
    middleware actually signs if the env var changed since startup."""
    signer = TimestampSigner(request.app.state.session_secret)
    encoded = base64.b64encode(json.dumps(session_data).encode("utf-8"))
    return signer.sign(encoded).decode("utf-8")


class NativeExchangeIn(BaseModel):
    """Payload for ``POST /auth/native/exchange``."""

    code: str


class NativeExchangeOut(BaseModel):
    """Response envelope for ``POST /auth/native/exchange``.

    ``session_token`` is the signed ``mgz_pkmn_session`` cookie value —
    store it in the Keychain and send it back as
    ``Cookie: mgz_pkmn_session=<session_token>`` on every request."""

    session_token: str


@router.post("/auth/native/exchange", response_model=NativeExchangeOut)
def native_exchange(
    payload: NativeExchangeIn,
    request: Request,
    db: DbSession,
    _: AuthGate,
) -> NativeExchangeOut:
    """Trade a one-time handoff code for a session.

    Unauthenticated by design — it's how the app *acquires* a session,
    the same way the browser callbacks are unauthenticated. Writes
    ``request.session["user_id"]`` so ``SessionMiddleware`` also emits a
    normal ``Set-Cookie`` (harmless for a client with no cookie jar, and
    keeps this route indistinguishable from the other auth routes for
    anything downstream that inspects the response)."""
    user_id = burn_native_code(payload.code)
    if user_id is None:
        raise HTTPException(status_code=400, detail="invalid_or_expired_code")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="invalid_or_expired_code")

    request.session["user_id"] = user.id
    return NativeExchangeOut(session_token=_session_cookie_value(request, dict(request.session)))


__all__ = [
    "CODE_SALT",
    "CODE_TTL_SECONDS",
    "NATIVE_CALLBACK_SCHEME",
    "NATIVE_NEXT_SESSION_KEY",
    "NATIVE_NEXT_VALUE",
    "NativeExchangeIn",
    "NativeExchangeOut",
    "burn_native_code",
    "consume_native_next",
    "mint_native_code",
    "native_error_redirect",
    "native_success_redirect",
    "router",
    "sync_native_next",
]
