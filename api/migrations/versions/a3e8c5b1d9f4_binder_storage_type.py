"""collections.binder_type — storage style for binders (regular/toploader/graded/other)

Child slice of the library rethink RFC (#501); follow-up to #679. See #681.

A binder's cover/type/master-set identity is shared with smart binders as of
#681; this adds the ``binder_type`` storage style (binder pages vs. toploaders
vs. graded slabs vs. other). Nullable with no server default: every row that
predates this migration keeps its current behavior, reading as unset.

Revision ID: a3e8c5b1d9f4
Revises: f7c4b2a9e6d3
Create Date: 2026-06-15
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3e8c5b1d9f4"
down_revision: str | Sequence[str] | None = "f7c4b2a9e6d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.add_column(sa.Column("binder_type", sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.drop_column("binder_type")
