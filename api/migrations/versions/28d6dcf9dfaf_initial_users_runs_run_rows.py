"""initial: users, runs, run_rows

Bootstraps the persistence layer per ADR-0013:

- `users` seeded with the sentinel `default` row (id=1) so every existing
  per-user FK has somewhere to point. #61 (auth) will create real `users`
  rows and backfill `user_id` references — a contained migration, not a
  wire-format change.
- `runs` is the per-pipeline record carrying `input_text` and a lightweight
  `summary_json` aggregate for cheap sidebar listings.
- `run_rows` holds the resolved `Row`s. `market_price` and `currency` are
  promoted out of `pricing_json` into typed columns so list filters are
  real SQL; the rest stays opaque so source-side drift (TCGdex / pokemontcg
  payload shape changes) doesn't force schema migrations.

Revision ID: 28d6dcf9dfaf
Revises:
Create Date: 2026-05-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "28d6dcf9dfaf"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("elapsed_seconds", sa.Float(), nullable=True),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("summary_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_runs_user_id_created_at", "runs", ["user_id", "created_at"])
    op.create_table(
        "run_rows",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("tag", sa.String(length=64), nullable=False),
        sa.Column("market_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=True),
        sa.Column("image_path", sa.String(length=512), nullable=True),
        sa.Column("query_json", sa.JSON(), nullable=False),
        sa.Column("card_json", sa.JSON(), nullable=True),
        sa.Column("pricing_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_run_rows_run_id_position", "run_rows", ["run_id", "position"])

    # Seed the sentinel `default` user. ADR-0013 keeps every per-user FK
    # pointing here until #61 introduces real auth. Raw SQL (rather than
    # `bulk_insert` + `sa.func.current_timestamp()`) because SQLite's
    # DateTime adapter rejects SQL function values at bind time — using
    # the DB's built-in `CURRENT_TIMESTAMP` literal works portably on
    # both SQLite and Postgres.
    op.execute("INSERT INTO users (id, name, created_at) VALUES (1, 'default', CURRENT_TIMESTAMP)")


def downgrade() -> None:
    op.drop_index("ix_run_rows_run_id_position", table_name="run_rows")
    op.drop_table("run_rows")
    op.drop_index("ix_runs_user_id_created_at", table_name="runs")
    op.drop_table("runs")
    op.drop_table("users")
