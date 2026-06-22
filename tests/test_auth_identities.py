"""Tests for slice 1 of #491 (auth unification).

Covers:

- Alembic migration up/down round-trip for ``user_identities``.
- Backfill correctness across the four name shapes that exist today
  (sentinel ``default``, ``gh:<login>``, ``google:<sub>``, ``magic:<hash>``).
- ``resolve_or_link_identity``'s three resolution branches:
  identity hit, email-fallback hit, cold mint.
- Cross-provider linking shape: signing in via Google with an email
  already attached to a GitHub identity attaches the Google identity
  to the existing user (no duplicate ``users`` row).
- Race recovery on the ``user_identities`` unique constraint.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from api.auth.identity import resolve_or_link_identity
from api.db import session as session_mod
from api.db.migrate import upgrade_head
from api.db.models import (
    PROVIDER_GITHUB,
    PROVIDER_GOOGLE,
    PROVIDER_MAGIC,
    User,
    UserIdentity,
)


class _IsolatedDbMixin(unittest.TestCase):
    """Point ``MGZ_PKMN_DATABASE_URL`` at a fresh sqlite tempfile so the
    user's real cache never sees these writes."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "test.db"
        self._old_url = os.environ.get("MGZ_PKMN_DATABASE_URL")
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        if self._old_url is None:
            os.environ.pop("MGZ_PKMN_DATABASE_URL", None)
        else:
            os.environ["MGZ_PKMN_DATABASE_URL"] = self._old_url
        self._tmp.cleanup()


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------


class UserIdentitiesMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_table_and_unique_constraint(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("user_identities", names)
        cols = {c["name"] for c in inspect(engine).get_columns("user_identities")}
        self.assertEqual(
            cols, {"id", "user_id", "provider", "provider_subject", "email", "linked_at"}
        )
        uniques = inspect(engine).get_unique_constraints("user_identities")
        names_seen = {u["name"] for u in uniques}
        self.assertIn("uq_user_identity_provider_subject", names_seen)

    def test_downgrade_drops_table(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Step back to the saved-searches revision so identity rows are
        # dropped but everything below stays intact.
        command.downgrade(cfg, "4a1c7b1e9b22")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("user_identities", names)
        self.assertIn("users", names)
        # Re-up is clean (catches a downgrade that forgot to drop the
        # unique index or left an orphan column behind).
        upgrade_head(engine)
        self.assertIn("user_identities", set(inspect(engine).get_table_names()))


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------


class UserIdentitiesBackfillTests(_IsolatedDbMixin):
    """The migration backfills one identity row per pre-existing user
    by parsing the ``gh:`` / ``google:`` / ``magic:`` prefix. To prove
    that without inverting the migration's own logic, seed users at
    the pre-#491 schema (just past the saved-searches revision), then
    upgrade to head and assert."""

    def _seed_at_pre_491_schema(self) -> None:
        """Migrate up to just before #491 (the saved-searches revision),
        seed the four kinds of user row, then leave the connection
        pointing at the downgraded schema so the next ``upgrade_head``
        runs the identity migration on a populated ``users`` table."""
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        command.upgrade(cfg, "4a1c7b1e9b22")
        # Seed via raw SQL listing only the columns that exist at this old
        # revision — the live ``User`` model carries columns added by later
        # migrations (e.g. #742's ``onboarding_completed_at``) that aren't in
        # this schema yet, so an ORM insert would reference a missing column.
        now = datetime.now(UTC)
        rows = [
            # The `default` sentinel is seeded by the initial migration; it
            # should NOT get an identity row.
            ("gh:alice", "alice@example.com", now, "Alice"),
            ("google:11223344", "bob@example.com", now, "Bob"),
            # Magic-link's stored name is a sha256(email) prefix; the backfill
            # recovers the subject from ``users.email``, not the name suffix.
            (
                "magic:abcdef0123456789abcdef0123456789abcdef0123456789",
                "carol@example.com",
                now,
                None,
            ),
        ]
        with engine.begin() as conn:
            for name, email, verified_at, display_name in rows:
                conn.execute(
                    text(
                        "INSERT INTO users (name, created_at, email, email_verified_at,"
                        " display_name) VALUES (:name, :created_at, :email,"
                        " :email_verified_at, :display_name)"
                    ),
                    {
                        "name": name,
                        "created_at": now,
                        "email": email,
                        "email_verified_at": verified_at,
                        "display_name": display_name,
                    },
                )

    def test_backfill_mints_one_identity_per_prefixed_user(self) -> None:
        self._seed_at_pre_491_schema()
        upgrade_head(session_mod.get_engine())
        with session_mod.get_session_factory()() as s:
            identities = s.scalars(select(UserIdentity).order_by(UserIdentity.id)).all()
            shape = sorted((i.provider, i.provider_subject, i.email) for i in identities)
            self.assertEqual(
                shape,
                [
                    ("github", "alice", "alice@example.com"),
                    ("google", "11223344", "bob@example.com"),
                    ("magic", "carol@example.com", "carol@example.com"),
                ],
            )

    def test_default_user_gets_no_identity(self) -> None:
        self._seed_at_pre_491_schema()
        upgrade_head(session_mod.get_engine())
        with session_mod.get_session_factory()() as s:
            default = s.scalar(select(User).where(User.name == "default"))
            assert default is not None
            self.assertEqual(default.identities, [])


# ---------------------------------------------------------------------------
# Helper: resolution branches
# ---------------------------------------------------------------------------


class ResolveOrLinkIdentityTests(_IsolatedDbMixin):
    def setUp(self) -> None:
        super().setUp()
        upgrade_head(session_mod.get_engine())

    def test_cold_miss_mints_user_and_first_identity(self) -> None:
        with session_mod.get_session_factory()() as s:
            user = resolve_or_link_identity(
                s,
                provider=PROVIDER_GITHUB,
                subject="dani",
                email="dani@example.com",
                display_name="Dani Reyes",
                name_prefix="gh",
            )
            s.commit()
            self.assertEqual(user.email, "dani@example.com")
            self.assertEqual(user.display_name, "Dani Reyes")
            self.assertEqual(user.name, "gh:dani")
            self.assertIsNotNone(user.email_verified_at)
            identities = s.scalars(
                select(UserIdentity).where(UserIdentity.user_id == user.id)
            ).all()
            self.assertEqual(len(identities), 1)
            self.assertEqual(identities[0].provider, "github")
            self.assertEqual(identities[0].provider_subject, "dani")
            self.assertEqual(identities[0].email, "dani@example.com")

    def test_identity_hit_returns_existing_user_without_duplicating(self) -> None:
        with session_mod.get_session_factory()() as s:
            first = resolve_or_link_identity(
                s,
                provider=PROVIDER_GITHUB,
                subject="dani",
                email="dani@example.com",
                display_name="Dani Reyes",
                name_prefix="gh",
            )
            s.commit()
            again = resolve_or_link_identity(
                s,
                provider=PROVIDER_GITHUB,
                subject="dani",
                email="dani@example.com",
                display_name="Dani Reyes",
                name_prefix="gh",
            )
            s.commit()
            self.assertEqual(first.id, again.id)
            n = s.scalar(select(func.count()).select_from(UserIdentity))
            self.assertEqual(n, 1)

    def test_email_hit_attaches_second_provider_to_existing_user(self) -> None:
        """The big-new-shape from this slice: a user who signed in via
        GitHub yesterday signs in via Google with the same email today
        — the helper attaches the Google identity to their existing
        user row instead of minting a duplicate."""
        with session_mod.get_session_factory()() as s:
            github_user = resolve_or_link_identity(
                s,
                provider=PROVIDER_GITHUB,
                subject="dani",
                email="dani@example.com",
                display_name="Dani Reyes",
                name_prefix="gh",
            )
            s.commit()
            google_user = resolve_or_link_identity(
                s,
                provider=PROVIDER_GOOGLE,
                subject="555-google-sub",
                email="dani@example.com",
                display_name="Daniela Reyes",  # ignored by first-set-wins
                name_prefix="google",
            )
            s.commit()
            self.assertEqual(github_user.id, google_user.id)
            # Display name is preserved (first-set-wins).
            self.assertEqual(google_user.display_name, "Dani Reyes")
            identities = s.scalars(
                select(UserIdentity)
                .where(UserIdentity.user_id == google_user.id)
                .order_by(UserIdentity.id)
            ).all()
            self.assertEqual([i.provider for i in identities], ["github", "google"])
            self.assertEqual([i.provider_subject for i in identities], ["dani", "555-google-sub"])

    def test_identity_email_refreshes_when_provider_reports_new_address(self) -> None:
        """When a user changes their primary email on GitHub, the next
        sign-in finds the existing identity (subject is stable) and
        refreshes the identity row's stored email so the future
        "linked providers" panel reflects reality."""
        with session_mod.get_session_factory()() as s:
            user = resolve_or_link_identity(
                s,
                provider=PROVIDER_GITHUB,
                subject="dani",
                email="dani@old.com",
                display_name="Dani Reyes",
                name_prefix="gh",
            )
            s.commit()
            user_again = resolve_or_link_identity(
                s,
                provider=PROVIDER_GITHUB,
                subject="dani",
                email="dani@new.com",
                display_name="Dani Reyes",
                name_prefix="gh",
            )
            s.commit()
            self.assertEqual(user.id, user_again.id)
            identity = s.scalar(
                select(UserIdentity).where(
                    UserIdentity.provider == "github",
                    UserIdentity.provider_subject == "dani",
                )
            )
            assert identity is not None
            self.assertEqual(identity.email, "dani@new.com")
            # `users.email` stays put — the identity row tracks the
            # most-recent per-provider value separately.
            self.assertEqual(user_again.email, "dani@old.com")

    def test_magic_link_uses_email_as_subject_and_hashes_name(self) -> None:
        with session_mod.get_session_factory()() as s:
            user = resolve_or_link_identity(
                s,
                provider=PROVIDER_MAGIC,
                subject="loop@example.com",
                email="loop@example.com",
                display_name=None,
                name_prefix="magic",
            )
            s.commit()
            self.assertTrue(user.name.startswith("magic:"))
            self.assertEqual(len(user.name), len("magic:") + 48)
            identity = s.scalar(select(UserIdentity).where(UserIdentity.user_id == user.id))
            assert identity is not None
            self.assertEqual(identity.provider_subject, "loop@example.com")


# ---------------------------------------------------------------------------
# Race recovery on the unique constraint
# ---------------------------------------------------------------------------


class RaceRecoveryTests(_IsolatedDbMixin):
    """The cold-mint branch's race-recovery shape: two callbacks for
    the same verified email land in the read-then-insert window. The
    helper rolls back the failed INSERT, re-reads the winning row, and
    attaches this provider's identity to it."""

    def setUp(self) -> None:
        super().setUp()
        upgrade_head(session_mod.get_engine())

    def test_email_race_falls_through_to_email_fallback(self) -> None:
        # Seed the "winner" row + its GitHub identity. The patched
        # lookup forces the helper down the cold-mint branch, the
        # flush hits the partial-unique on `users.email`, recovery
        # re-reads the winner, and the new (google) identity is
        # attached to it.
        with session_mod.get_session_factory()() as s:
            winner = User(
                name="gh:winner",
                email="race@example.com",
                email_verified_at=datetime.now(UTC),
                display_name="Race First",
            )
            s.add(winner)
            s.flush()
            s.add(
                UserIdentity(
                    user_id=winner.id,
                    provider="github",
                    provider_subject="winner",
                    email="race@example.com",
                )
            )
            s.commit()

        from api.auth import identity as identity_mod

        real_lookup = identity_mod._find_user_by_email
        calls = {"n": 0}

        def side_effect(db, email):
            calls["n"] += 1
            if calls["n"] == 1:
                return None  # force cold-mint branch
            return real_lookup(db, email)

        with session_mod.get_session_factory()() as s:
            with patch("api.auth.identity._find_user_by_email", side_effect=side_effect):
                resolve_or_link_identity(
                    s,
                    provider=PROVIDER_GOOGLE,
                    subject="late-sub",
                    email="race@example.com",
                    display_name="Race Late",
                    name_prefix="google",
                )
            s.commit()
        self.assertEqual(calls["n"], 2)

        with session_mod.get_session_factory()() as s:
            # Only one row for race@example.com, display_name preserved.
            users = s.scalars(select(User).where(User.email == "race@example.com")).all()
            self.assertEqual(len(users), 1)
            self.assertEqual(users[0].display_name, "Race First")
            providers = sorted(i.provider for i in users[0].identities)
            self.assertEqual(providers, ["github", "google"])

    def test_duplicate_identity_violates_unique_constraint(self) -> None:
        """The ``UNIQUE(provider, provider_subject)`` is what stops a
        provider identity from accidentally attaching to two users.
        Bypass the helper (which handles the race for us) and INSERT
        the duplicate directly to prove the constraint is wired."""
        with session_mod.get_session_factory()() as s:
            u1 = User(name="u1", email="u1@x.com")
            u2 = User(name="u2", email="u2@x.com")
            s.add_all([u1, u2])
            s.flush()
            s.add(
                UserIdentity(
                    user_id=u1.id,
                    provider="github",
                    provider_subject="alice",
                    email="u1@x.com",
                )
            )
            s.commit()
            s.add(
                UserIdentity(
                    user_id=u2.id,
                    provider="github",
                    provider_subject="alice",
                    email="u2@x.com",
                )
            )
            with self.assertRaises(IntegrityError):
                s.commit()


if __name__ == "__main__":
    unittest.main()
