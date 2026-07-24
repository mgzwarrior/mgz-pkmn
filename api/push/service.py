"""Orchestrates one notification send across a user's devices (#976).

The one seam future callers (price-drop alerts, show reminders — the
notification types #975 already seeded) need: checks the per-user,
per-type preference before sending anything, fans out to every
registered device, and prunes rows the backend reports dead rather
than retrying forever.
"""

from __future__ import annotations

import logging

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db.models import DeviceToken, NotificationPreference
from .apns import ApnsSender
from .base import PushSender

_log = logging.getLogger(__name__)

_default_sender: PushSender | None = None


def _get_default_sender() -> PushSender:
    global _default_sender
    if _default_sender is None:
        _default_sender = ApnsSender()
    return _default_sender


async def send_notification(
    db: Session,
    user_id: int,
    notification_type: str,
    payload: dict,
    *,
    sender: PushSender | None = None,
) -> int:
    """Send ``payload`` to every device ``user_id`` has registered.

    Skips entirely when the user has an explicit opt-out row for
    ``notification_type`` (missing row means opt-in-by-default, matching
    ``api.routes.notification_preferences``' seeding contract). Returns
    the count of devices the payload was actually delivered to; a device
    APNs reports dead (:attr:`PushResult.invalid_token`) is removed from
    :class:`DeviceToken` rather than counted or retried."""
    preference = db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id,
            NotificationPreference.notification_type == notification_type,
        )
    )
    if preference is not None and not preference.enabled:
        return 0

    devices = db.scalars(select(DeviceToken).where(DeviceToken.user_id == user_id)).all()
    if not devices:
        return 0

    active_sender = sender if sender is not None else _get_default_sender()
    delivered = 0
    for device in devices:
        result = await active_sender.send(device.device_token, payload)
        if result.delivered:
            delivered += 1
            continue
        if result.invalid_token:
            db.execute(delete(DeviceToken).where(DeviceToken.id == device.id))
            db.commit()
            continue
        _log.warning(
            "push not delivered user_id=%s type=%s reason=%s",
            user_id,
            notification_type,
            result.reason,
        )
    return delivered


__all__ = ["send_notification"]
