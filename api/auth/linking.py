"""Shared helpers for explicit account-provider linking (#491 slice 2)."""

from __future__ import annotations

from fastapi import HTTPException, Request

from ..db.models import User

LINK_SESSION_USER_KEY = "link_for_user_id"
POST_LINK_REDIRECT = "/account"


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


def identity_conflict_detail(provider: str) -> dict[str, str]:
    """409 body for a provider identity attached to another account."""
    return {
        "code": "identity_already_linked",
        "provider": provider,
        "message": (f"This {provider} account is already linked to a different mgz-pkmn account."),
    }
