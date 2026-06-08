"""Shared helpers for explicit account-provider linking (#491 slice 2)."""

from __future__ import annotations

from urllib.parse import urlencode

from fastapi import HTTPException, Request

from ..db.models import User

LINK_SESSION_USER_KEY = "link_for_user_id"
POST_LINK_REDIRECT = "/account"


def post_link_error_redirect(provider: str, code: str = "identity_already_linked") -> str:
    """Build the post-link redirect URL for a recoverable link failure.

    The Account modal at ``web/src/components/AccountPanel.tsx`` reads these
    query params on first render and surfaces a friendly inline message — so a
    conflict on link round-trips back into the modal rather than terminating
    on a bare JSON 409 page. Kept centralised so every provider's link
    callback emits the same shape.
    """
    query = urlencode({"link_error": code, "provider": provider})
    return f"{POST_LINK_REDIRECT}?{query}"


def stage_link_request(request: Request, user: User) -> None:
    """Remember which signed-in user started a provider link flow."""
    request.session[LINK_SESSION_USER_KEY] = user.id


def consume_link_request(request: Request, user: User) -> int:
    """Consume and validate the signed-in user's pending link marker."""
    raw = request.session.pop(LINK_SESSION_USER_KEY, None)
    if raw is None:
        raise HTTPException(status_code=400, detail="link_not_started")
    try:
        linked_user_id = int(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="link_not_started") from exc
    if linked_user_id != user.id:
        raise HTTPException(status_code=400, detail="link_user_mismatch")
    return linked_user_id
