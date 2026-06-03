"""auth foundation: email + email_verified_at + display_name on users

First slice of #61 (the [ADR-0019](docs/adr/0019-hosted-demo-identity-and-auth.md)
auth epic). Extends the existing `users` table with the columns every
provider sub-issue (#408 GitHub / #409 magic-link / #410 Google) needs
to upsert into. The sentinel `default` row stays — self-hosters with
`MGZ_PKMN_AUTH_ENABLED=0` still point at it.

Revision ID: 9c4f2a7d8e15
Revises: 28d6dcf9dfaf
Create Date: 2026-06-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9c4f2a7d8e15"
down_revision: str | Sequence[str] | None = "28d6dcf9dfaf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("email", sa.String(length=320), nullable=True))
        batch.add_column(sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("display_name", sa.String(length=200), nullable=True))
    # Unique on `email` only when set — the sentinel `default` row has
    # NULL email and we don't want that to block a second self-hoster
    # row from existing. Partial-unique is portable across SQLite +
    # Postgres via a filtered index.
    op.create_index(
        "ix_users_email_unique",
        "users",
        ["email"],
        unique=True,
        sqlite_where=sa.text("email IS NOT NULL"),
        postgresql_where=sa.text("email IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_users_email_unique", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("display_name")
        batch.drop_column("email_verified_at")
        batch.drop_column("email")
