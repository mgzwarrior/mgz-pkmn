"""Tests for the ADR-0013 persistence layer.

Covers:

- URL resolution (env-var override + cache-root fallback).
- Alembic migration round-trip (upgrade → seed → downgrade → re-upgrade).
- `MGZ_PKMN_AUTOMIGRATE=0` opt-out skips startup migration.
- `/api/v1/bulk` writes a run after the SSE stream completes.
- `/api/v1/runs` list + detail return the persisted shape.
- `/api/v1/runs/{id}/export` re-renders a stored run as xlsx without
  re-fetching from the network.
- SQLite flock takes effect (a second acquire blocks while held).

Each test points `MGZ_PKMN_DATABASE_URL` at a fresh tempfile so the user's
real `~/.cache/mgz-pkmn/mgz-pkmn.db` is never touched.
"""

from __future__ import annotations

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
from api.db.models import Run, RunRow, User
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

        def fake_do_lookup(pkmn, tcgdex, pc, q, settings, on_stage=None):
            from mgz_pkmn.pricing import Pricing
            from mgz_pkmn.spreadsheet import Row

            return [(Row(query=q, card=None, pricing=Pricing(), tag=settings.tag), "no_candidates")]

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

                # The run is visible immediately via /runs.
                listing = c.get("/api/v1/runs").json()
                self.assertEqual(listing["total"], 1)
                self.assertEqual(len(listing["items"]), 1)
                run_id = listing["items"][0]["id"]
                self.assertEqual(listing["items"][0]["row_count"], 2)

                detail = c.get(f"/api/v1/runs/{run_id}").json()
                self.assertEqual(len(detail["rows"]), 2)
                self.assertEqual(detail["rows"][0]["query"]["name"], "Charizard")
                self.assertEqual(detail["rows"][0]["tag"], "test")
                self.assertEqual(detail["input_text"], "Charizard\nMew")

    def test_get_run_404s_on_missing_id(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            resp = c.get("/api/v1/runs/99999")
            self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# Re-export from a stored run
# ---------------------------------------------------------------------------


class ReExportTests(_IsolatedDbMixin):
    def test_re_export_returns_xlsx_without_network(self) -> None:
        """A run with one matched row re-exports as a valid xlsx attachment.

        Matching `card` payload is synthetic — we never hit pokemontcg.io
        because the re-export pulls from `run_rows`."""
        from api.db.models import Run
        from api.main import app

        with TestClient(app) as c:
            # Seed a run directly via the ORM (faster than going through /bulk).
            with session_mod.get_session_factory()() as s:
                run = Run(
                    input_text="Charizard | Base Set",
                    elapsed_seconds=0.1,
                    summary_json={"total_rows": 1, "matched": 1},
                    rows=[
                        RunRow(
                            position=0,
                            tag="",
                            market_price=42.50,
                            currency="USD",
                            query_json={"raw": "Charizard", "name": "Charizard"},
                            card_json={
                                "id": "base1-4",
                                "name": "Charizard",
                                "set": {"id": "base1"},
                            },
                            pricing_json={"market": 42.50, "currency": "USD"},
                        )
                    ],
                )
                s.add(run)
                s.commit()
                run_id = run.id

            resp = c.post(
                f"/api/v1/runs/{run_id}/export",
                json={"format": "xlsx", "no_images": True},
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(
                resp.headers["content-type"],
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            self.assertGreater(len(resp.content), 0)
            self.assertTrue(resp.content.startswith(b"PK"))  # xlsx is a zip

    def test_re_export_unknown_format_returns_400(self) -> None:
        from api.main import app

        with TestClient(app) as c:
            # Need a run to target — re-export validates format before fetch.
            with session_mod.get_session_factory()() as s:
                s.add(Run(input_text="x", summary_json={}))
                s.commit()
                run_id = s.scalar(select(Run.id))
            resp = c.post(f"/api/v1/runs/{run_id}/export", json={"format": "xml"})
            self.assertEqual(resp.status_code, 400)


# ---------------------------------------------------------------------------
# SQLite flock — gates concurrent acquires
# ---------------------------------------------------------------------------


class SqliteFlockTests(unittest.TestCase):
    def test_second_acquire_blocks_until_first_releases(self) -> None:
        """The flock is exclusive — a second `_sqlite_flock` on the same path
        must wait until the first releases."""
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "lock.db"
            db_path.touch()

            holder_acquired = threading.Event()
            holder_release = threading.Event()
            second_acquired_at: dict[str, float] = {}

            def hold_first() -> None:
                with _sqlite_flock(db_path):
                    holder_acquired.set()
                    holder_release.wait(timeout=5.0)

            def take_second() -> None:
                holder_acquired.wait(timeout=5.0)
                start = time.monotonic()
                with _sqlite_flock(db_path):
                    second_acquired_at["delay"] = time.monotonic() - start

            t1 = threading.Thread(target=hold_first)
            t2 = threading.Thread(target=take_second)
            t1.start()
            t2.start()
            # Give the second waiter time to attempt + block.
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
