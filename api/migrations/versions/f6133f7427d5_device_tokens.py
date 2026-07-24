"""device_tokens — per-user push notification device registration

First slice of the push notification epic (#946); see #974. Registration
only — no preferences (#975) or delivery (#976) yet. ``platform`` is a
free-form tag rather than an APNs-specific enum, so Android/FCM can register
here later without a schema change.

Multi-device from day one: the unique constraint is on ``device_token``
alone, not ``(user_id, device_token)`` — a token belongs to exactly one
device, and a device belongs to exactly one signed-in user at a time.

Revision ID: f6133f7427d5
Revises: b2c6e4f9a1d3
Create Date: 2026-07-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6133f7427d5"
down_revision: str | Sequence[str] | None = "b2c6e4f9a1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_tokens",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("device_token", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_token", name="uq_device_tokens_device_token"),
    )
    # Every read filters by user_id first; a leading-user_id index keeps the
    # per-user fetch off a scan, mirroring favorite_sets / favorite_species.
    op.create_index(
        "ix_device_tokens_user_id",
        "device_tokens",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_device_tokens_user_id", table_name="device_tokens")
    op.drop_table("device_tokens")
