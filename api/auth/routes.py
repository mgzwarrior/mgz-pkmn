"""Auth HTTP surface — currently just ``GET /api/v1/me`` and
``POST /api/v1/auth/logout``.

Foundation slice (#407). Provider sub-issues (#408 GitHub / #409
magic-link / #410 Google) extend this router with ``/auth/<provider>/...``
routes once they land."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..db.models import DEFAULT_USER_ID, User, UserIdentity
from .session import CurrentUserRequired, DbSession, auth_enabled, get_current_user

router = APIRouter()

CurrentUser = Annotated[User | None, Depends(get_current_user)]


def _require_auth_enabled() -> None:
    """Use the provider routes' 404-when-auth-off posture for management."""
    if not auth_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


AuthGate = Annotated[None, Depends(_require_auth_enabled)]


class MeIdentity(BaseModel):
    """One sign-in method attached to the current user."""

    id: int
    provider: str
    email: str | None
    linked_at: datetime


class MeUser(BaseModel):
    """Identity payload for the current request's user."""

    id: int
    email: str | None
    display_name: str | None
    identities: list[MeIdentity] = Field(default_factory=list)


class MeOut(BaseModel):
    """``GET /api/v1/me`` envelope.

    Always returned with 200 so a single round-trip tells the SPA both
    *who* the visitor is and *whether sign-in is even available* on this
    deploy. ``user`` is the default-user payload in self-host mode (auth
    off), so the SPA's "is there an identified user?" check is a single
    null comparison across modes. ``auth_enabled`` gates the SignInChip
    itself — self-host has no sign-in surface to render."""

    user: MeUser | None
    auth_enabled: bool


@router.get("/me", response_model=MeOut)
def me(user: CurrentUser, db: DbSession) -> MeOut:
    """Return the current user envelope.

    Three branches:

    - **Auth on, signed in** → ``{user: <signed-in row>, auth_enabled: true}``
    - **Auth on, signed out** → ``{user: null, auth_enabled: true}``
    - **Auth off (self-host)** → ``{user: <default user>, auth_enabled: false}``

    Self-host returns the default user (rather than ``null``) so the
    SPA's collections / wishlists chip-visibility check — ``user !=
    null`` — works identically across modes without the chip having to
    branch on ``auth_enabled``."""
    enabled = auth_enabled()
    if user is None and not enabled:
        # Self-host implicit identity: surface the sentinel row so the
        # SPA treats the visitor as "signed in" for chip-visibility
        # purposes. The row's email / display_name are NULL on a fresh
        # install; the SPA already handles that shape.
        default = db.get(User, DEFAULT_USER_ID)
        if default is not None:
            return MeOut(
                user=MeUser(
                    id=default.id,
                    email=default.email,
                    display_name=default.display_name,
                    identities=[],
                ),
                auth_enabled=False,
            )
    identity_rows = (
        db.scalars(
            select(UserIdentity).where(UserIdentity.user_id == user.id).order_by(UserIdentity.id)
        ).all()
        if user is not None
        else []
    )
    identities = [
        MeIdentity(
            id=identity.id,
            provider=identity.provider,
            email=identity.email,
            linked_at=identity.linked_at,
        )
        for identity in identity_rows
    ]
    return MeOut(
        user=(
            MeUser(
                id=user.id,
                email=user.email,
                display_name=user.display_name,
                identities=identities,
            )
            if user is not None
            else None
        ),
        auth_enabled=enabled,
    )


@router.post("/auth/logout", status_code=204)
def logout(request: Request) -> Response:
    """Clear the session cookie. Idempotent — calling on an already-anon
    session is a no-op 204."""
    request.session.clear()
    return Response(status_code=204)


@router.delete("/auth/identities/{identity_id}", status_code=204)
def unlink_identity(
    identity_id: int,
    db: DbSession,
    _: AuthGate,
    user: CurrentUserRequired,
) -> Response:
    """Remove a linked sign-in method, preserving at least one."""
    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.id == identity_id,
            UserIdentity.user_id == user.id,
        )
    )
    if identity is None:
        raise HTTPException(status_code=404, detail="identity not found")

    identity_count = db.scalar(
        select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == user.id)
    )
    if identity_count is None or identity_count <= 1:
        raise HTTPException(status_code=400, detail="cannot_unlink_last_identity")

    db.delete(identity)
    return Response(status_code=204)
