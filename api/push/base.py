"""The delivery interface every push backend implements (#976).

Kept deliberately narrow — one method, one result shape — so an
FCM/Android backend can be added later without touching
``service.send_notification`` or the registration/preference code
(#974, #975)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class PushResult:
    """Outcome of one ``PushSender.send`` call.

    ``invalid_token`` is the signal ``service.send_notification`` uses
    to prune a device row (APNs' ``BadDeviceToken`` / ``Unregistered``
    responses, or an HTTP 410) — distinct from a transient failure
    (network error, APNs outage), which is logged and left alone rather
    than retried forever."""

    delivered: bool
    invalid_token: bool
    reason: str | None = None


class PushSender(Protocol):
    """Send one push payload to one device token."""

    async def send(self, device_token: str, payload: dict) -> PushResult: ...
