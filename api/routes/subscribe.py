"""POST /api/v1/subscribe — newsletter signup, backed by Resend audiences.

Replaces the marketing site's old Buttondown embed (ADR-0014) with a
server-side contact create against Resend, per
[ADR-0028](../../docs/adr/0028-resend-for-subscriptions-and-automations.md).
Keeping the Resend API key on the backend (rather than a public embed
endpoint in static HTML) lets us stamp a ``reason`` onto each contact, which
a single Resend Automation branches on to send one of three 3-email welcome
tracks: ``collector`` (north star), ``show`` (dealers / show-goers), and
``builder`` (open-source contributors).

The contact is created in one audience (``RESEND_AUDIENCE_ID``) with the
reason carried in Resend's custom ``properties`` map — the same audience and
sending domain already used for transactional magic-link mail
([api/auth/magic.py](../auth/magic.py)).

Configuration mirrors the magic-link posture: a 503 with a setup hint when the
two env vars are missing (a deploy-time misconfiguration, never a runtime
signal), and a 502 when Resend itself rejects the create or is unreachable.
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

#: Resend REST base. Contacts live under an audience:
#: ``POST /audiences/{audience_id}/contacts``.
RESEND_API_BASE = "https://api.resend.com"

#: Bearer token for the Resend API and the audience the contact is created in.
#: Both ``sync: false`` secrets in render.yaml; the route 503s when either is
#: unset so a misconfigured deploy is obvious rather than silently dropping
#: signups.
RESEND_API_KEY_ENV = "RESEND_API_KEY"
RESEND_AUDIENCE_ID_ENV = "RESEND_AUDIENCE_ID"

#: The three welcome tracks. Kept in sync with the Resend Automation's branch
#: conditions and the reason chips in site/src/components/EmailSignup.astro.
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


async def _create_resend_contact(
    api_key: str, audience_id: str, email: str, reason: Reason
) -> None:
    """Create (or re-add) the contact in the Resend audience with the reason
    stamped onto its custom ``properties``.

    Factored into one seam so tests patch this rather than mocking httpx at the
    transport layer (same approach as the Apple OAuth helpers in
    `api/auth/apple.py`). Any non-2xx or network error becomes a 502 so the
    form can show a retry hint; the underlying httpx error is logged, never
    surfaced."""
    url = f"{RESEND_API_BASE}/audiences/{audience_id}/contacts"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "email": email,
                    "unsubscribed": False,
                    "properties": {"reason": reason},
                },
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            _log.warning("resend contact create failed: %s", exc)
            raise HTTPException(status_code=502, detail="subscribe_failed") from exc


@router.post("/subscribe", status_code=status.HTTP_202_ACCEPTED, response_class=Response)
async def subscribe(payload: SubscribeIn) -> Response:
    """Add a newsletter subscriber to the Resend audience for their reason.

    Returns 202 on success (the Resend Automation sends the confirmation /
    first welcome email — there's no second round-trip here). 503 if the
    Resend env vars are unset; 502 if Resend rejects the create or is
    unreachable."""
    api_key, audience_id = _resend_config()
    email = _normalize_email(payload.email)
    await _create_resend_contact(api_key, audience_id, email, payload.reason)
    return Response(status_code=status.HTTP_202_ACCEPTED)
