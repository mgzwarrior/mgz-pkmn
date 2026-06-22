"""default wishlist + collection per user — one-tap want/own (#759, ADR-0027)

Adds an ``is_default`` flag to ``wishlists`` and ``collections`` so a user's
one-tap ``Want`` / ``Own`` quick actions always have a write target without a
picker. The flag is the invariant, not the row: a partial unique index on
``user_id WHERE is_default`` allows at most one default of each kind per user,
while leaving non-default rows unconstrained. Existing rows backfill to
``false`` (no default yet); the find-or-create helper provisions one lazily on
the first quick action.

Revision ID: f1a4d7c9e2b6
Revises: e9a1c3f7b2d8
Create Date: 2026-06-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1a4d7c9e2b6"
down_revision: str | Sequence[str] | None = "e9a1c3f7b2d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("wishlists", "collections"):
        op.add_column(
            table,
            sa.Column(
                "is_default",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
        # At most one default of each kind per user. Partial so the many
        # non-default rows stay unconstrained; the per-user fetch of "the
        # default" rides the same index.
        op.create_index(
            f"uq_{table}_user_default",
            table,
            ["user_id"],
            unique=True,
            sqlite_where=sa.text("is_default = 1"),
            postgresql_where=sa.text("is_default"),
        )


def downgrade() -> None:
    for table in ("collections", "wishlists"):
        op.drop_index(f"uq_{table}_user_default", table_name=table)
        op.drop_column(table, "is_default")
