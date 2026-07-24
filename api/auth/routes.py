"""Auth HTTP surface — currently just ``GET /api/v1/me`` and
``POST /api/v1/auth/logout``.

Foundation slice (#407). Provider sub-issues (#408 GitHub / #409
magic-link / #410 Google) extend this router with ``/auth/<provider>/...``
routes once they land."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..db.models import (
    DEFAULT_USER_ID,
    Binder,
    Collection,
    FavoriteSet,
    FavoriteSpecies,
    Run,
    SwipeSeen,
    User,
    UserIdentity,
    Wishlist,
)
from .session import (
    CurrentUserRequired,
    DbSession,
    auth_enabled,
    current_user_or_default,
    get_current_user,
)

CurrentUserOrDefault = Annotated[User, Depends(current_user_or_default)]

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
    #: Whether the user has finished (or skipped) the first-login onboarding
    #: survey (#742) — the SPA shows the favorite-Pokémon pop-up when false.
    onboarding_completed: bool = False


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
                    onboarding_completed=default.onboarding_completed_at is not None,
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
                onboarding_completed=user.onboarding_completed_at is not None,
            )
            if user is not None
            else None
        ),
        auth_enabled=enabled,
    )


@router.post("/me/onboarding/complete", status_code=204)
def complete_onboarding(db: DbSession, user: CurrentUserOrDefault) -> Response:
    """Mark the first-login onboarding survey done (#742).

    Idempotent — re-completing leaves the original timestamp in place, so a
    double-submit (or a "Skip" after a "Done") never re-opens the pop-up. Works
    in self-host mode too: the sentinel default user can finish onboarding."""
    if user.onboarding_completed_at is None:
        user.onboarding_completed_at = datetime.now(UTC)
        db.commit()
    return Response(status_code=204)


@router.post("/auth/logout", status_code=204)
def logout(request: Request) -> Response:
    """Clear the session cookie. Idempotent — calling on an already-anon
    session is a no-op 204."""
    request.session.clear()
    return Response(status_code=204)


@router.delete("/me", status_code=204)
def delete_me(
    request: Request,
    db: DbSession,
    _: AuthGate,
    user: CurrentUserRequired,
) -> Response:
    """Permanently delete the signed-in user's account.

    **Irreversible — there is no admin override or recovery path.**
    Cascades every user-owned record: lookup runs (saved searches),
    collections, wishlists, binders, favorite sets/species, swipe
    history, and linked sign-in identities. Clears the session cookie
    on the way out, so the browser can't keep acting as this account,
    and re-authenticating with a previously-linked provider mints a
    fresh, empty account rather than resurrecting this one."""
    user_id = user.id

    for run in db.scalars(select(Run).where(Run.user_id == user_id)).all():
        db.delete(run)
    for collection in db.scalars(select(Collection).where(Collection.user_id == user_id)).all():
        db.delete(collection)
    for wishlist in db.scalars(select(Wishlist).where(Wishlist.user_id == user_id)).all():
        db.delete(wishlist)
    for binder in db.scalars(select(Binder).where(Binder.user_id == user_id)).all():
        db.delete(binder)
    for seen in db.scalars(select(SwipeSeen).where(SwipeSeen.user_id == user_id)).all():
        db.delete(seen)
    for fav_set in db.scalars(select(FavoriteSet).where(FavoriteSet.user_id == user_id)).all():
        db.delete(fav_set)
    for fav_species in db.scalars(
        select(FavoriteSpecies).where(FavoriteSpecies.user_id == user_id)
    ).all():
        db.delete(fav_species)

    # Cascades `identities` via the ORM relationship (User.identities,
    # cascade="all, delete-orphan").
    db.delete(user)
    db.flush()
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
