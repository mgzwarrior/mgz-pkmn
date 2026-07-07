"""collections.purpose — personal / trade / bulk (#707)

Minimal, ship-now slice of the library rethink RFC (#501) and the bulk/trade
tracking design. Adds a ``purpose`` column to ``collections`` so the app can
tell "cards I'm keeping" apart from "cards I'm holding to trade or as bulk."
Additive: every existing row backfills to ``personal``, so current ownership
badges and set-completion counts are unaffected until a user opts a
collection into ``trade``/``bulk``.

Revision ID: c3d8f2a6b4e9
Revises: b8e2c1f5a3d7
Create Date: 2026-07-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3d8f2a6b4e9"
down_revision: str | Sequence[str] | None = "b8e2c1f5a3d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.add_column(
            sa.Column(
                "purpose",
                sa.String(length=16),
                nullable=False,
                server_default="personal",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("collections") as batch:
        batch.drop_column("purpose")
