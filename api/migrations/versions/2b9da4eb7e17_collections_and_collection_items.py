"""collections + collection_items

Third slice of ADR-0013: user-named buckets for pinning matched cards
across runs. The schema mirrors the runs/run_rows shape from the first
slice — a parent row keyed on `user_id` and a child item table with
`card_json` carrying the verbatim matched payload. `card_json` is the
only stable handle across re-lookups: card identity inside a collection
must survive even if the source ([pokemontcg.io](https://pokemontcg.io)
/ TCGdex) renames or removes the row.

Revision ID: 2b9da4eb7e17
Revises: 9c4f2a7d8e15
Create Date: 2026-06-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2b9da4eb7e17"
down_revision: str | Sequence[str] | None = "9c4f2a7d8e15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_collections_user_id_created_at",
        "collections",
        ["user_id", "created_at"],
    )
    op.create_table(
        "collection_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("card_json", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["collections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_collection_items_collection_id_added_at",
        "collection_items",
        ["collection_id", "added_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_collection_items_collection_id_added_at", table_name="collection_items")
    op.drop_table("collection_items")
    op.drop_index("ix_collections_user_id_created_at", table_name="collections")
    op.drop_table("collections")
