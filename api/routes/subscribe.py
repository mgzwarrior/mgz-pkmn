"""POST /api/v1/subscribe — newsletter signup, backed by Resend.

Replaces the marketing site's old Buttondown embed (ADR-0014) with a
server-side signup, per
[ADR-0028](../../docs/adr/0028-resend-for-subscriptions-and-automations.md).
Each signup does two writes to Resend, both with the API key kept server-side:

1. **Create a contact** in the audience (``RESEND_AUDIENCE_ID``) with the
   reason stamped onto its custom ``properties`` map. This is the durable
   record — it's what gives us a unified audience for segmentation, exports,
   and a single unsubscribe surface (the same audience and sending domain used
   for transactional magic-link mail, [api/auth/magic.py](../auth/magic.py)).
2. **Send the ``New Signup`` event** to Resend's events API. The welcome-drip
   Automation triggers on this custom event (not on "contact added"), so the
   contact-create alone never starts the drip — the event is what fires it. An
   event-triggered Automation exposes its payload under the ``event.*``
   namespace, so the reason rides in ``payload.reason`` and the Automation
   branches on ``event.reason`` into one of three 3-email welcome tracks:
   ``collector`` (north star), ``show`` (dealers / show-goers), and
   ``builder`` (open-source contributors).

The event name here must match the Automation trigger's ``event_name`` exactly
(operator state in the Resend dashboard, like the audience and API key).

Resend only accepts a contact ``properties`` key that's been pre-defined on the
audience, so the ``reason`` Contact Property (type ``string``) must exist before
the first signup or the contact-create 502s — that one-time setup is step 4 of
the ADR-0028 runbook, alongside the audience, API key, and Automation.

Configuration mirrors the magic-link posture: a 503 with a setup hint when the
two env vars are missing (a deploy-time misconfiguration, never a runtime
signal), and a 502 when either Resend call rejects or is unreachable.
"""

from __future__ import annotations

import logging
import os
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel

_log = logging.getLogger(__name__)

#: Resend REST base. Contacts live under an audience
#: (``POST /audiences/{audience_id}/contacts``); custom events that drive
#: Automations are sent to ``POST /events/send``.
RESEND_API_BASE = "https://api.resend.com"

#: Bearer token for the Resend API and the audience the contact is created in.
#: Both ``sync: false`` secrets in render.yaml; the route 503s when either is
#: unset so a misconfigured deploy is obvious rather than silently dropping
#: signups.
RESEND_API_KEY_ENV = "RESEND_API_KEY"
RESEND_AUDIENCE_ID_ENV = "RESEND_AUDIENCE_ID"

#: Custom-event name that triggers the welcome-drip Automation. Must match the
#: Automation trigger's ``event_name`` in the Resend dashboard verbatim — if
#: they drift, signups land as contacts but the drip never fires. Operator
#: state, so it lives here as a constant (like the reason literals below), not
#: an env var.
RESEND_SIGNUP_EVENT = "New Signup"

#: The three welcome tracks. Kept in sync with the Automation's branch
#: conditions on ``event.reason`` and the reason chips in
#: site/src/components/EmailSignup.astro.
Reason = Literal["collector", "show", "builder"]


router = APIRouter()


class SubscribeIn(BaseModel):
    """Payload for ``POST /subscribe``.

    Email is a bare ``str`` (not ``pydantic.EmailStr``) to match
    `MagicRequestIn` in [api/auth/magic.py](../auth/magic.py): the marketing
    form already does HTML5 ``type=email`` validation, and Resend validates
    server-side, so we don't add a second RFC validator here. ``reason`` *is* a
    validated ``Literal`` — it's our own form's contract, so a value outside
    the three tracks is a bug worth a 422, not user-facing input."""

    email: str
    reason: Reason


def _normalize_email(raw: str) -> str:
    """Trim surrounding whitespace and strip CR/LF before the email is sent to
    Resend — same header-injection / whitespace hygiene as
    `api/auth/magic._normalize_email`."""
    return raw.strip().replace("\r", "").replace("\n", "")


def _resend_config() -> tuple[str, str]:
    """Return ``(api_key, audience_id)`` from the environment, or raise
    ``HTTPException(503)`` naming the missing vars — mirrors the
    ``_get_mailer`` / ``_get_sender`` posture in `api/auth/magic.py`."""
    api_key = os.environ.get(RESEND_API_KEY_ENV, "").strip()
    audience_id = os.environ.get(RESEND_AUDIENCE_ID_ENV, "").strip()
    if not api_key or not audience_id:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Newsletter signup not configured ({RESEND_API_KEY_ENV}, "
                f"{RESEND_AUDIENCE_ID_ENV} must both be set)"
            ),
        )
    return api_key, audience_id


async def _resend_post(api_key: str, url: str, body: dict, *, action: str) -> None:
    """POST ``body`` to a Resend endpoint with the bearer key, mapping any
    non-2xx or network error to a 502 the form can show a retry hint for.

    Factored into one seam so both Resend calls (contact create, event send)
    share identical error handling and tests can patch httpx at one place
    (same approach as the Apple OAuth helpers in `api/auth/apple.py`). The
    underlying httpx error is logged, never surfaced; ``action`` labels which
    call failed in the log line."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(url, headers={"Authorization": f"Bearer {api_key}"}, json=body)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            _log.warning("resend %s failed: %s", action, exc)
            raise HTTPException(status_code=502, detail="subscribe_failed") from exc


async def _create_resend_contact(
    api_key: str, audience_id: str, email: str, reason: Reason
) -> None:
    """Create (or re-add) the contact in the Resend audience with the reason
    stamped onto its custom ``properties`` — the durable audience record."""
    await _resend_post(
        api_key,
        f"{RESEND_API_BASE}/audiences/{audience_id}/contacts",
        {"email": email, "unsubscribed": False, "properties": {"reason": reason}},
        action="contact create",
    )


async def _send_resend_event(api_key: str, email: str, reason: Reason) -> None:
    """Fire the ``New Signup`` custom event that triggers the welcome-drip
    Automation, carrying the reason in ``payload`` so the Automation's
    ``event.reason`` branch resolves to the right track."""
    await _resend_post(
        api_key,
        f"{RESEND_API_BASE}/events/send",
        {"event": RESEND_SIGNUP_EVENT, "email": email, "payload": {"reason": reason}},
        action="event send",
    )


@router.post("/subscribe", status_code=status.HTTP_202_ACCEPTED, response_class=Response)
async def subscribe(payload: SubscribeIn) -> Response:
    """Add a newsletter subscriber and start their welcome drip.

    Creates the contact in the audience, then fires the ``New Signup`` event
    that triggers the reason-branched Automation (the contact-create alone
    doesn't start the drip — the event does). Returns 202 on success; 503 if
    the Resend env vars are unset; 502 if either Resend call rejects or is
    unreachable."""
    api_key, audience_id = _resend_config()
    email = _normalize_email(payload.email)
    await _create_resend_contact(api_key, audience_id, email, payload.reason)
    await _send_resend_event(api_key, email, payload.reason)
    return Response(status_code=status.HTTP_202_ACCEPTED)
