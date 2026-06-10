"""eBay marketplace account-deletion notification endpoint.

eBay requires every production application to host a public webhook that
(1) answers a one-time challenge-code verification GET and (2) acknowledges
account-closure POST notifications:
https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion

mgz-pkmn stores no eBay user data — it reads public listings with an
application access token (see ``src/mgz_pkmn/sources/ebay.py``) — so a
closure notification has nothing to erase. The handler validates and
acknowledges, which is the entire compliance obligation for a read-only,
no-PII consumer.

The endpoint is intentionally **not** behind the auth scaffold: eBay calls
it unauthenticated, gating trust on the verification token instead.
"""

from __future__ import annotations

import hashlib
import logging
import os

from fastapi import APIRouter, HTTPException, Request, Response

_log = logging.getLogger(__name__)

#: Operator-chosen verification token (32-80 chars, ``[A-Za-z0-9_-]``).
#: Must match the value registered in the eBay Developer portal.
VERIFICATION_TOKEN_ENV = "MGZ_PKMN_EBAY_VERIFICATION_TOKEN"
#: The exact public URL registered with eBay, e.g.
#: ``https://mgz-pkmn.onrender.com/api/v1/ebay/account-deletion``. Read from
#: env rather than derived from ``request.url`` because Render terminates TLS
#: upstream — the challenge hash must use the byte-exact registered URL.
DELETION_ENDPOINT_ENV = "MGZ_PKMN_EBAY_DELETION_ENDPOINT"

router = APIRouter()


def _read_config() -> tuple[str, str]:
    """Return (verification_token, endpoint_url), or raise 503 if unconfigured.

    Loud-misconfiguration posture matches the auth providers — a
    half-configured deploy yields a clear 503 instead of returning a bogus
    challenge response that eBay would silently reject."""
    token = os.environ.get(VERIFICATION_TOKEN_ENV, "").strip()
    endpoint = os.environ.get(DELETION_ENDPOINT_ENV, "").strip()
    if not (token and endpoint):
        raise HTTPException(
            status_code=503,
            detail=(
                f"eBay account-deletion endpoint not configured "
                f"({VERIFICATION_TOKEN_ENV} and {DELETION_ENDPOINT_ENV} must be set)"
            ),
        )
    return token, endpoint


@router.get("/ebay/account-deletion")
def verify_challenge(challenge_code: str) -> dict[str, str]:
    """Answer eBay's challenge-code verification handshake.

    eBay GETs this URL with ``?challenge_code=...``. The response is the hex
    SHA-256 of ``challengeCode + verificationToken + endpoint`` — in that
    exact concatenation order, per the eBay guide — returned as
    ``{"challengeResponse": <hex>}`` with HTTP 200."""
    token, endpoint = _read_config()
    digest = hashlib.sha256()
    digest.update(challenge_code.encode("utf-8"))
    digest.update(token.encode("utf-8"))
    digest.update(endpoint.encode("utf-8"))
    return {"challengeResponse": digest.hexdigest()}


@router.post("/ebay/account-deletion")
async def acknowledge_deletion(request: Request) -> Response:
    """Acknowledge an account-closure notification.

    We persist no eBay user data, so there's nothing to erase — log receipt
    (without PII) and return 200. The body is read defensively; a malformed
    payload still acks so eBay doesn't enter a retry storm."""
    try:
        payload = await request.json()
    except Exception:
        payload = None
    notification_id = None
    if isinstance(payload, dict):
        metadata = payload.get("metadata")
        if isinstance(metadata, dict):
            notification_id = metadata.get("notificationId")
    _log.info("eBay account-deletion notification received (notificationId=%s)", notification_id)
    return Response(status_code=200)
