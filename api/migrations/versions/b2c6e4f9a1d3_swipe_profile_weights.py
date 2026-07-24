"""swipe_profile_weights — server-side swipe taste-profile persistence

Child slice of the swipe-personalization epic (#701); see #967. Promotes
the web SPA's `useSwipeProfile.ts` localStorage-only rarity/set/tag taste
counters to durable per-user state, mirroring the counters verbatim so
iOS and web can share one persisted preference.

One row per `(bucket, key)` entry rather than one JSON blob per user,
following the granular per-row style of `swipe_seen` / `favorite_sets`.
Idempotent via the unique constraint on `(user_id, bucket, key)`; a `PUT`
replaces a user's whole profile by deleting existing rows and re-inserting
the non-zero entries.

Revision ID: b2c6e4f9a1d3
Revises: 4d3b4ffb3653
Create Date: 2026-07-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2c6e4f9a1d3"
down_revision: str | Sequence[str] | None = "4d3b4ffb3653"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "swipe_profile_weights",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("bucket", sa.String(length=16), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "bucket", "key", name="uq_swipe_profile_weight_user_bucket_key"
        ),
    )
    # Every read/replace filters by user_id first; a leading-user_id index
    # keeps the per-user fetch and the PUT's delete-then-insert off a scan.
    op.create_index(
        "ix_swipe_profile_weights_user_id",
        "swipe_profile_weights",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_swipe_profile_weights_user_id", table_name="swipe_profile_weights")
    op.drop_table("swipe_profile_weights")
