"""binders inventory — physical binders that hold many collections

Child slice of the library rethink RFC (#501); see #702.

Introduces the binder-as-container model: a ``binders`` row is a physical
binder the collector owns (its ``binder_format`` / ``binder_color`` /
``binder_type`` / ``capacity`` identity lives here, mirroring the existing
collection-level columns from #679/#681), and a collection is filed into one
via a new nullable ``collections.binder_id``. One binder holds many
collections and can be empty.

Fresh-start migration (the agreed direction on #702): the ``binders`` table
starts empty and every existing ``collections.binder_id`` is null, so legacy
``kind='binder'`` collections are untouched and keep their own identity
columns. New binders use this table going forward. ``binder_id`` is
``ON DELETE SET NULL`` so deleting a binder detaches its collections rather
than cascading them away.

Revision ID: a7d3f1e0c2b5
Revises: a3e8c5b1d9f4
Create Date: 2026-06-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7d3f1e0c2b5"
down_revision: str | Sequence[str] | None = "a3e8c5b1d9f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "binders",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("binder_format", sa.String(length=16), nullable=True),
        sa.Column("binder_color", sa.String(length=16), nullable=True),
        sa.Column("binder_type", sa.String(length=16), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
    )
    with op.batch_alter_table("collections") as batch:
        batch.add_column(sa.Column("binder_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_collections_binder_id",
            "binders",
            ["binder_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.drop_constraint("fk_collections_binder_id", type_="foreignkey")
        batch.drop_column("binder_id")
    op.drop_table("binders")
