"""Tests for the ADR-0013 persistence layer.

Covers:

- URL resolution (env-var override + cache-root fallback).
- Alembic migration round-trip (upgrade → seed → downgrade → re-upgrade).
- `MGZ_PKMN_AUTOMIGRATE=0` opt-out skips startup migration.
- `/api/v1/bulk` writes a run after the SSE stream completes.
- `/api/v1/runs` list filters to *saved* runs (`name IS NOT NULL`) and
  `/api/v1/runs/{id}` returns the persisted shape unconditionally.
- `/api/v1/runs/{id}` PATCH promotes a run into the saved list with a
  view-state snapshot.
- SQLite flock takes effect (a second acquire blocks while held).

Each test points `MGZ_PKMN_DATABASE_URL` at a fresh tempfile so the user's
real `~/.cache/mgz-pkmn/mgz-pkmn.db` is never touched.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select

from api.db import migrate as migrate_mod
from api.db import session as session_mod
from api.db.migrate import _sqlite_flock, run_migrations_with_lock, upgrade_head
from api.db.models import DEFAULT_USER_ID, Run, RunRow, User
from api.db.url import resolve_database_url

# ---------------------------------------------------------------------------
# Per-test isolation: fresh tmp DB + reset cached engine
# ---------------------------------------------------------------------------


class _IsolatedDbMixin(unittest.TestCase):
    """Point MGZ_PKMN_DATABASE_URL at a fresh sqlite file per test."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "test.db"
        self._old_url = os.environ.get("MGZ_PKMN_DATABASE_URL")
        self._old_automigrate = os.environ.get("MGZ_PKMN_AUTOMIGRATE")
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        if self._old_url is None:
            os.environ.pop("MGZ_PKMN_DATABASE_URL", None)
        else:
            os.environ["MGZ_PKMN_DATABASE_URL"] = self._old_url
        if self._old_automigrate is None:
            os.environ.pop("MGZ_PKMN_AUTOMIGRATE", None)
        else:
            os.environ["MGZ_PKMN_AUTOMIGRATE"] = self._old_automigrate
        self._tmp.cleanup()


# ---------------------------------------------------------------------------
# URL resolution
# ---------------------------------------------------------------------------


class ResolveDatabaseUrlTests(unittest.TestCase):
    def test_env_override_wins(self) -> None:
        with patch.dict(os.environ, {"MGZ_PKMN_DATABASE_URL": "postgresql://u:p@h/db"}):
            self.assertEqual(resolve_database_url(), "postgresql://u:p@h/db")

    def test_empty_env_falls_back_to_sqlite_default(self) -> None:
        # Use a per-test XDG_CACHE_HOME so we don't touch the user's real cache.
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(
                os.environ,
                {"MGZ_PKMN_DATABASE_URL": "", "XDG_CACHE_HOME": tmp},
                clear=False,
            ):
                url = resolve_database_url()
            self.assertTrue(url.startswith("sqlite:///"))
            self.assertIn("mgz-pkmn", url)
            self.assertTrue(url.endswith("/mgz-pkmn.db"))


# ---------------------------------------------------------------------------
# Migration round-trip
# ---------------------------------------------------------------------------


