"""`GET /api/v1/me/export` — full per-user JSON data export (#448).

Part of the persistence-at-growth epic (#419): the GDPR-style "show me
everything you have on me" surface that #450's "Your data" page will
front-end. Bundles the signed-in user's profile, linked sign-in identities,
lookup history (runs), collections, want-lists, binders, and personalization
signals (favorite sets/species, swipe memory, swipe taste profile) into
one downloadable JSON document.

Reuses each resource router's own serializer (`serialize_collection`,
`serialize_wishlist`, `serialize_binder`, the `runs.py` Pydantic shapes) so
the export can't drift from what the regular list/detail endpoints return —
one source of truth per resource, same spirit as `db/serialize.py`'s
wire-vs-storage mapping.

Rate-limited in-process, keyed by user id — the hosted demo runs a single
uvicorn worker (see `Dockerfile` / `render.yaml`), so a module-level dict
is a safe, dependency-free limiter for this deploy shape. It would need to
move to a shared store (Redis, a DB row) if the service ever scales to
multiple instances.

Streams the response one top-level section at a time rather than building
the whole JSON string up front, so a large account's dump doesn't spike
peak memory. All of the underlying queries run inside the request handler
before the response is constructed — the generator only serializes
already-fetched Python data, so it never depends on the DB session
outliving the handler's return.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth.session import current_user_or_default
from ..db.models import (
    Binder,
    Collection,
    FavoriteSet,
    FavoriteSpecies,
    Run,
    SwipeProfileWeight,
    SwipeSeen,
    User,
    UserIdentity,
    Wishlist,
)
from ..db.session import get_db
from .binders import serialize_binder
from .collections import serialize_collection
from .runs import RunOut, RunRowOut
from .wishlists import serialize_wishlist

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]


# ---------------------------------------------------------------------------
# Rate limit — in-process fixed window, keyed by user id.
# ---------------------------------------------------------------------------

#: Max exports a single user can request inside `_RATE_LIMIT_WINDOW_SECONDS`.
_RATE_LIMIT_MAX_REQUESTS = 5
#: Window length. Generous enough for a legitimate export/check/re-export
#: cycle; tight enough to blunt a scripted "export on every page load".
_RATE_LIMIT_WINDOW_SECONDS = 300

_export_timestamps: dict[int, list[float]] = {}
_export_timestamps_lock = threading.Lock()


def _enforce_rate_limit(user_id: int) -> None:
    now = time.monotonic()
    cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
    with _export_timestamps_lock:
        recent = [t for t in _export_timestamps.get(user_id, []) if t > cutoff]
        if len(recent) >= _RATE_LIMIT_MAX_REQUESTS:
            retry_after = int(recent[0] + _RATE_LIMIT_WINDOW_SECONDS - now) + 1
            raise HTTPException(
                status_code=429,
                detail="export rate limit exceeded — try again shortly",
                headers={"Retry-After": str(retry_after)},
            )
        recent.append(now)
        _export_timestamps[user_id] = recent


def _rate_limit_gate(current_user: CurrentUser) -> None:
    """FastAPI dependency wrapper so the limiter runs post-auth, keyed on
    the resolved user id — `current_user_or_default` still 401s a
    signed-out caller before this ever executes."""
    _enforce_rate_limit(current_user.id)


RateLimitGate = Annotated[None, Depends(_rate_limit_gate)]


# ---------------------------------------------------------------------------
# Section builders — each returns a plain JSON-able value scoped to one user.
# ---------------------------------------------------------------------------


def _user_section(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "email_verified_at": (
            user.email_verified_at.isoformat() if user.email_verified_at else None
        ),
        "display_name": user.display_name,
        "created_at": user.created_at.isoformat(),
        "onboarding_completed_at": (
            user.onboarding_completed_at.isoformat() if user.onboarding_completed_at else None
        ),
    }


def _identities_section(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(UserIdentity).where(UserIdentity.user_id == user_id).order_by(UserIdentity.id)
    ).all()
    return [
        {
            "id": i.id,
            "provider": i.provider,
            "provider_subject": i.provider_subject,
            "email": i.email,
            "linked_at": i.linked_at.isoformat(),
        }
        for i in rows
    ]


def _runs_section(db: Session, user_id: int) -> list[dict[str, Any]]:
    runs = db.scalars(
        select(Run)
        .where(Run.user_id == user_id)
        .options(selectinload(Run.rows))
        .order_by(Run.created_at)
    ).all()
    return [
        RunOut(
            id=run.id,
            created_at=run.created_at.isoformat(),
            elapsed_seconds=run.elapsed_seconds,
            input_text=run.input_text,
            summary=run.summary_json,
            rows=[
                RunRowOut(
                    position=rr.position,
                    tag=rr.tag,
                    market_price=(float(rr.market_price) if rr.market_price is not None else None),
                    currency=rr.currency,
                    query=rr.query_json,
                    card=rr.card_json,
                    pricing=rr.pricing_json,
                )
                for rr in run.rows
            ],
            name=run.name,
            view_state=run.view_state,
        ).model_dump()
        for run in runs
    ]


def _collections_section(db: Session, user_id: int) -> list[dict[str, Any]]:
    collections = db.scalars(
        select(Collection)
        .where(Collection.user_id == user_id)
        .options(selectinload(Collection.items))
        .order_by(Collection.created_at)
    ).all()
    return [serialize_collection(db, c, user_id) for c in collections]


def _wishlists_section(db: Session, user_id: int) -> list[dict[str, Any]]:
    wishlists = db.scalars(
        select(Wishlist)
        .where(Wishlist.user_id == user_id)
        .options(selectinload(Wishlist.items))
        .order_by(Wishlist.created_at)
    ).all()
    return [serialize_wishlist(w) for w in wishlists]


def _binders_section(db: Session, user_id: int) -> list[dict[str, Any]]:
    binders = db.scalars(
        select(Binder)
        .where(Binder.user_id == user_id)
        .options(selectinload(Binder.collections), selectinload(Binder.wishlists))
        .order_by(Binder.created_at)
    ).all()
    return [serialize_binder(db, b, include_contents=True) for b in binders]


def _favorite_sets_section(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        select(FavoriteSet.set_id, FavoriteSet.pinned_at)
        .where(FavoriteSet.user_id == user_id)
        .order_by(FavoriteSet.pinned_at)
    ).all()
    return [{"set_id": s, "pinned_at": p.isoformat()} for s, p in rows]


def _favorite_species_section(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        select(FavoriteSpecies.dex_number, FavoriteSpecies.pinned_at)
        .where(FavoriteSpecies.user_id == user_id)
        .order_by(FavoriteSpecies.pinned_at)
    ).all()
    return [{"dex_number": n, "pinned_at": p.isoformat()} for n, p in rows]


def _swipe_seen_section(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(SwipeSeen).where(SwipeSeen.user_id == user_id).order_by(SwipeSeen.seen_at)
    ).all()
    return [
        {
            "set_id": r.card_set_id,
            "number": r.card_number,
            "seen_at": r.seen_at.isoformat(),
            "dir": r.swipe_dir,
        }
        for r in rows
    ]


def _swipe_profile_section(db: Session, user_id: int) -> dict[str, dict[str, int]]:
    rows = db.execute(
        select(
            SwipeProfileWeight.bucket,
            SwipeProfileWeight.key,
            SwipeProfileWeight.weight,
        ).where(SwipeProfileWeight.user_id == user_id)
    ).all()
    profile: dict[str, dict[str, int]] = {"rarity": {}, "set": {}, "tag": {}}
    for bucket, key, weight in rows:
        profile[bucket][key] = weight
    return profile


def _build_export(db: Session, user: User) -> dict[str, Any]:
    """Gather every section eagerly, in one open session — see module
    docstring for why the generator that serializes this never touches
    `db` itself."""
    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "schema_version": 1,
        "user": _user_section(user),
        "identities": _identities_section(db, user.id),
        "runs": _runs_section(db, user.id),
        "collections": _collections_section(db, user.id),
        "wishlists": _wishlists_section(db, user.id),
        "binders": _binders_section(db, user.id),
        "favorite_sets": _favorite_sets_section(db, user.id),
        "favorite_species": _favorite_species_section(db, user.id),
        "swipe_seen": _swipe_seen_section(db, user.id),
        "swipe_profile": _swipe_profile_section(db, user.id),
    }


def _stream_json(data: dict[str, Any]) -> Iterator[bytes]:
    """Serialize `data` one top-level section at a time.

    Coarser than per-row streaming, but it means the response body is
    never held as a single JSON string covering the entire export — memory
    scales with the largest single section, not the whole dump."""
    yield b"{"
    first = True
    for key, value in data.items():
        if not first:
            yield b","
        first = False
        yield json.dumps(key).encode()
        yield b":"
        yield json.dumps(value).encode()
    yield b"}"


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.get("/me/export")
def export_me(
    db: DbSession,
    current_user: CurrentUser,
    _rate_limit: RateLimitGate,
) -> StreamingResponse:
    """Stream the signed-in user's full data export as one JSON document.

    401s a signed-out caller on a hosted deploy (`current_user_or_default`
    — auth on, anonymous); resolves to the self-host sentinel user when
    auth is off, matching every other per-account resource in this API."""
    data = _build_export(db, current_user)
    return StreamingResponse(
        _stream_json(data),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="mgz-pkmn-export.json"'},
    )
