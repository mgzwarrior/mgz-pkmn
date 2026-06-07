"""user_identities: promote provider attachment into a first-class table

Slice 1 of [#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491)
(auth unification). Creates `user_identities` so each `(provider,
provider_subject)` pair is a queryable row instead of a `users.name`
prefix, and backfills one row per existing `users` row by parsing the
current `gh:` / `google:` / `magic:` prefix the provider callbacks
have been minting since [#408](https://github.com/mgzwarrior/mgz-pkmn/issues/408)
/ [#409](https://github.com/mgzwarrior/mgz-pkmn/issues/409) /
[#410](https://github.com/mgzwarrior/mgz-pkmn/issues/410). The sentinel
`default` row gets no identity attached.

Revision ID: 7d2e3a8c4b91
Revises: 4a1c7b1e9b22
Create Date: 2026-06-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7d2e3a8c4b91"
down_revision: str | Sequence[str] | None = "4a1c7b1e9b22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_identities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("provider_subject", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column(
            "linked_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "provider", "provider_subject", name="uq_user_identity_provider_subject"
        ),
    )
    # Index user_id for the SPA's future "list my linked providers"
    # query (slice 3); cheap to add now.
    op.create_index("ix_user_identities_user_id", "user_identities", ["user_id"])
    _backfill_identities()


def _backfill_identities() -> None:
    """Reverse-engineer the `users.name` prefix into identity rows.

    Three prefixes mint exactly the same way the provider callbacks
    have been since #408 / #409 / #410:

    - ``gh:<login>``      → (github, <login>, users.email)
    - ``google:<sub>``    → (google, <sub>, users.email)
    - ``magic:<hash>``    → (magic, users.email, users.email)
      (the original magic prefix is a *truncated* SHA-256 of the email
      — not invertible. We use ``users.email`` as the subject because
      that's the stable identifier the helper resolves against
      post-migration. A signed-in user with the same email going
      forward hits this row on lookup.)

    Anything else (the sentinel ``default`` row, future custom names)
    gets skipped. The backfill is idempotent under
    ``downgrade -> upgrade`` because the upgrade re-creates the table
    empty before re-running it.
    """
    bind = op.get_bind()
    users = sa.table(
        "users",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String(length=64)),
        sa.column("email", sa.String(length=320)),
    )
    rows = bind.execute(sa.select(users.c.id, users.c.name, users.c.email)).all()
    identities = sa.table(
        "user_identities",
        sa.column("user_id", sa.Integer()),
        sa.column("provider", sa.String(length=16)),
        sa.column("provider_subject", sa.String(length=128)),
        sa.column("email", sa.String(length=320)),
    )
    to_insert: list[dict] = []
    for user_id, name, email in rows:
        if name.startswith("gh:"):
            subject = name[len("gh:") :]
            provider = "github"
        elif name.startswith("google:"):
            subject = name[len("google:") :]
            provider = "google"
        elif name.startswith("magic:"):
            if not email:
                # Magic-link rows always have an email — guard anyway so
                # a hand-edited row doesn't break the backfill.
                continue
            subject = email
            provider = "magic"
        else:
            continue
        to_insert.append(
            {
                "user_id": user_id,
                "provider": provider,
                "provider_subject": subject,
                "email": email,
            }
        )
    if to_insert:
        bind.execute(sa.insert(identities), to_insert)


def downgrade() -> None:
    op.drop_index("ix_user_identities_user_id", table_name="user_identities")
    op.drop_table("user_identities")
