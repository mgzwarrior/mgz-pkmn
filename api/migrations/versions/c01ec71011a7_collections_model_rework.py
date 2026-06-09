"""collections model rework — quantity, promoted card identity, snapshots, lifecycle

Foundational schema slice of the collections rethink RFC (#501).
See child issue #574 for the full motivation and the columns each child
in the epic depends on.

Adds, in one revision:

- ``collection_items.quantity`` (default 1) — vendor multiples.
- Promoted card-identity columns on both ``collection_items`` and
  ``wishlist_items`` (``card_set_id``, ``card_number``, ``card_name``,
  ``card_rarity``, ``card_types_json``, ``card_image_url``,
  ``price_snapshot``, ``priced_at``). Backfilled from ``card_json`` for
  existing rows; price snapshot deliberately left null on backfill
  (we don't have a trustworthy historical price for those rows).
- ``collection_items.added_via`` — provenance tag for the insights view.
- ``collections.kind`` + nullable ``source_set_id`` + ``rule_json``.
  Manual stays the default; set-based and dynamic kinds ride #506.
- ``wishlist_items.acquired_at`` + ``acquired_collection_item_id``
  (FK, ON DELETE SET NULL) — wishlist → collection promote (#504).
- ``wishlists.target_date`` — show-anchor.
- New ``collection_snapshots`` table — first-class progress over time
  (backs the dashboard #575 and the set-ID-card progress view #508).

Indices added on ``(card_set_id, card_number)`` for both item tables so
the cross-collection ownership badge (#576) and library-aware swipe
exclusion (#581) are real index scans.

Revision ID: c01ec71011a7
Revises: 7d2e3a8c4b91
Create Date: 2026-06-09
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c01ec71011a7"
down_revision: str | Sequence[str] | None = "7d2e3a8c4b91"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- collections: kind + source_set_id + rule_json ----
    with op.batch_alter_table("collections") as batch:
        batch.add_column(
            sa.Column(
                "kind",
                sa.String(length=16),
                nullable=False,
                server_default="manual",
            )
        )
        batch.add_column(sa.Column("source_set_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("rule_json", sa.JSON(), nullable=True))

    # ---- collection_items: quantity + promoted identity + provenance ----
    with op.batch_alter_table("collection_items") as batch:
        batch.add_column(sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("card_set_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("card_number", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("card_name", sa.String(length=200), nullable=True))
        batch.add_column(sa.Column("card_rarity", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("card_types_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("card_image_url", sa.String(length=512), nullable=True))
        batch.add_column(
            sa.Column("price_snapshot", sa.Numeric(precision=12, scale=2), nullable=True)
        )
        batch.add_column(sa.Column("priced_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("added_via", sa.String(length=32), nullable=True))

    op.create_index(
        "ix_collection_items_card_set_id_number",
        "collection_items",
        ["card_set_id", "card_number"],
    )

    # ---- wishlists: target_date ----
    with op.batch_alter_table("wishlists") as batch:
        batch.add_column(sa.Column("target_date", sa.DateTime(timezone=True), nullable=True))

    # ---- wishlist_items: promoted identity + lifecycle plumbing ----
    # ``acquired_collection_item_id`` is an FK to ``collection_items.id``
    # with ON DELETE SET NULL so a user deleting the collection item
    # doesn't cascade through and orphan the wishlist row; the wishlist
    # row stays as historical "I was chasing this and got it once."
    with op.batch_alter_table("wishlist_items") as batch:
        batch.add_column(sa.Column("card_set_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("card_number", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("card_name", sa.String(length=200), nullable=True))
        batch.add_column(sa.Column("card_rarity", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("card_types_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("card_image_url", sa.String(length=512), nullable=True))
        batch.add_column(
            sa.Column("price_snapshot", sa.Numeric(precision=12, scale=2), nullable=True)
        )
        batch.add_column(sa.Column("priced_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("acquired_collection_item_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_wishlist_items_acquired_collection_item_id",
            "collection_items",
            ["acquired_collection_item_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_index(
        "ix_wishlist_items_card_set_id_number",
        "wishlist_items",
        ["card_set_id", "card_number"],
    )

    # ---- collection_snapshots ----
    op.create_table(
        "collection_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("unique_cards", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("est_value_cents", sa.Integer(), nullable=True),
        sa.Column("set_completion_pct", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["collection_id"], ["collections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_collection_snapshots_collection_id_captured_at",
        "collection_snapshots",
        ["collection_id", "captured_at"],
    )

    # ---- backfill promoted identity columns from existing card_json ----
    # One-shot; runs inside the migration so the SPA never sees a row
    # with no promoted columns once it ships. Price snapshot is left
    # null intentionally — we don't have a trustworthy historical price
    # for already-stored rows, and emitting a wrong number would poison
    # the value-over-time chart.
    _backfill_promoted_columns()


def downgrade() -> None:
    op.drop_index(
        "ix_collection_snapshots_collection_id_captured_at",
        table_name="collection_snapshots",
    )
    op.drop_table("collection_snapshots")

    op.drop_index("ix_wishlist_items_card_set_id_number", table_name="wishlist_items")
    with op.batch_alter_table("wishlist_items") as batch:
        batch.drop_constraint("fk_wishlist_items_acquired_collection_item_id", type_="foreignkey")
        for col in (
            "acquired_collection_item_id",
            "acquired_at",
            "priced_at",
            "price_snapshot",
            "card_image_url",
            "card_types_json",
            "card_rarity",
            "card_name",
            "card_number",
            "card_set_id",
        ):
            batch.drop_column(col)

    with op.batch_alter_table("wishlists") as batch:
        batch.drop_column("target_date")

    op.drop_index("ix_collection_items_card_set_id_number", table_name="collection_items")
    with op.batch_alter_table("collection_items") as batch:
        for col in (
            "added_via",
            "priced_at",
            "price_snapshot",
            "card_image_url",
            "card_types_json",
            "card_rarity",
            "card_name",
            "card_number",
            "card_set_id",
            "quantity",
        ):
            batch.drop_column(col)

    with op.batch_alter_table("collections") as batch:
        batch.drop_column("rule_json")
        batch.drop_column("source_set_id")
        batch.drop_column("kind")


def _backfill_promoted_columns() -> None:
    """Pull set id / number / name / rarity / types / image out of each
    existing row's ``card_json`` and write them into the new columns.

    Uses raw ``op.get_bind()`` so the migration doesn't import the
    SQLAlchemy ORM models — keeps it replay-safe across future model
    drift. Loads ``card_json`` as text and parses it locally; SQLite
    stores JSON as TEXT under the hood and the shape we need is small.
    """
    from api.db.card_payload import extract_card_identity

    bind = op.get_bind()
    for table in ("collection_items", "wishlist_items"):
        rows = bind.execute(sa.text(f"SELECT id, card_json FROM {table}")).fetchall()
        for row in rows:
            raw = row.card_json
            if isinstance(raw, str):
                try:
                    card = json.loads(raw)
                except (TypeError, ValueError):
                    continue
            elif isinstance(raw, dict):
                card = raw
            else:
                continue
            promoted = extract_card_identity(card)
            bind.execute(
                sa.text(
                    f"""
                    UPDATE {table}
                       SET card_set_id    = :card_set_id,
                           card_number    = :card_number,
                           card_name      = :card_name,
                           card_rarity    = :card_rarity,
                           card_types_json= :card_types_json,
                           card_image_url = :card_image_url
                     WHERE id = :id
                    """
                ),
                {
                    **promoted,
                    "card_types_json": (
                        json.dumps(promoted["card_types_json"])
                        if promoted["card_types_json"] is not None
                        else None
                    ),
                    "id": row.id,
                },
            )
