"""Auth scaffolding for the hosted demo.

Foundation slice (#407) of the [ADR-0019](../../docs/adr/0019-hosted-demo-identity-and-auth.md)
auth epic. Provides:

- ``MGZ_PKMN_AUTH_ENABLED`` env-driven on/off (default off so self-hosters
  keep today's anonymous-everywhere behaviour without configuration).
- A ``SessionMiddleware`` (Starlette's) bound to ``MGZ_PKMN_SESSION_SECRET``.
- ``get_current_user`` FastAPI dependency that resolves the session-bound
  ``user_id`` to a ``User`` row.
- A small router exposing ``GET /api/v1/me`` so the SPA can ask "who am I?".

Provider routes (GitHub, magic-link, Google, Discord) live in sibling modules added
by their respective sub-issues."""

from .session import (
    AUTH_ENABLED_ENV,
    SESSION_COOKIE_NAME,
    SESSION_SECRET_ENV,
    auth_enabled,
    get_current_user,
    install_session_middleware,
    resolve_session_secret,
)

__all__ = [
    "AUTH_ENABLED_ENV",
    "SESSION_COOKIE_NAME",
    "SESSION_SECRET_ENV",
    "auth_enabled",
    "get_current_user",
    "install_session_middleware",
    "resolve_session_secret",
]
