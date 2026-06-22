"""`/api/v1/favorite-pokemon` — per-user pinned favorite Pokémon (#742).

The species-level sibling of ``/favorite-sets`` (#712), part of turning swipe
into a personalization surface (#701). A favorite Pokémon is an explicit,
durable "I love this species" signal — distinct from the localStorage swipe
taste profile — that other surfaces (Browse's pokedex view, swipe candidate
weighting) can read across devices.

Species are referenced by their national Pokédex number — the same key Browse's
pokedex view and ``GET /pokedex/{number}/cards`` use — so a card's
``nationalPokedexNumbers`` matches a favorite directly. The friendly name is
resolved client-side from the baked Pokédex, so it isn't stored or returned
here.

Endpoints:

- ``GET    /favorite-pokemon``                 the user's pinned dex numbers
- ``POST   /favorite-pokemon``                 pin a species (idempotent)
- ``DELETE /favorite-pokemon/{dex_number}``    unpin a species
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth.session import current_user_or_default
from ..db.models import FavoriteSpecies, User
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]

#: National Pokédex ceiling — the highest dex number a pin can reference. Kept
#: in step with the baked Pokédex's top generation boundary.
_MAX_DEX_NUMBER = 1025


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class FavoritePokemonOut(BaseModel):
    dex_number: int
    pinned_at: str


class FavoritePokemonListOut(BaseModel):
    pokemon: list[FavoritePokemonOut]


class FavoritePokemonCreate(BaseModel):
    dex_number: int = Field(ge=1, le=_MAX_DEX_NUMBER)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/favorite-pokemon")
def list_favorites(db: DbSession, current_user: CurrentUser) -> dict:
    """The user's pinned Pokémon, newest first."""
    rows = db.execute(
        select(FavoriteSpecies.dex_number, FavoriteSpecies.pinned_at)
        .where(FavoriteSpecies.user_id == current_user.id)
        .order_by(FavoriteSpecies.pinned_at.desc())
    ).all()
    pokemon = [FavoritePokemonOut(dex_number=n, pinned_at=p.isoformat()) for n, p in rows]
    return FavoritePokemonListOut(pokemon=pokemon).model_dump()


@router.post("/favorite-pokemon", status_code=204)
def pin_favorite(
    req: FavoritePokemonCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Pin a species. Idempotent: re-pinning is a no-op.

    The unique constraint on ``(user_id, dex_number)`` is the source of truth —
    a concurrent duplicate insert raises ``IntegrityError``, which we swallow so
    the call still reports success (the species is already pinned)."""
    row = FavoriteSpecies(
        user_id=current_user.id,
        dex_number=req.dex_number,
        pinned_at=datetime.now(UTC),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return Response(status_code=204)


@router.delete("/favorite-pokemon/{dex_number}", status_code=204)
def unpin_favorite(
    dex_number: int,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Unpin a species. A no-op (still 204) when it wasn't pinned."""
    db.execute(
        delete(FavoriteSpecies).where(
            FavoriteSpecies.user_id == current_user.id,
            FavoriteSpecies.dex_number == dex_number,
        )
    )
    db.commit()
    return Response(status_code=204)