class MigrationRoundTripTests(_IsolatedDbMixin):
    def test_upgrade_creates_tables_and_seeds_default_user(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)

        names = set(inspect(engine).get_table_names())
        self.assertIn("users", names)
        self.assertIn("runs", names)
        self.assertIn("run_rows", names)
        self.assertIn("alembic_version", names)

        with session_mod.get_session_factory()() as s:
            default_user = s.scalar(select(User).where(User.id == 1))
            assert default_user is not None
            self.assertEqual(default_user.name, "default")

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("users", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        command.downgrade(cfg, "base")
        # Only alembic_version remains after a full downgrade.
        self.assertEqual(set(inspect(engine).get_table_names()), {"alembic_version"})

        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("users", names)
        self.assertIn("runs", names)
        self.assertIn("run_rows", names)


# ---------------------------------------------------------------------------
# AUTOMIGRATE=0 opt-out
# ---------------------------------------------------------------------------


class AutomigrateOptOutTests(_IsolatedDbMixin):
    def test_automigrate_disabled_skips_upgrade_at_startup(self) -> None:
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"
        # The lifespan reaches the migrate module via `from .db import migrate`
        # in api.main, so we patch the module-level binding to observe the
        # call. (Patching the imported name in api.main would also work; this
        # is closer to the source.)
        with patch.object(migrate_mod, "run_migrations_with_lock") as mock_run:
            from api.main import app

            with TestClient(app) as c:
                resp = c.get("/health")
                self.assertEqual(resp.status_code, 200)
            mock_run.assert_not_called()

    def test_automigrate_enabled_runs_upgrade(self) -> None:
        os.environ.pop("MGZ_PKMN_AUTOMIGRATE", None)
        with patch.object(migrate_mod, "run_migrations_with_lock") as mock_run:
            from api.main import app

            with TestClient(app) as c:
                resp = c.get("/health")
                self.assertEqual(resp.status_code, 200)
            mock_run.assert_called_once()


# ---------------------------------------------------------------------------
# /bulk → persisted run
# ---------------------------------------------------------------------------


class BulkPersistenceTests(_IsolatedDbMixin):
    def test_bulk_writes_a_run_with_one_row_per_line(self) -> None:
        # Patch the lookup helper so we don't touch the network. Returns a
        # single unmatched row per parsed line — the test cares about
        # persistence shape, not match correctness.
        from api.routes import lookup as lookup_route

        def fake_do_lookup(pkmn, tcgdex, pc, q, settings, on_stage=None, *, cache_only=False):
            from mgz_pkmn.pricing import Pricing
            from mgz_pkmn.spreadsheet import Row

            return (
                [(Row(query=q, card=None, pricing=Pricing(), tag=settings.tag), "no_candidates")],
                "MISS",
            )

        with patch.object(lookup_route, "_do_lookup", side_effect=fake_do_lookup):
            from api.main import app

            with TestClient(app) as c:
                # Consume the SSE stream to completion so the trailing
                # `_persist_run` call fires.
                with c.stream(
                    "POST",
                    "/api/v1/bulk",
                    json={"lines": ["Charizard", "Mew"], "settings": {"tag": "test"}},
                ) as resp:
                    self.assertEqual(resp.status_code, 200)
                    events = list(resp.iter_lines())

                # One resolved-row event per line (progress-only `stage`
                # frames carry no `matched` field and are excluded).
                row_events = [e for e in events if e.startswith("data:") and "matched" in e]
                self.assertEqual(len(row_events), 2)

                # The streamed run is *not* in the saved-search listing
                # until the user names it, but the row exists in the DB
                # (we'll fetch it directly below).
                listing = c.get("/api/v1/runs").json()
                self.assertEqual(listing["total"], 0)
                self.assertEqual(listing["items"], [])

                with session_mod.get_session_factory()() as s:
                    run_id = s.scalar(select(Run.id))

                detail = c.get(f"/api/v1/runs/{run_id}").json()
                self.assertEqual(len(detail["rows"]), 2)
                self.assertEqual(detail["rows"][0]["query"]["name"], "Charizard")
                self.assertEqual(detail["rows"][0]["tag"], "test")
                self.assertEqual(detail["input_text"], "Charizard\nMew")
                self.assertIsNone(detail["name"])
                self.assertIsNone(detail["view_state"])

    def test_get_run_404s_on_missing_id(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            resp = c.get("/api/v1/runs/99999")
            self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# Saved searches: PATCH /runs/{id} + saved-only listing
# ---------------------------------------------------------------------------


class SavedSearchesTests(_IsolatedDbMixin):
    def _seed_run(
        self,
        *,
        user_id: int = DEFAULT_USER_ID,
        name: str | None = None,
    ) -> int:
        """Seed an unnamed run + return its id.

        Assumes the caller has already entered a ``TestClient`` context so
        the startup lifespan has created the schema."""
        with session_mod.get_session_factory()() as s:
            run = Run(
                user_id=user_id,
                input_text="Charizard",
                summary_json={"total_rows": 1, "matched": 1},
                name=name,
                rows=[
                    RunRow(
                        position=0,
                        tag="",
                        market_price=42.50,
                        currency="USD",
                        query_json={"raw": "Charizard", "name": "Charizard"},
                        card_json={"id": "base1-4"},
                        pricing_json={"market": 42.50, "currency": "USD"},
                    )
                ],
            )
            s.add(run)
            s.commit()
            return run.id

    def test_patch_save_names_a_run_and_surfaces_it_in_the_list(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            run_id = self._seed_run()
            self.assertEqual(c.get("/api/v1/runs").json()["total"], 0)

            view_state = {"sortColumn": "market", "sortDir": "desc", "filters": {}}
            resp = c.patch(
                f"/api/v1/runs/{run_id}",
                json={"name": "Show prep, June", "view_state": view_state},
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body["name"], "Show prep, June")
            self.assertEqual(body["view_state"], view_state)

            listing = c.get("/api/v1/runs").json()
            self.assertEqual(listing["total"], 1)
            self.assertEqual(listing["items"][0]["name"], "Show prep, June")
            self.assertEqual(listing["items"][0]["view_state"], view_state)

    def test_patch_save_rejects_empty_name(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            run_id = self._seed_run()
            resp = c.patch(f"/api/v1/runs/{run_id}", json={"name": ""})
            self.assertEqual(resp.status_code, 422)

    def test_patch_save_rejects_whitespace_only_name(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            run_id = self._seed_run()
            resp = c.patch(f"/api/v1/runs/{run_id}", json={"name": "   "})
            self.assertEqual(resp.status_code, 422)
            self.assertEqual(c.get("/api/v1/runs").json()["total"], 0)

    def test_patch_save_404s_on_missing_id(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            resp = c.patch("/api/v1/runs/99999", json={"name": "ignored"})
            self.assertEqual(resp.status_code, 404)


class SavedSearchesAuthGateTests(_IsolatedDbMixin):
    """Hosted-demo auth-on saved searches are scoped to the session user.

    Self-host behaviour remains covered by ``SavedSearchesTests`` above:
    with auth off, ``current_user_or_default`` falls through to the
    sentinel default user and the existing endpoints keep working."""

    def setUp(self) -> None:
        super().setUp()
        from api.auth.session import AUTH_ENABLED_ENV

        self._old_auth = os.environ.get(AUTH_ENABLED_ENV)
        os.environ[AUTH_ENABLED_ENV] = "1"

    def tearDown(self) -> None:
        from api.auth.session import AUTH_ENABLED_ENV

        if self._old_auth is None:
            os.environ.pop(AUTH_ENABLED_ENV, None)
        else:
            os.environ[AUTH_ENABLED_ENV] = self._old_auth
        super().tearDown()

    def _seed_run(
        self,
        *,
        user_id: int = DEFAULT_USER_ID,
        name: str | None = None,
    ) -> int:
        with session_mod.get_session_factory()() as s:
            run = Run(
                user_id=user_id,
                input_text="Charizard",
                summary_json={"total_rows": 1, "matched": 1},
                name=name,
                rows=[
                    RunRow(
                        position=0,
                        tag="",
                        market_price=42.50,
                        currency="USD",
                        query_json={"raw": "Charizard", "name": "Charizard"},
                        card_json={"id": "base1-4"},
                        pricing_json={"market": 42.50, "currency": "USD"},
                    )
                ],
            )
            s.add(run)
            s.commit()
            return run.id

    def _seed_user(self, name: str) -> int:
        with session_mod.get_session_factory()() as s:
            u = User(name=name, email=f"{name}@example.com", display_name=name.title())
            s.add(u)
            s.commit()
            return u.id

    def _as(self, user_id: int):
        from contextlib import contextmanager

        from api.auth.session import get_current_user
        from api.main import app

        @contextmanager
        def _ctx():
            with session_mod.get_session_factory()() as s:
                u = s.get(User, user_id)
            app.dependency_overrides[get_current_user] = lambda: u
            try:
                yield
            finally:
                app.dependency_overrides.pop(get_current_user, None)

        return _ctx()

    def test_anonymous_list_is_401_when_auth_is_on(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            resp = c.get("/api/v1/runs")
            self.assertEqual(resp.status_code, 401)

    def test_anonymous_patch_save_is_401_when_auth_is_on(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            run_id = self._seed_run()
            resp = c.patch(f"/api/v1/runs/{run_id}", json={"name": "Show prep"})
            self.assertEqual(resp.status_code, 401)

    def test_list_filters_saved_runs_to_current_user(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            uid_a = self._seed_user("alice")
            uid_b = self._seed_user("bob")
            self._seed_run(user_id=uid_a, name="Alice prep")
            self._seed_run(user_id=uid_b, name="Bob prep")

            with self._as(uid_a):
                listing = c.get("/api/v1/runs").json()
                self.assertEqual(listing["total"], 1)
                self.assertEqual(listing["items"][0]["name"], "Alice prep")

            with self._as(uid_b):
                listing = c.get("/api/v1/runs").json()
                self.assertEqual(listing["total"], 1)
                self.assertEqual(listing["items"][0]["name"], "Bob prep")

    def test_patch_save_claims_unnamed_default_run_for_signed_in_user(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            uid = self._seed_user("alice")
            run_id = self._seed_run()

            with self._as(uid):
                resp = c.patch(f"/api/v1/runs/{run_id}", json={"name": "Show prep"})

            self.assertEqual(resp.status_code, 200)
            with session_mod.get_session_factory()() as s:
                run = s.get(Run, run_id)
                assert run is not None
                self.assertEqual(run.user_id, uid)

    def test_patch_save_404s_for_another_users_saved_run(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            uid_a = self._seed_user("alice")
            uid_b = self._seed_user("bob")
            run_id = self._seed_run(user_id=uid_a, name="Alice prep")

            with self._as(uid_b):
                resp = c.patch(f"/api/v1/runs/{run_id}", json={"name": "Stolen"})

            self.assertEqual(resp.status_code, 404)

    def test_get_run_404s_for_another_users_saved_run(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            uid_a = self._seed_user("alice")
            uid_b = self._seed_user("bob")
            run_id = self._seed_run(user_id=uid_a, name="Alice prep")

            with self._as(uid_b):
                resp = c.get(f"/api/v1/runs/{run_id}")

            self.assertEqual(resp.status_code, 404)

    def test_get_run_404s_anonymously_for_a_users_saved_run(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            uid_a = self._seed_user("alice")
            run_id = self._seed_run(user_id=uid_a, name="Alice prep")
            resp = c.get(f"/api/v1/runs/{run_id}")
            self.assertEqual(resp.status_code, 401)

    def test_get_run_returns_owners_saved_run(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            uid = self._seed_user("alice")
            run_id = self._seed_run(user_id=uid, name="Alice prep")

            with self._as(uid):
                resp = c.get(f"/api/v1/runs/{run_id}")

            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["name"], "Alice prep")

    def test_get_run_allows_handoff_read_of_unnamed_default_run(self) -> None:
        # Pre-sign-in `/bulk` persists with DEFAULT_USER_ID; the SPA
        # still needs to load that run after sign-in to promote it.
        from api.main import app

        with TestClient(app) as c:
            uid = self._seed_user("alice")
            run_id = self._seed_run()  # DEFAULT_USER_ID, name=None

            with self._as(uid):
                resp = c.get(f"/api/v1/runs/{run_id}")

            self.assertEqual(resp.status_code, 200)

    def test_bulk_persists_run_for_signed_in_user(self) -> None:
        from api.main import app
        from api.routes import lookup as lookup_route

        def fake_do_lookup(pkmn, tcgdex, pc, q, settings, on_stage=None, *, cache_only=False):
            from mgz_pkmn.pricing import Pricing
            from mgz_pkmn.spreadsheet import Row

            return (
                [(Row(query=q, card=None, pricing=Pricing(), tag=settings.tag), "no_candidates")],
                "MISS",
            )

        with TestClient(app) as c:
            uid = self._seed_user("alice")
            with (
                self._as(uid),
                patch.object(
                    lookup_route,
                    "_do_lookup",
                    side_effect=fake_do_lookup,
                ),
                c.stream(
                    "POST",
                    "/api/v1/bulk",
                    json={"lines": ["Charizard"], "settings": {"tag": "test"}},
                ) as resp,
            ):
                self.assertEqual(resp.status_code, 200)
                list(resp.iter_lines())

            with session_mod.get_session_factory()() as s:
                run = s.scalar(select(Run))
                assert run is not None
                self.assertEqual(run.user_id, uid)


# ---------------------------------------------------------------------------
# serialize round-trip
# ---------------------------------------------------------------------------


class SerializeRoundTripTests(unittest.TestCase):
    def test_strict_price_bounds_round_trip(self) -> None:
        """`price_*_exclusive` survive the Row → RunRow → Row round-trip."""
        from api.db.serialize import row_to_run_row, run_row_to_row
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        q = CardQuery(
            raw="charizard >$10 <$50",
            name="charizard",
            price_min=10.0,
            price_max=50.0,
            price_min_exclusive=True,
            price_max_exclusive=True,
        )
        row = Row(query=q, card={"id": "x"}, pricing=Pricing(market=20.0), tag="")

        restored = run_row_to_row(row_to_run_row(row, position=0))
        self.assertTrue(restored.query.price_min_exclusive)
        self.assertTrue(restored.query.price_max_exclusive)
        self.assertEqual(restored.query.price_min, 10.0)
        self.assertEqual(restored.query.price_max, 50.0)

    def test_ebay_comp_signals_round_trip(self) -> None:
        """`ebay_sold_median` / `ebay_active_floor` survive the Row → RunRow →
        Row round-trip via `pricing_json` (#423)."""
        from api.db.serialize import row_to_run_row, run_row_to_row
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        row = Row(
            query=CardQuery(raw="charizard", name="charizard"),
            card={"id": "x"},
            pricing=Pricing(market=250.0, ebay_sold_median=230.0, ebay_active_floor=199.99),
            tag="",
        )
        restored = run_row_to_row(row_to_run_row(row, position=0))
        self.assertEqual(restored.pricing.ebay_sold_median, 230.0)
        self.assertEqual(restored.pricing.ebay_active_floor, 199.99)

    def test_currency_is_null_on_unpriced_miss(self) -> None:
        """An unmatched/unpriced row stores `currency = NULL`, not the
        `Pricing.currency` "USD" default."""
        from api.db.serialize import row_to_run_row
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        row = Row(
            query=CardQuery(raw="missingmon", name="missingmon"),
            card=None,
            pricing=Pricing(),  # market=None, currency defaults to "USD"
            tag="",
        )
        rr = row_to_run_row(row, position=0)
        self.assertIsNone(rr.market_price)
        self.assertIsNone(rr.currency)


# ---------------------------------------------------------------------------
# SQLite flock — gates concurrent acquires
# ---------------------------------------------------------------------------


@unittest.skipUnless(
    importlib.util.find_spec("fcntl") is not None,
    "fcntl unavailable — _sqlite_flock is a no-op on this platform",
)
class SqliteFlockTests(unittest.TestCase):
    def test_second_acquire_blocks_until_first_releases(self) -> None:
        """The flock is exclusive — a second `_sqlite_flock` on the same path
        must wait until the first releases."""
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "lock.db"
            db_path.touch()

            holder_acquired = threading.Event()
            holder_release = threading.Event()
            second_attempting = threading.Event()
            second_acquired_at: dict[str, float] = {}

            def hold_first() -> None:
                with _sqlite_flock(db_path):
                    holder_acquired.set()
                    holder_release.wait(timeout=5.0)

            def take_second() -> None:
                holder_acquired.wait(timeout=5.0)
                # Signal that we're about to block on the held lock, so the
                # main thread doesn't release before we've started waiting.
                second_attempting.set()
                start = time.monotonic()
                with _sqlite_flock(db_path):
                    second_acquired_at["delay"] = time.monotonic() - start

            t1 = threading.Thread(target=hold_first)
            t2 = threading.Thread(target=take_second)
            t1.start()
            t2.start()
            # Wait until the second thread has reached its acquire attempt,
            # then give it a beat to actually block inside flock() before the
            # holder releases — without this the delay can race to ~0.
            second_attempting.wait(timeout=5.0)
            time.sleep(0.1)
            holder_release.set()
            t1.join(timeout=2.0)
            t2.join(timeout=2.0)

            self.assertIn("delay", second_acquired_at)
            self.assertGreater(second_acquired_at["delay"], 0.05)


# ---------------------------------------------------------------------------
# run_migrations_with_lock end-to-end
# ---------------------------------------------------------------------------


class RunMigrationsEndToEndTests(_IsolatedDbMixin):
    def test_run_migrations_creates_lockfile_and_tables(self) -> None:
        engine = session_mod.get_engine()
        run_migrations_with_lock(engine)
        # Tables exist.
        self.assertIn("users", set(inspect(engine).get_table_names()))
        # Lockfile sits next to the DB.
        lock = self._db_path.parent / f"{self._db_path.name}.migrate.lock"
        self.assertTrue(lock.exists())

    def test_run_migrations_against_memory_sqlite_skips_lockfile(self) -> None:
        """In-memory sqlite has no on-disk path → no lockfile is created.

        We don't assert on the schema here because Alembic opens its own
        connection via `engine_from_config(NullPool)` during upgrade — and
        in-memory SQLite databases are connection-scoped, so the upgrade's
        connection sees a different DB than `inspect(engine)` would on a
        fresh acquire. The contract under test is just "doesn't crash and
        doesn't leave a lockfile in cwd."
        """
        engine = create_engine("sqlite:///:memory:")
        try:
            run_migrations_with_lock(engine)
            self.assertFalse(Path("memory.migrate.lock").exists())
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
