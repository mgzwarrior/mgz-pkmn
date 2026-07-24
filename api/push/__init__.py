"""Push notification delivery (#976, epic #946).

Final slice of the push notification epic: registration (#974) and
preferences (#975) were inert without something that actually sends.
``send_notification`` is the one seam callers need — it reads the
per-user, per-type opt-in, fans out to every registered device, and
prunes device rows the delivery backend reports dead.
"""

from __future__ import annotations

from .base import PushResult, PushSender
from .service import send_notification

__all__ = ["PushResult", "PushSender", "send_notification"]
