"""Tests for the 30-day price-trend sparkline backend (#269).

Covers:

- Alembic migration up/down round-trip for `price_snapshots`.
- `record_price_snapshot` / `fetch_price_history`: no-ops on unresolvable
  identity/price, the 30-day window, and same-day downsampling.
- `/api/v1/lookup` and `/api/v1/bulk` write a snapshot per matched, priced
  row and attach `pricing.price_history` — absent on a lone snapshot,
  populated once a second distinct day of history exists, and untouched
  for unmatched rows.

Mirrors the isolation pattern from `tests/test_swipe.py`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select

from api.db import session as session_mod
from api.db.migrate import upgrade_head
from api.db.models import PriceSnapshot
from api.db.price_history import fetch_price_history, record_price_snapshot


class _IsolatedDbMixin(unittest.TestCase):
    """Point MGZ_PKMN_DATABASE_URL at a fresh sqlite file per test."""

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


CHARIZARD = {
    "id": "base1-4",
    "name": "Charizard",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "4",
    "rarity": "Rare Holo",
}


# ---------------------------------------------------------------------------
# Migration round-trip
# ---------------------------------------------------------------------------


class PriceSnapshotMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_price_snapshots(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("price_snapshots", set(inspect(engine).get_table_names()))

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("price_snapshots", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Step back to the revision underneath this one; price_snapshots
        # comes down, the rest of the schema survives.
        command.downgrade(cfg, "d4f7a2c8e5b1")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("price_snapshots", names)
        self.assertIn("collection_items", names)

        upgrade_head(engine)
        self.assertIn("price_snapshots", set(inspect(engine).get_table_names()))


# ---------------------------------------------------------------------------
# record_price_snapshot / fetch_price_history
# ---------------------------------------------------------------------------


class RecordAndFetchPriceHistoryTests(_IsolatedDbMixin):
    def _session(self):
        engine = session_mod.get_engine()
        upgrade_head(engine)
        return session_mod.get_session_factory()()

    def test_noop_when_card_identity_or_price_missing(self) -> None:
        session = self._session()
        record_price_snapshot(
            session,
            card_set_id=None,
            card_number="4",
            source="tcgplayer",
            price=10.0,
            currency="USD",
        )
        record_price_snapshot(
            session,
            card_set_id="base1",
            card_number=None,
            source="tcgplayer",
            price=10.0,
            currency="USD",
        )
        record_price_snapshot(
            session,
            card_set_id="base1",
            card_number="4",
            source="tcgplayer",
            price=None,
            currency="USD",
        )
        session.commit()
        count = session.scalar(select(func.count(PriceSnapshot.id)))
        self.assertEqual(count, 0)

    def test_single_snapshot_is_not_a_trend(self) -> None:
        session = self._session()
        record_price_snapshot(
            session,
            card_set_id="base1",
            card_number="4",
            source="tcgplayer",
            price=100.0,
            currency="USD",
        )
        session.commit()
        history = fetch_price_history(session, card_set_id="base1", card_number="4")
        self.assertIsNone(history)

    def test_two_distinct_days_return_sorted_points(self) -> None:
        # `record_price_snapshot` stamps `captured_at` at the real wall
        # clock (`_utcnow`) — anchor `now` there too so the write and the
        # read agree on "today" regardless of when the test runs.
        session = self._session()
        now = datetime.now(UTC)
        session.add(
            PriceSnapshot(
                card_set_id="base1",
                card_number="4",
                source="tcgplayer",
                price=90.0,
                currency="USD",
                captured_at=now - timedelta(days=5),
            )
        )
        session.commit()
        record_price_snapshot(
            session,
            card_set_id="base1",
            card_number="4",
            source="tcgplayer",
            price=100.0,
            currency="USD",
        )
        session.commit()

        history = fetch_price_history(session, card_set_id="base1", card_number="4", now=now)
        self.assertEqual(
            history,
            [
                {"ts": (now - timedelta(days=5)).date().isoformat(), "price": 90.0},
                {"ts": now.date().isoformat(), "price": 100.0},
            ],
        )

    def test_same_day_snapshots_downsample_to_the_latest_price(self) -> None:
        session = self._session()
        day = datetime(2026, 7, 20, tzinfo=UTC)
        other_day = datetime(2026, 7, 21, tzinfo=UTC)
        session.add_all(
            [
                PriceSnapshot(
                    card_set_id="base1",
                    card_number="4",
                    source="tcgplayer",
                    price=80.0,
                    currency="USD",
                    captured_at=day,
                ),
                PriceSnapshot(
                    card_set_id="base1",
                    card_number="4",
                    source="tcgplayer",
                    price=95.0,
                    currency="USD",
                    captured_at=day + timedelta(hours=6),
                ),
                PriceSnapshot(
                    card_set_id="base1",
                    card_number="4",
                    source="tcgplayer",
                    price=99.0,
                    currency="USD",
                    captured_at=other_day,
                ),
            ]
        )
        session.commit()

        history = fetch_price_history(session, card_set_id="base1", card_number="4", now=other_day)
        # Two distinct days: `day` keeps its *later* observation (95.0, not
        # the first 80.0 write), `other_day` has its own single point.
        self.assertEqual(
            history,
            [
                {"ts": day.date().isoformat(), "price": 95.0},
                {"ts": other_day.date().isoformat(), "price": 99.0},
            ],
        )

    def test_snapshots_outside_the_30_day_window_are_excluded(self) -> None:
        session = self._session()
        now = datetime(2026, 7, 22, tzinfo=UTC)
        session.add_all(
            [
                PriceSnapshot(
                    card_set_id="base1",
                    card_number="4",
                    source="tcgplayer",
                    price=50.0,
                    currency="USD",
                    captured_at=now - timedelta(days=40),
                ),
                PriceSnapshot(
                    card_set_id="base1",
                    card_number="4",
                    source="tcgplayer",
                    price=100.0,
                    currency="USD",
                    captured_at=now - timedelta(days=1),
                ),
            ]
        )
        session.commit()

        # Only one snapshot falls inside the window — not a trend yet.
        history = fetch_price_history(session, card_set_id="base1", card_number="4", now=now)
        self.assertIsNone(history)

    def test_history_is_scoped_to_the_specific_card(self) -> None:
        session = self._session()
        now = datetime(2026, 7, 22, tzinfo=UTC)
        session.add_all(
            [
                PriceSnapshot(
                    card_set_id="base1",
                    card_number="4",
                    source="tcgplayer",
                    price=100.0,
                    currency="USD",
                    captured_at=now - timedelta(days=3),
                ),
                PriceSnapshot(
                    card_set_id="base1",
                    card_number="2",
                    source="tcgplayer",
                    price=40.0,
                    currency="USD",
                    captured_at=now - timedelta(days=2),
                ),
            ]
        )
        session.commit()

        history = fetch_price_history(session, card_set_id="base1", card_number="4", now=now)
        self.assertIsNone(history)


# ---------------------------------------------------------------------------
# /api/v1/lookup and /api/v1/bulk wiring
# ---------------------------------------------------------------------------


class AttachPriceHistoryEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def _matched_row(self, market: float):
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        q = CardQuery(raw="Charizard", name="Charizard")
        row = Row(
            query=q, card=CHARIZARD, pricing=Pricing(market=market, source="tcgplayer"), tag=""
        )
        return [(row, "matched")], "HIT"

    def test_lookup_writes_a_snapshot_and_omits_history_on_first_sighting(self) -> None:
        with self._client() as c:
            with patch("api.routes.lookup._do_lookup", return_value=self._matched_row(100.0)):
                resp = c.post("/api/v1/lookup", json={"line": "Charizard"})

            self.assertEqual(resp.status_code, 200)
            row = resp.json()["rows"][0]
            # Empty-history fallback: a single day of data isn't a trend yet.
            self.assertIsNone(row["pricing"]["price_history"])

            with session_mod.get_session_factory()() as s:
                count = s.scalar(select(func.count(PriceSnapshot.id)))
                self.assertEqual(count, 1)
                snap = s.execute(select(PriceSnapshot)).scalar_one()
                self.assertEqual(snap.card_set_id, "base1")
                self.assertEqual(snap.card_number, "4")
                self.assertEqual(snap.price, 100.0)
                self.assertEqual(snap.source, "tcgplayer")

    def test_price_history_appears_once_a_second_day_exists(self) -> None:
        with self._client() as c:
            # Seed a snapshot from "5 days ago" directly, bypassing the
            # write path — this is what an earlier day's lookup would have
            # left behind.
            engine = session_mod.get_engine()
            upgrade_head(engine)
            with session_mod.get_session_factory()() as s:
                s.add(
                    PriceSnapshot(
                        card_set_id="base1",
                        card_number="4",
                        source="tcgplayer",
                        price=90.0,
                        currency="USD",
                        captured_at=datetime.now(UTC) - timedelta(days=5),
                    )
                )
                s.commit()

            with patch("api.routes.lookup._do_lookup", return_value=self._matched_row(110.0)):
                resp = c.post("/api/v1/lookup", json={"line": "Charizard"})

            history = resp.json()["rows"][0]["pricing"]["price_history"]
            self.assertIsNotNone(history)
            self.assertEqual(len(history), 2)
            self.assertEqual(history[0]["price"], 90.0)
            self.assertEqual(history[-1]["price"], 110.0)

    def test_unmatched_row_writes_nothing_and_has_no_history(self) -> None:
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        unmatched = Row(
            query=CardQuery(raw="Nonsense", name="Nonsense"), card=None, pricing=Pricing(), tag=""
        )
        with self._client() as c:
            with patch(
                "api.routes.lookup._do_lookup",
                return_value=([(unmatched, "no_candidates")], "MISS"),
            ):
                resp = c.post("/api/v1/lookup", json={"line": "Nonsense"})

            row = resp.json()["rows"][0]
            self.assertIsNone(row["pricing"]["price_history"])

            with session_mod.get_session_factory()() as s:
                count = s.scalar(select(func.count(PriceSnapshot.id)))
                self.assertEqual(count, 0)

    def test_bulk_stream_also_attaches_price_history(self) -> None:
        with self._client() as c:
            engine = session_mod.get_engine()
            upgrade_head(engine)
            with session_mod.get_session_factory()() as s:
                s.add(
                    PriceSnapshot(
                        card_set_id="base1",
                        card_number="4",
                        source="tcgplayer",
                        price=90.0,
                        currency="USD",
                        captured_at=datetime.now(UTC) - timedelta(days=2),
                    )
                )
                s.commit()

            def fake(pkmn, tcgdex, pc, q, settings, on_stage=None, *, cache_only=False, ebay=None):
                return self._matched_row(110.0)

            with (
                patch("api.routes.lookup._do_lookup", side_effect=fake),
                c.stream("POST", "/api/v1/bulk", json={"lines": ["Charizard"]}) as resp,
            ):
                events = [e for e in resp.iter_lines() if e.startswith("data:") and "matched" in e]

            import json as _json

            row = _json.loads(events[0][len("data: ") :])
            history = row["pricing"]["price_history"]
            self.assertIsNotNone(history)
            self.assertEqual(len(history), 2)
            self.assertEqual(history[-1]["price"], 110.0)
