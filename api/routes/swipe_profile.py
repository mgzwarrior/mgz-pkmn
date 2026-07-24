"""`/api/v1/swipe/profile` — server-side swipe taste-profile persistence (#967).

Promotes the web SPA's `useSwipeProfile.ts` — three signed counters
(`rarity` / `set` / `tag`) accumulated from swipe actions, `localStorage`-only
today — to durable per-user state, so the taste profile survives a device
change and iOS can share it with web. Mirrors the SPA's shape verbatim
rather than a derived filter, so the wire contract and the SPA's in-memory
`SwipeProfile` stay byte-for-byte comparable.

Distinct from `swipe_seen` (already-shown exclusion memory) and
`favorite_sets` (explicit set pins) — taste weighting is a different
signal that happens to share the per-user table pattern.

Endpoints:

- ``GET    /swipe/profile``  the user's persisted rarity/set/tag weights
- ``PUT    /swipe/profile``  replace the whole profile (upsert semantics)
- ``DELETE /swipe/profile``  clear the persisted profile (reset)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth.session import current_user_or_default
from ..db.models import SwipeProfileWeight, User
from ..db.session import get_db

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user_or_default)]

#: The three `SwipeProfile` counters mirrored from `useSwipeProfile.ts`.
_BUCKETS = ("rarity", "set", "tag")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SwipeProfileWeights(BaseModel):
    """Mirrors `useSwipeProfile.ts`'s `SwipeProfile` counters verbatim."""

    rarity: dict[str, int] = Field(default_factory=dict)
    set: dict[str, int] = Field(default_factory=dict)
    tag: dict[str, int] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/swipe/profile")
def get_profile(db: DbSession, current_user: CurrentUser) -> dict:
    """The user's persisted taste weights, grouped back into buckets."""
    rows = db.execute(
        select(
            SwipeProfileWeight.bucket,
            SwipeProfileWeight.key,
            SwipeProfileWeight.weight,
        ).where(SwipeProfileWeight.user_id == current_user.id)
    ).all()
    profile = SwipeProfileWeights()
    for bucket, key, weight in rows:
        getattr(profile, bucket)[key] = weight
    return profile.model_dump()


@router.put("/swipe/profile")
def replace_profile(
    req: SwipeProfileWeights,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Replace the user's whole profile with the given weights.

    Full-replace, not a merge: deletes the user's existing rows and
    re-inserts the non-zero entries, mirroring the SPA's own `setWeight`
    behavior of dropping a key entirely once its weight lands on 0."""
    db.execute(delete(SwipeProfileWeight).where(SwipeProfileWeight.user_id == current_user.id))
    now = datetime.now(UTC)
    for bucket in _BUCKETS:
        for key, weight in getattr(req, bucket).items():
            if weight == 0:
                continue
            db.add(
                SwipeProfileWeight(
                    user_id=current_user.id,
                    bucket=bucket,
                    key=key,
                    weight=weight,
                    updated_at=now,
                )
            )
    db.commit()
    return get_profile(db, current_user)


@router.delete("/swipe/profile", status_code=204)
def reset_profile(db: DbSession, current_user: CurrentUser) -> Response:
    """Clear the user's persisted profile entirely."""
    db.execute(delete(SwipeProfileWeight).where(SwipeProfileWeight.user_id == current_user.id))
    db.commit()
    return Response(status_code=204)
