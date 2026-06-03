"""Auth HTTP surface — currently just ``GET /api/v1/me`` and
``POST /api/v1/auth/logout``.

Foundation slice (#407). Provider sub-issues (#408 GitHub / #409
magic-link / #410 Google) extend this router with ``/auth/<provider>/...``
routes once they land."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
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


@router.get(
    "/me",
    response_model=MeOut,
    responses={
        200: {"model": MeOut, "description": "Signed-in user"},
        204: {"description": "Anonymous session — no body"},
    },
)
def me(user: CurrentUser) -> Response:
    """Return the current signed-in user, or 204 No Content for anon.

    The SPA polls this on mount + after each OAuth callback to drive the
    header chip's signed-in/anonymous state. Returning 204 (rather than
    200 + ``null``) makes the anonymous case cheap to detect on the
    client without parsing a body — both response shapes are documented
    in the OpenAPI schema via the ``responses`` map above so generated
    clients pick up the union explicitly. The 204 branch returns a bare
    ``Response`` directly (rather than ``None`` + ``response_model``
    bypass) so FastAPI's response validator doesn't try to coerce a
    ``None`` against ``MeOut``."""
    if user is None:
        return Response(status_code=204)
    return JSONResponse(
        MeOut(id=user.id, email=user.email, display_name=user.display_name).model_dump()
    )


@router.post("/auth/logout", status_code=204)
def logout(request: Request) -> Response:
    """Clear the session cookie. Idempotent — calling on an already-anon
    session is a no-op 204."""
    request.session.clear()
    return Response(status_code=204)
