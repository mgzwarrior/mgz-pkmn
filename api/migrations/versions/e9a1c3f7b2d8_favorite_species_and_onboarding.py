"""favorite_species + users.onboarding_completed_at — favorite Pokémon (#742)

Species-level sibling of ``favorite_sets`` (#712): an explicit, durable "I love
this Pokémon" signal, keyed by national Pokédex number — the same key Browse's
pokedex view and ``GET /pokedex/{number}/cards`` use — so a card's
``nationalPokedexNumbers`` matches it directly across Swipe / Browse.

Also adds ``users.onboarding_completed_at``: a server-side gate for the
first-login favorite-Pokémon survey, so it suppresses across devices once the
user finishes (or skips) it.

Append-only and idempotent: the unique constraint on ``(user_id, dex_number)``
makes re-pinning a no-op, mirroring ``favorite_sets``.

Revision ID: e9a1c3f7b2d8
Revises: c8b4e1f6a2d7
Create Date: 2026-06-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e9a1c3f7b2d8"
down_revision: str | Sequence[str] | None = "c8b4e1f6a2d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "favorite_species",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("dex_number", sa.Integer(), nullable=False),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "dex_number", name="uq_favorite_species_user_dex"),
    )
    # Every read filters by user_id first; a leading-user_id index keeps the
    # per-user fetch and the idempotent-insert conflict check off a scan.
    op.create_index(
        "ix_favorite_species_user_id",
        "favorite_species",
        ["user_id"],
    )
    op.add_column(
        "users",
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "onboarding_completed_at")
    op.drop_index("ix_favorite_species_user_id", table_name="favorite_species")
    op.drop_table("favorite_species")
