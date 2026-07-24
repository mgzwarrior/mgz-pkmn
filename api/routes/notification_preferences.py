"""`/api/v1/notification-preferences` — per-user, per-type push opt-in (#975).

Second slice of the push notification epic (#946). Storage and CRUD only —
delivery (#976) is a follow-up and doesn't read this table yet.

``notification_type`` is a free-form string key, not an enum tied to
delivery logic (see :data:`KNOWN_NOTIFICATION_TYPES`), so a new type is a
seeded default row, not a migration.

Endpoints:

- ``GET   /notification-preferences``                the user's preference
  rows, one per known type, opt-in by default
- ``PATCH /notification-preferences/{notification_type}``  toggle one type
  (upserts — a type introduced after the user's last device registration
  is created on first touch rather than 404ing)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth.session import current_user_or_default
from ..db.models import NotificationPreference, User
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]

#: Notification types known today (iOS #143: price-drop alerts, show
#: reminders). Seeded opt-in per user the first time a device registers
#: (see `ensure_default_preferences`, called from
#: `api.routes.device_tokens.register_device`). Adding a type here is a
#: code change picked up by the next registration/toggle — not a migration.
KNOWN_NOTIFICATION_TYPES: tuple[str, ...] = ("price_drop", "show_reminder")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class NotificationPreferenceOut(BaseModel):
    notification_type: str
    enabled: bool


class NotificationPreferencesOut(BaseModel):
    preferences: list[NotificationPreferenceOut]


class NotificationPreferenceUpdate(BaseModel):
    enabled: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def ensure_default_preferences(db: Session, user_id: int) -> None:
    """Seed opt-in rows for any :data:`KNOWN_NOTIFICATION_TYPES` the user
    doesn't already have a row for. Called on device registration — by the
    time a device registers, the user has already granted OS-level push
    permission, so default-on is the expected behavior; idempotent, so a
    second device registering for the same user is a no-op."""
    existing = set(
        db.scalars(
            select(NotificationPreference.notification_type).where(
                NotificationPreference.user_id == user_id
            )
        ).all()
    )
    missing = [t for t in KNOWN_NOTIFICATION_TYPES if t not in existing]
    if not missing:
        return

    now = datetime.now(UTC)
    for notification_type in missing:
        db.add(
            NotificationPreference(
                user_id=user_id,
                notification_type=notification_type,
                enabled=True,
                created_at=now,
                updated_at=now,
            )
        )
    try:
        db.commit()
    except IntegrityError:
        # Lost a race against a concurrent registration seeding the same
        # rows; the other write already got there.
        db.rollback()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/notification-preferences")
def list_preferences(db: DbSession, current_user: CurrentUser) -> dict:
    """The user's preference rows. Seeds any missing known type on the fly
    (covers a type added after the user's last device registration) so the
    response always covers every known type."""
    ensure_default_preferences(db, current_user.id)
    rows = db.scalars(
        select(NotificationPreference)
        .where(NotificationPreference.user_id == current_user.id)
        .order_by(NotificationPreference.notification_type)
    ).all()
    preferences = [
        NotificationPreferenceOut(notification_type=r.notification_type, enabled=r.enabled)
        for r in rows
    ]
    return NotificationPreferencesOut(preferences=preferences).model_dump()


@router.patch("/notification-preferences/{notification_type}")
def update_preference(
    notification_type: Annotated[str, Path(min_length=1, max_length=64)],
    req: NotificationPreferenceUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Toggle one type. Upserts: a type with no existing row (unknown, or
    known but not yet seeded for this user) is created rather than 404ing —
    the set of types is data, not a fixed schema."""
    row = db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.user_id == current_user.id,
            NotificationPreference.notification_type == notification_type,
        )
    )
    now = datetime.now(UTC)
    if row is not None:
        row.enabled = req.enabled
        row.updated_at = now
        db.commit()
        return NotificationPreferenceOut(
            notification_type=notification_type, enabled=row.enabled
        ).model_dump()

    row = NotificationPreference(
        user_id=current_user.id,
        notification_type=notification_type,
        enabled=req.enabled,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Lost a race against a concurrent first-write for this type; fall
        # back to the update path above.
        db.rollback()
        existing = db.scalar(
            select(NotificationPreference).where(
                NotificationPreference.user_id == current_user.id,
                NotificationPreference.notification_type == notification_type,
            )
        )
        assert existing is not None
        existing.enabled = req.enabled
        existing.updated_at = now
        db.commit()
        row = existing
    return NotificationPreferenceOut(
        notification_type=notification_type, enabled=row.enabled
    ).model_dump()


__all__ = ["KNOWN_NOTIFICATION_TYPES", "ensure_default_preferences", "router"]
