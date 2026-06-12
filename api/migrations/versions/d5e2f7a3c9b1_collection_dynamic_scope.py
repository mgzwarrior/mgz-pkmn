"""collections.dynamic_scope — owned vs catalog membership for smart collections

Child slice of the library rethink RFC (#501); see #631, follow-up to #506.

A dynamic collection (``kind='dynamic'``) can resolve its membership two
ways. ``owned`` (the #630 behavior) matches the rule against the cards the
user already owns — an inventory view. ``catalog`` resolves the full
matching set from pokemontcg.io and overlays ownership — a goal-with-progress
target view, for the case the collector doesn't yet have everything that
matches.

Nullable with no server default: a null reads as ``owned`` so every row that
predates this migration (and every manual/set collection, which ignores the
column) keeps its current behavior untouched.

Revision ID: d5e2f7a3c9b1
Revises: b3f1a9c2d7e4
Create Date: 2026-06-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5e2f7a3c9b1"
down_revision: str | Sequence[str] | None = "b3f1a9c2d7e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.add_column(sa.Column("dynamic_scope", sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.drop_column("dynamic_scope")
