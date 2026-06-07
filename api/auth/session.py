"""Signed-cookie session handling for the hosted-demo auth surface.

ADR-0019 pins the session model: an HttpOnly, SameSite=Lax cookie signed
with itsdangerous, carrying nothing but the ``user_id`` of the signed-in
user. No server-side session store — the cookie is the session.

Provider sub-issues (#408 / #409 / #410) write the cookie via
``request.session["user_id"] = user.id``; this module's
``get_current_user`` reads it back into a ``User`` ORM row for downstream
routes."""

from __future__ import annotations

import logging
import os
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from ..db.models import DEFAULT_USER_ID, User
from ..db.session import get_db

_log = logging.getLogger(__name__)

#: Env var that gates the whole auth scaffold. Off-default so self-hosted
#: copies of the project keep today's anonymous-everywhere behaviour
#: without anyone configuring anything new.
AUTH_ENABLED_ENV = "MGZ_PKMN_AUTH_ENABLED"

#: Env var holding the itsdangerous signing secret. Production deploys
#: with auth on **must** set this; missing in dev triggers a loud warning
#: and a fixed dev-only fallback.
SESSION_SECRET_ENV = "MGZ_PKMN_SESSION_SECRET"

#: Cookie name. Kept short and project-prefixed to avoid colliding with
#: other apps a self-hoster might run on the same domain.
SESSION_COOKIE_NAME = "mgz_pkmn_session"

#: Fixed fallback used **only** when `MGZ_PKMN_AUTH_ENABLED` is on but
#: `MGZ_PKMN_SESSION_SECRET` is unset *and* `MGZ_PKMN_ENV` is not
#: ``production``. Burned into the code on purpose: it's not a secret if
#: it's checked in. Production must set the real env var.
_DEV_SESSION_SECRET_FALLBACK = "dev-only-not-secret-do-not-use-in-production"


def auth_enabled() -> bool:
    """True when ``MGZ_PKMN_AUTH_ENABLED`` is a truthy string.

    Same parse rules as the warm-on-startup gates in ``api.main`` —
    accepts ``1`` / ``true`` / ``True``. Anything else (including the
    var being unset) reads as off."""
    return os.environ.get(AUTH_ENABLED_ENV, "").strip() in ("1", "true", "True")


def _is_production() -> bool:
    """True when ``MGZ_PKMN_ENV=production``. Used only to decide
    whether a missing session secret is fatal."""
    return os.environ.get("MGZ_PKMN_ENV", "").strip().lower() == "production"


def resolve_session_secret() -> str:
    """Return the itsdangerous signing key for ``SessionMiddleware``.

    Behaviour depends on whether auth is actually on:

    - **Auth off** → return the dev fallback silently. The middleware
      still mounts (so ``request.session`` always exists for downstream
      routes that expect it), but nothing reads or writes the session,
      so the secret is never exercised. Self-hosters with the default
      off-posture don't need to configure anything and don't see a
      startup warning for a secret they wouldn't use.
    - **Auth on, env var set** → use it.
    - **Auth on, env var missing, production** → ``RuntimeError``
      (refuses to boot). Production sessions must be portable across
      redeploys, which requires a stable real secret.
    - **Auth on, env var missing, dev** → loud warning + dev fallback.
      Sessions issued under the fallback are not portable across
      machines / restarts that flip back to a real secret."""
    secret = os.environ.get(SESSION_SECRET_ENV, "").strip()
    if secret:
        return secret
    if not auth_enabled():
        # Mount still happens for consistent middleware shape; the
        # placeholder will never be used to verify a real session.
        return _DEV_SESSION_SECRET_FALLBACK
    if _is_production():
        raise RuntimeError(
            f"{SESSION_SECRET_ENV} must be set when {AUTH_ENABLED_ENV}=1 in production"
        )
    # Inline the env var *name* as a literal rather than the
    # `SESSION_SECRET_ENV` constant — CodeQL's `py/clear-text-logging-
    # sensitive-data` rule taints any identifier suffixed `_SECRET` as
    # a credential, even when it only carries the env var's *name*.
    # Burning the literal in here keeps the message identical and
    # avoids the false-positive alert.
    _log.warning(
        "MGZ_PKMN_SESSION_SECRET unset — falling back to a hard-coded dev secret. "
        "Set the env var to a stable random string for any environment that "
        "ships real sessions across redeploys."
    )
    return _DEV_SESSION_SECRET_FALLBACK


def install_session_middleware(app: FastAPI) -> None:
    """Mount Starlette's ``SessionMiddleware`` on ``app``.

    Called from ``api.main`` exactly once during app construction.
    Mounts unconditionally so ``request.session`` always exists for
    downstream routes — but ``resolve_session_secret`` returns a silent
    dev placeholder when auth is off, so self-hosters with the default
    off-posture never need to configure ``MGZ_PKMN_SESSION_SECRET`` and
    don't see a warning for a secret nothing reads. The real
    production-refusal / dev-warning kicks in only when auth is on,
    which is the only path that ever exercises the secret."""
    app.add_middleware(
        SessionMiddleware,
        secret_key=resolve_session_secret(),
        session_cookie=SESSION_COOKIE_NAME,
        same_site="lax",
        https_only=_is_production(),
    )
    _log.info("SessionMiddleware mounted (auth enabled=%s)", auth_enabled())


# FastAPI dependency aliases keep ``Depends(...)`` out of default-arg
# position (ruff B008) while preserving the runtime injection contract.
DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: DbSession) -> User | None:
    """Resolve ``request.session["user_id"]`` to a ``User`` row.

    Returns ``None`` when:

    - ``MGZ_PKMN_AUTH_ENABLED`` is off (whole scaffold disabled).
    - The session cookie carries no ``user_id`` (anonymous visitor).
    - The cookie's ``user_id`` no longer exists in the DB (deleted
      account, dev DB reset, etc.).

    Returning ``None`` rather than raising lets every callsite decide
    whether anonymous is allowed (lookups, the saved-search list) or
    whether a 401 should fire (saving a search)."""
    if not auth_enabled():
        return None
    raw_id = request.session.get("user_id")
    if raw_id is None:
        return None
    try:
        user_id = int(raw_id)
    except (TypeError, ValueError):
        return None
    return db.scalar(select(User).where(User.id == user_id))


CurrentUserOptional = Annotated[User | None, Depends(get_current_user)]


def current_user_or_default(user: CurrentUserOptional, db: DbSession) -> User:
    """Resolve the user a per-account resource should be scoped to.

    Used by collections / wishlists / runs — resources that have to
    attach to a real user row in production but should keep working
    anonymously on a self-host install.

    - **Auth on, signed in** → return the signed-in `User`.
    - **Auth on, anonymous** → raise 401 so the SPA can prompt sign-in.
    - **Auth off (self-host)** → return the sentinel ``default`` user
      seeded by the first migration. Preserves the anonymous-everywhere
      contract self-hosters configured-for-nothing rely on (ADR-0019).

    Distinct from ``get_current_user`` on purpose: that one answers
    "who is the visitor" (and ``None`` is a legitimate answer for /me).
    This one answers "which user row do I attach this resource to" —
    and ``None`` is never a legitimate answer for that question."""
    if user is not None:
        return user
    if auth_enabled():
        raise HTTPException(status_code=401, detail="sign-in required")
    default = db.get(User, DEFAULT_USER_ID)
    if default is None:
        # Defensive: the initial migration seeds this row. Reaching the
        # branch means the DB was tampered with — surface it instead of
        # 500-ing later inside the route.
        raise HTTPException(status_code=500, detail="default user row missing from database")
    return default
