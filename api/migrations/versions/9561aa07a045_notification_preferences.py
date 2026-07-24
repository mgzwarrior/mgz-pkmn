"""notification_preferences — per-user, per-type push notification opt-in

Second slice of the push notification epic (#946); see #975. Storage and
CRUD only — device registration (#974, shipped) seeds default rows, and
delivery (#976) is a follow-up. ``notification_type`` is a free-form string
key rather than an enum, so a new type is a seeded default row later, not a
schema change.

Revision ID: 9561aa07a045
Revises: f6133f7427d5
Create Date: 2026-07-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9561aa07a045"
down_revision: str | Sequence[str] | None = "f6133f7427d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("notification_type", sa.String(length=64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "notification_type", name="uq_notification_preferences_user_type"
        ),
    )
    # Every read filters by user_id first; a leading-user_id index keeps the
    # per-user fetch off a scan, mirroring favorite_sets / device_tokens.
    op.create_index(
        "ix_notification_preferences_user_id",
        "notification_preferences",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_notification_preferences_user_id", table_name="notification_preferences")
    op.drop_table("notification_preferences")
