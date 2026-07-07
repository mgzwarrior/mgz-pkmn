"""sealed items + per-copy condition/grading (#882, ADR-0029)

Foundational migration for the sealed-product epic (#881), shipped as one
migration so the parallel-table symmetry doesn't drift across PRs:

- ``collection_sealed_items`` / ``wishlist_sealed_items`` — sealed product
  as first-class items, mirroring the card-item pattern (verbatim
  ``product_json`` + promoted identity columns) rather than widening the
  card tables with a polymorphic ``kind`` discriminator.
- ``collection_item_copies`` / ``collection_sealed_item_copies`` — the
  per-copy condition/grade breakdown ADR-0025 deferred: a stack of 3 can
  be 2 raw-NM + 1 PSA 9. Opt-in — items with no copies rows keep using
  their aggregate ``quantity``.
- ``target_condition`` / ``target_grading_company`` / ``target_min_grade``
  on ``wishlist_items`` and ``wishlist_sealed_items`` — chase targets get
  target columns, not copies (you don't own copies of a chase).

Purely additive: new tables plus nullable columns, so existing card rows
and API responses are unaffected.

Revision ID: e6b2d8f4a1c3
Revises: c3d8f2a6b4e9
Create Date: 2026-07-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e6b2d8f4a1c3"
down_revision: str | Sequence[str] | None = "c3d8f2a6b4e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _target_columns() -> list[sa.Column]:
    """Fresh chase-target columns (a Column object binds to one table)."""
    return [
        sa.Column("target_condition", sa.String(length=16), nullable=True),
        sa.Column("target_grading_company", sa.String(length=8), nullable=True),
        sa.Column("target_min_grade", sa.Numeric(4, 1), nullable=True),
    ]


def _copy_columns(fk_column: str, fk_target: str) -> list[sa.Column]:
    """Shared column set for the two per-copy breakdown tables."""
    return [
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            fk_column,
            sa.Integer(),
            sa.ForeignKey(fk_target, ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("condition", sa.String(length=16), nullable=True),
        sa.Column("grading_company", sa.String(length=8), nullable=True),
        sa.Column("grade", sa.Numeric(4, 1), nullable=True),
        sa.Column("cert_number", sa.String(length=32), nullable=True),
        sa.Column("price_snapshot", sa.Numeric(12, 2), nullable=True),
        sa.Column("priced_at", sa.DateTime(timezone=True), nullable=True),
    ]


def _sealed_item_columns(fk_column: str, fk_target: str) -> list[sa.Column]:
    """Shared column set for the two sealed-item tables."""
    return [
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            fk_column,
            sa.Integer(),
            sa.ForeignKey(fk_target, ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("product_json", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("product_set_id", sa.String(length=64), nullable=True),
        sa.Column("product_name", sa.String(length=200), nullable=True),
        sa.Column("product_type", sa.String(length=32), nullable=True),
        sa.Column("product_language", sa.String(length=16), nullable=True),
        sa.Column("product_image_url", sa.String(length=512), nullable=True),
        sa.Column("price_snapshot", sa.Numeric(12, 2), nullable=True),
        sa.Column("priced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("added_via", sa.String(length=32), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        "collection_sealed_items",
        *_sealed_item_columns("collection_id", "collections.id"),
    )
    op.create_index(
        "ix_collection_sealed_items_product_set_id",
        "collection_sealed_items",
        ["product_set_id"],
    )

    op.create_table(
        "wishlist_sealed_items",
        *_sealed_item_columns("wishlist_id", "wishlists.id"),
        sa.Column("max_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "acquired_collection_sealed_item_id",
            sa.Integer(),
            sa.ForeignKey("collection_sealed_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *_target_columns(),
    )
    op.create_index(
        "ix_wishlist_sealed_items_product_set_id",
        "wishlist_sealed_items",
        ["product_set_id"],
    )

    op.create_table(
        "collection_item_copies",
        *_copy_columns("collection_item_id", "collection_items.id"),
    )
    op.create_table(
        "collection_sealed_item_copies",
        *_copy_columns("collection_sealed_item_id", "collection_sealed_items.id"),
    )

    with op.batch_alter_table("wishlist_items") as batch:
        for column in _target_columns():
            batch.add_column(column)


def downgrade() -> None:
    with op.batch_alter_table("wishlist_items") as batch:
        batch.drop_column("target_min_grade")
        batch.drop_column("target_grading_company")
        batch.drop_column("target_condition")
    op.drop_table("collection_sealed_item_copies")
    op.drop_table("collection_item_copies")
    op.drop_index("ix_wishlist_sealed_items_product_set_id", table_name="wishlist_sealed_items")
    op.drop_table("wishlist_sealed_items")
    op.drop_index("ix_collection_sealed_items_product_set_id", table_name="collection_sealed_items")
    op.drop_table("collection_sealed_items")
