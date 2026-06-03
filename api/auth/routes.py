"""Auth HTTP surface — currently just ``GET /api/v1/me`` and
``POST /api/v1/auth/logout``.

Foundation slice (#407). Provider sub-issues (#408 GitHub / #409
magic-link / #410 Google) extend this router with ``/auth/<provider>/...``
routes once they land."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from ..db.models import User
from .session import get_current_user

router = APIRouter()

CurrentUser = Annotated[User | None, Depends(get_current_user)]


class MeOut(BaseModel):
    """Payload returned by ``GET /api/v1/me`` for a signed-in user."""

    id: int
    email: str | None
    display_name: str | None


@router.get("/me", response_model=MeOut | None)
def me(user: CurrentUser, response: Response) -> MeOut | None:
    """Return the current signed-in user, or 204 No Content for anon.

    The SPA polls this on mount + after each OAuth callback to drive the
    header chip's signed-in/anonymous state. Returning 204 (rather than
    200 + ``null``) makes the anonymous case cheap to detect on the
    client without parsing a body."""
    if user is None:
        response.status_code = 204
        return None
    return MeOut(id=user.id, email=user.email, display_name=user.display_name)


@router.post("/auth/logout", status_code=204)
def logout(request: Request) -> Response:
    """Clear the session cookie. Idempotent — calling on an already-anon
    session is a no-op 204."""
    request.session.clear()
    return Response(status_code=204)
