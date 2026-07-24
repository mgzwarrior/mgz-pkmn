"""price_snapshots — per-lookup pricing observations for the 30-day trend sparkline

Backend slice of #269 (30-day price-trend sparkline on every results row).
Not user-scoped — market price is a property of the card, not of who looked
it up — so every matched, priced lookup across every user writes a row (see
``api.routes.lookup._attach_price_history``). Downsampling to one point per
calendar day happens on the read side (``api.db.price_history``), so this
table stays a simple append-only log.

Revision ID: 4d3b4ffb3653
Revises: d4f7a2c8e5b1
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4d3b4ffb3653"
down_revision: str | Sequence[str] | None = "d4f7a2c8e5b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "price_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("card_set_id", sa.String(length=64), nullable=False),
        sa.Column("card_number", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=True),
        sa.Column("price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    # The read path always filters by (card_set_id, card_number) and orders
    # by captured_at — a composite index keeps that off a table scan as the
    # table grows.
    op.create_index(
        "ix_price_snapshots_card_captured",
        "price_snapshots",
        ["card_set_id", "card_number", "captured_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_price_snapshots_card_captured", table_name="price_snapshots")
    op.drop_table("price_snapshots")
