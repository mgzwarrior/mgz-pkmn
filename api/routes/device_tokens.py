"""`/api/v1/device-tokens` — push notification device registration (#974).

First slice of the push notification epic (#946): registration and storage
only. No preferences (#975) or delivery (#976) yet — a registered token
currently goes nowhere.

Endpoints:

- ``GET    /device-tokens``               the user's registered devices
- ``POST   /device-tokens``               register a device (upsert by token)
- ``DELETE /device-tokens/{device_token}``  deregister a device
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth.session import current_user_or_default
from ..db.models import DeviceToken, User
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class DeviceTokenOut(BaseModel):
    device_token: str
    platform: str
    created_at: str
    last_seen_at: str


class DeviceTokensOut(BaseModel):
    devices: list[DeviceTokenOut]


class DeviceTokenRegister(BaseModel):
    device_token: str = Field(min_length=1, max_length=255)
    platform: str = Field(min_length=1, max_length=32)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/device-tokens")
def list_devices(db: DbSession, current_user: CurrentUser) -> dict:
    """The user's registered devices, most recently seen first."""
    rows = db.scalars(
        select(DeviceToken)
        .where(DeviceToken.user_id == current_user.id)
        .order_by(DeviceToken.last_seen_at.desc())
    ).all()
    devices = [
        DeviceTokenOut(
            device_token=r.device_token,
            platform=r.platform,
            created_at=r.created_at.isoformat(),
            last_seen_at=r.last_seen_at.isoformat(),
        )
        for r in rows
    ]
    return DeviceTokensOut(devices=devices).model_dump()


@router.post("/device-tokens", status_code=204)
def register_device(
    req: DeviceTokenRegister,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Register a device. Upsert by ``device_token``: re-registering an
    existing token (same device, another sign-in) reassigns it to the
    current user and refreshes ``platform`` / ``last_seen_at`` rather than
    erroring or duplicating — a device belongs to one signed-in user at a
    time, unlike the many-rows-per-user shape of :class:`FavoriteSet`."""
    now = datetime.now(UTC)
    existing = db.scalar(select(DeviceToken).where(DeviceToken.device_token == req.device_token))
    if existing is not None:
        existing.user_id = current_user.id
        existing.platform = req.platform
        existing.last_seen_at = now
        db.commit()
        return Response(status_code=204)

    db.add(
        DeviceToken(
            user_id=current_user.id,
            device_token=req.device_token,
            platform=req.platform,
            created_at=now,
            last_seen_at=now,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Lost a race against a concurrent first-registration of the same
        # token; fall back to the reassign path above.
        db.rollback()
        db.execute(
            update(DeviceToken)
            .where(DeviceToken.device_token == req.device_token)
            .values(user_id=current_user.id, platform=req.platform, last_seen_at=now)
        )
        db.commit()
    return Response(status_code=204)


@router.delete("/device-tokens/{device_token}", status_code=204)
def deregister_device(
    device_token: str,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Deregister a device. A no-op (still 204) when it wasn't registered."""
    db.execute(
        delete(DeviceToken).where(
            DeviceToken.user_id == current_user.id,
            DeviceToken.device_token == device_token,
        )
    )
    db.commit()
    return Response(status_code=204)
