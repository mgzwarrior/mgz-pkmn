"""swipe_seen — per-user "already shown" memory for swipe mode

Child slice of the library rethink RFC (#501); see #581. Promotes the
swipe deck's no-repeat memory from the SPA's session-local
``localStorage`` set to durable per-user state, so a chase card never
resurfaces across sessions until the user resets the deck.

Keyed on the promoted ``(card_set_id, card_number)`` identity — the same
pair indexed on ``collection_items`` / ``wishlist_items`` by the #574
rework — so the library-aware exclusion query (``GET /swipe/excluded``)
unions seen + owned + chasing across all three tables on the same shape.

Append-only and idempotent: the unique constraint on
``(user_id, card_set_id, card_number)`` makes re-seeing a card a no-op.

Revision ID: b3f1a9c2d7e4
Revises: c01ec71011a7
Create Date: 2026-06-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3f1a9c2d7e4"
down_revision: str | Sequence[str] | None = "c01ec71011a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "swipe_seen",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("card_set_id", sa.String(length=64), nullable=False),
        sa.Column("card_number", sa.String(length=16), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("swipe_dir", sa.String(length=8), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "card_set_id",
            "card_number",
            name="uq_swipe_seen_user_card",
        ),
    )
    # The exclusion query filters by user_id then unions on the card
    # identity; a leading-user_id index keeps both the per-user fetch and
    # the idempotent-insert conflict check off a table scan.
    op.create_index(
        "ix_swipe_seen_user_id",
        "swipe_seen",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_swipe_seen_user_id", table_name="swipe_seen")
    op.drop_table("swipe_seen")
