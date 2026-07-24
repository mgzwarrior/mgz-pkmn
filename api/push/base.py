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
    to prune a device row — reserved for the unambiguous "this token is
    dead" response (APNs' HTTP 410 / ``Unregistered``), not a config
    error (bad topic, wrong environment) or a transient failure, both
    of which are logged and left alone rather than retried forever or
    mistaken for a dead device."""

    delivered: bool
    invalid_token: bool
    reason: str | None = None


class PushSender(Protocol):
    """Send one push payload to one device token."""

    async def send(self, device_token: str, payload: dict) -> PushResult: ...
