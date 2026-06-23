"""want-lists file into binders — wishlists.binder_id

Split-out half of #726 (tracked as #774): the smart-collection filing shipped
in #726/#775; this makes the third logical list — the want-list — binder-aware
too, so a binder can organize both owned (collections) and chasing (want-lists).

Mirrors ``collections.binder_id`` from #702 (a7d3f1e0c2b5): a new nullable
``wishlists.binder_id`` FK to ``binders``, ``ON DELETE SET NULL`` so deleting a
binder detaches its want-lists rather than cascading them away. Existing rows
stay null (loose, in no binder).

Revision ID: b8e2c1f5a3d7
Revises: f1a4d7c9e2b6
Create Date: 2026-06-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8e2c1f5a3d7"
down_revision: str | Sequence[str] | None = "f1a4d7c9e2b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("wishlists") as batch:
        batch.add_column(sa.Column("binder_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_wishlists_binder_id",
            "binders",
            ["binder_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("wishlists") as batch:
        batch.drop_constraint("fk_wishlists_binder_id", type_="foreignkey")
        batch.drop_column("binder_id")
