"""collections binder identity — format, color, capacity, master-set flag

Child slice of the library rethink RFC (#501); see #679.

A ``binder`` collection (``kind='binder'``) is a manual bucket with
physical-binder identity. These four columns carry that identity and are
only meaningful for the binder kind:

- ``binder_format`` — page pocket layout (``4-pocket`` / ``9-pocket`` /
  ``12-pocket``).
- ``binder_color`` — design-token palette stem tinting the cover swatch.
- ``capacity`` — total card slots, so the list can show how full it is.
- ``is_master_set`` — whether the binder targets the master set of the set
  it organizes (``source_set_id``).

All nullable with no server default: every row that predates this migration
(and every manual/set/dynamic collection, which ignores the columns) keeps
its current behavior untouched. A null ``is_master_set`` reads as not-master.

Revision ID: f7c4b2a9e6d3
Revises: d5e2f7a3c9b1
Create Date: 2026-06-15
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f7c4b2a9e6d3"
down_revision: str | Sequence[str] | None = "d5e2f7a3c9b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.add_column(sa.Column("binder_format", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("binder_color", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("capacity", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("is_master_set", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.drop_column("is_master_set")
        batch.drop_column("capacity")
        batch.drop_column("binder_color")
        batch.drop_column("binder_format")
