"""favorite_sets — per-user pinned favorite sets for the personalization surface

Child slice of the swipe-personalization epic (#701); see #712. Gives the
user an explicit, durable "I love this set" signal — distinct from the
localStorage swipe taste profile — so other surfaces (search defaults, set
ID cards, swipe candidate weighting) can key off it across devices.

Keyed by the catalog set id (``base1`` / ``sv4pt5``); the friendly name is
resolved client-side from the baked set catalog, so it isn't stored here.

Append-only and idempotent: the unique constraint on ``(user_id, set_id)``
makes re-pinning a no-op, mirroring ``swipe_seen``.

Revision ID: c8b4e1f6a2d7
Revises: a7d3f1e0c2b5
Create Date: 2026-06-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8b4e1f6a2d7"
down_revision: str | Sequence[str] | None = "a7d3f1e0c2b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "favorite_sets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.String(length=64), nullable=False),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "set_id", name="uq_favorite_set_user_set"),
    )
    # Every read filters by user_id first; a leading-user_id index keeps the
    # per-user fetch and the idempotent-insert conflict check off a scan.
    op.create_index(
        "ix_favorite_sets_user_id",
        "favorite_sets",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_favorite_sets_user_id", table_name="favorite_sets")
    op.drop_table("favorite_sets")
