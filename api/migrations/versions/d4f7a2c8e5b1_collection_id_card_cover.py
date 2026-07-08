"""collection ID card cover override — collections.id_card_cover_item_id (#788)

The printable collection ID card (#507) auto-picks its cover art (the most
valuable owned card, falling back to the first). This lets a collector pin a
specific card instead. Nullable FK to ``collection_items.id``, ``ON DELETE
SET NULL`` so deleting the pinned item falls back to auto-pick rather than
leaving a dangling reference. Existing rows stay null (auto-pick, unchanged
behavior).

Revision ID: d4f7a2c8e5b1
Revises: e6b2d8f4a1c3
Create Date: 2026-07-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4f7a2c8e5b1"
down_revision: str | Sequence[str] | None = "e6b2d8f4a1c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.add_column(sa.Column("id_card_cover_item_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_collections_id_card_cover_item_id",
            "collection_items",
            ["id_card_cover_item_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.drop_constraint("fk_collections_id_card_cover_item_id", type_="foreignkey")
        batch.drop_column("id_card_cover_item_id")
