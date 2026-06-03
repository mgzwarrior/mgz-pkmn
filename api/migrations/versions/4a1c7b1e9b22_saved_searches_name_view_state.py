"""saved-searches: add runs.name + runs.view_state

A `runs` row becomes a *saved search* when the user names it: the new
``name`` column is non-NULL only for runs the user explicitly chose to
keep. ``GET /runs`` filters on that, so the sidebar surfaces only the
curated list instead of every streamed lookup. ``view_state`` stores the
results-table sort + filter snapshot at save time so re-loading a saved
search restores the exact view the user was looking at.

Revision ID: 4a1c7b1e9b22
Revises: 2f5ccaeb088f
Create Date: 2026-06-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4a1c7b1e9b22"
down_revision: str | Sequence[str] | None = "2f5ccaeb088f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("runs") as batch:
        batch.add_column(sa.Column("name", sa.String(length=200), nullable=True))
        batch.add_column(sa.Column("view_state", sa.JSON(), nullable=True))
    op.create_index("ix_runs_user_id_name", "runs", ["user_id", "name"])


def downgrade() -> None:
    op.drop_index("ix_runs_user_id_name", table_name="runs")
    with op.batch_alter_table("runs") as batch:
        batch.drop_column("view_state")
        batch.drop_column("name")
