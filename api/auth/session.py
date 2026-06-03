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

from fastapi import Depends, FastAPI, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from ..db.models import User
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

    - Env var set → use it.
    - Env var missing in production → ``RuntimeError`` (refuses to boot).
    - Env var missing in dev → log a loud warning, return the fixed
      dev fallback. Sessions issued under the fallback are not portable
      across machines / restarts that flip back to a real secret."""
    secret = os.environ.get(SESSION_SECRET_ENV, "").strip()
    if secret:
        return secret
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
    Mounting unconditionally (even when auth is off) is harmless — the
    middleware just attaches a ``request.session`` ``MutableMapping``
    that nothing writes to — and keeps the request pipeline shape
    consistent across the two modes so tests don't have to special-case
    the off branch."""
    app.add_middleware(
        SessionMiddleware,
        secret_key=resolve_session_secret(),
        session_cookie=SESSION_COOKIE_NAME,
        same_site="lax",
        https_only=_is_production(),
    )


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
