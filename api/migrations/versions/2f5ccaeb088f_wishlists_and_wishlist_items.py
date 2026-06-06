"""wishlists + wishlist_items

Fourth slice of ADR-0013. Same shape as `collections` / `collection_items`
from the third slice, with one addition: `wishlist_items.max_price`,
an optional alert threshold the user wants the card under. The
threshold is persisted but not yet wired to alerting — see ADR-0013's
"Out of scope" note + the follow-up filed against #245.

Separate tables (rather than a polymorphic `lists` table) so the "I own
these" vs "I want these" semantics stay distinct at the schema layer
and downstream queries don't have to filter on a discriminator column.

Revision ID: 2f5ccaeb088f
Revises: 2b9da4eb7e17
Create Date: 2026-06-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2f5ccaeb088f"
down_revision: str | Sequence[str] | None = "2b9da4eb7e17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "wishlists",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_wishlists_user_id_created_at",
        "wishlists",
        ["user_id", "created_at"],
    )
    op.create_table(
        "wishlist_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("wishlist_id", sa.Integer(), nullable=False),
        sa.Column("card_json", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "max_price",
            sa.Numeric(precision=12, scale=2),
            nullable=True,
        ),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["wishlist_id"], ["wishlists.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_wishlist_items_wishlist_id_added_at",
        "wishlist_items",
        ["wishlist_id", "added_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_wishlist_items_wishlist_id_added_at", table_name="wishlist_items")
    op.drop_table("wishlist_items")
    op.drop_index("ix_wishlists_user_id_created_at", table_name="wishlists")
    op.drop_table("wishlists")
