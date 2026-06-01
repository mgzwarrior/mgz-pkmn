"""Coverage for `warm_cards` + the `card_warm.json` manifest helpers.

Phase 1 of the pre-Scrydex catalog-warm epic (#368). Validates that:

- `warm_cards` walks the supplied set ids, fan-out-writes per-card cache
  entries under synthesized `/v2/cards/{id}` URLs, and returns counts
  that match what landed on disk.
- `--skip-existing` honors already-present entries (count them as
  warmed, don't re-write).
- `--max-cards` short-circuits the walk mid-pass.
- The freshness gate + read/write helpers behave the same way as the
  other three warm manifests (concept, set-cards, sets).

Network is mocked at `TCGClient.search_all` so no real upstream is hit.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.lookup import warm_cards
from mgz_pkmn.sources.pokemontcg import API_BASE, TCGClient


class _IsolatedCacheMixin(unittest.TestCase):
    """Point XDG_CACHE_HOME at a tempdir so writes don't touch the user's real cache."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(disk_cache._NO_CACHE_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(disk_cache._NO_CACHE_ENV, None)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(disk_cache._NO_CACHE_ENV, None)
        else:
            os.environ[disk_cache._NO_CACHE_ENV] = self._old_no_cache
        self._tmp.cleanup()


# ---------------------------------------------------------------------------
# Manifest helpers (mirror tests/test_warm_sets_manifest.py)
# ---------------------------------------------------------------------------


class CardWarmManifestTests(_IsolatedCacheMixin):
    def test_read_returns_none_when_absent(self) -> None:
        self.assertIsNone(disk_cache.read_card_warm())

    def test_write_then_read_roundtrip(self) -> None:
        disk_cache.write_card_warm(
            cards_warmed=18_500,
            cards_failed=12,
            sets_attempted=173,
            sets_failed=["bogus"],
        )
        data = disk_cache.read_card_warm()
        self.assertIsNotNone(data)
        assert data is not None  # narrow for type checkers
        self.assertEqual(data["cards_warmed"], 18_500)
        self.assertEqual(data["cards_failed"], 12)
        self.assertEqual(data["sets_attempted"], 173)
        self.assertEqual(data["sets_failed"], ["bogus"])
        self.assertIsInstance(data["timestamp"], float)

    def test_read_rejects_malformed_payload(self) -> None:
        path = disk_cache._card_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json", encoding="utf-8")
        self.assertIsNone(disk_cache.read_card_warm())

    def test_read_rejects_unknown_schema_version(self) -> None:
        path = disk_cache._card_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "version": 99,
                    "timestamp": 0.0,
                    "cards_warmed": 0,
                    "cards_failed": 0,
                    "sets_attempted": 0,
                    "sets_failed": [],
                }
            ),
            encoding="utf-8",
        )
        self.assertIsNone(disk_cache.read_card_warm())


class CardWarmFreshnessTests(_IsolatedCacheMixin):
    def test_no_manifest_is_not_fresh(self) -> None:
        self.assertFalse(disk_cache.card_warm_is_fresh())

    def test_fresh_within_window(self) -> None:
        disk_cache.write_card_warm(
            cards_warmed=10, cards_failed=0, sets_attempted=1, sets_failed=[]
        )
        self.assertTrue(disk_cache.card_warm_is_fresh())

    def test_stale_outside_window(self) -> None:
        disk_cache.write_card_warm(
            cards_warmed=10, cards_failed=0, sets_attempted=1, sets_failed=[]
        )
        future = time.time() + (8 * 24 * 60 * 60)
        self.assertFalse(disk_cache.card_warm_is_fresh(now=future))

    def test_zero_warmed_manifest_is_not_fresh(self) -> None:
        disk_cache.write_card_warm(
            cards_warmed=0, cards_failed=10, sets_attempted=1, sets_failed=["a"]
        )
        self.assertFalse(disk_cache.card_warm_is_fresh())

    def test_malformed_timestamp_is_not_fresh(self) -> None:
        path = disk_cache._card_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "version": disk_cache.CARD_WARM_SCHEMA_VERSION,
                    "timestamp": "yesterday",
                    "cards_warmed": 18_500,
                    "cards_failed": 0,
                    "sets_attempted": 173,
                    "sets_failed": [],
                }
            ),
            encoding="utf-8",
        )
        self.assertFalse(disk_cache.card_warm_is_fresh())


# ---------------------------------------------------------------------------
# warm_cards behavior
# ---------------------------------------------------------------------------


class WarmCardsTests(_IsolatedCacheMixin):
    """Drives `warm_cards` with a mocked `TCGClient.search_all` so each set
    returns a synthetic card list. The test asserts (a) what landed on disk
    via the synthesized per-card URL keys and (b) the returned counts."""

    @staticmethod
    def _set_payload(set_id: str, n: int) -> list[dict]:
        """Return n synthetic cards stamped as belonging to `set_id`."""
        return [
            {
                "id": f"{set_id}-{i}",
                "name": f"Card{i}",
                "number": str(i),
                "set": {"id": set_id, "name": set_id.title()},
            }
            for i in range(1, n + 1)
        ]

    def test_writes_one_cache_entry_per_card(self) -> None:
        sets = {"sv8": self._set_payload("sv8", 3), "sv7": self._set_payload("sv7", 2)}
        with patch.object(
            TCGClient,
            "search_all",
            side_effect=lambda q, **_kw: sets[q.split('"')[1]],
        ):
            result = warm_cards(TCGClient(), set_ids=list(sets))

        self.assertEqual(result.sets_attempted, 2)
        self.assertEqual(result.cards_warmed, 5)
        self.assertEqual(result.cards_failed, 0)
        self.assertEqual(result.sets_failed, [])

        # Each card landed at its synthesized URL key.
        for cards in sets.values():
            for card in cards:
                payload = disk_cache.read_api(f"{API_BASE}/cards/{card['id']}")
                self.assertIsNotNone(payload, f"missing entry for {card['id']}")
                assert payload is not None
                self.assertEqual(payload[0]["id"], card["id"])

    def test_skip_existing_counts_pre_warmed_cards_without_rewrite(self) -> None:
        # Pre-seed one card's per-id entry; the warm pass should count it
        # as warmed without re-writing the file.
        sets = {"sv8": self._set_payload("sv8", 3)}
        pre_card = sets["sv8"][0]
        pre_url = f"{API_BASE}/cards/{pre_card['id']}"
        disk_cache.write_api(pre_url, [{"id": pre_card["id"], "name": "Stale"}])

        with patch.object(TCGClient, "search_all", side_effect=lambda q, **_kw: sets["sv8"]):
            result = warm_cards(TCGClient(), set_ids=["sv8"], skip_existing=True)

        self.assertEqual(result.cards_warmed, 3)
        # Pre-existing entry was NOT overwritten with the fresh payload.
        cached = disk_cache.read_api(pre_url)
        assert cached is not None
        self.assertEqual(cached[0]["name"], "Stale")

    def test_no_skip_existing_overwrites_pre_warmed_cards(self) -> None:
        sets = {"sv8": self._set_payload("sv8", 1)}
        pre_card = sets["sv8"][0]
        pre_url = f"{API_BASE}/cards/{pre_card['id']}"
        disk_cache.write_api(pre_url, [{"id": pre_card["id"], "name": "Stale"}])

        with patch.object(TCGClient, "search_all", side_effect=lambda q, **_kw: sets["sv8"]):
            warm_cards(TCGClient(), set_ids=["sv8"], skip_existing=False)

        # Pre-existing entry got rewritten with the fresh payload.
        cached = disk_cache.read_api(pre_url)
        assert cached is not None
        self.assertEqual(cached[0]["name"], "Card1")

    def test_max_cards_short_circuits_mid_pass(self) -> None:
        sets = {"sv8": self._set_payload("sv8", 5), "sv7": self._set_payload("sv7", 5)}
        with patch.object(
            TCGClient,
            "search_all",
            side_effect=lambda q, **_kw: sets[q.split('"')[1]],
        ):
            result = warm_cards(TCGClient(), set_ids=list(sets), max_cards=3)

        # Capped at 3 even though 10 cards were available.
        self.assertEqual(result.cards_warmed, 3)
        # The second set never got touched.
        self.assertEqual(result.sets_attempted, 1)

    def test_set_returning_no_cards_lands_in_sets_failed(self) -> None:
        sets = {"sv8": self._set_payload("sv8", 2), "ghost": []}
        with patch.object(
            TCGClient,
            "search_all",
            side_effect=lambda q, **_kw: sets[q.split('"')[1]],
        ):
            result = warm_cards(TCGClient(), set_ids=list(sets))

        self.assertEqual(result.cards_warmed, 2)
        self.assertEqual(result.sets_failed, ["ghost"])

    def test_write_failure_counts_as_failed_not_warmed(self) -> None:
        """Read-back verification: when `write_api` silently fails (it swallows
        OSError/TypeError/ValueError internally), warm_cards must not lie about
        success. The card lands in `cards_failed`, not `cards_warmed`, so the
        freshness gate's `cards_warmed > 0` guard doesn't suppress retries
        when the disk is broken."""
        sets = {"sv8": self._set_payload("sv8", 2)}

        # First write succeeds normally; second has `write_api` silently no-op
        # (simulating a serialization failure or read-only fs). Because
        # write_api swallows the error, the read-back is the only signal.
        original_write = disk_cache.write_api
        call_count = {"n": 0}

        def flaky_write(key: str, data) -> None:
            call_count["n"] += 1
            if call_count["n"] == 2:
                return  # silent failure — file never lands
            original_write(key, data)

        with (
            patch.object(TCGClient, "search_all", side_effect=lambda q, **_kw: sets["sv8"]),
            patch.object(disk_cache, "write_api", side_effect=flaky_write),
        ):
            result = warm_cards(TCGClient(), set_ids=["sv8"], skip_existing=False)

        self.assertEqual(result.cards_warmed, 1)
        self.assertEqual(result.cards_failed, 1)

    def test_throttle_ms_sleeps_between_sets(self) -> None:
        """`throttle_ms` paces the set-level walk so a no-API-key deploy
        doesn't burst through pokemontcg.io's 30-rpm free-tier ceiling.
        Patches `time.sleep` to observe the calls without actually sleeping."""
        from mgz_pkmn import lookup as lookup_mod

        sets = {"sv8": self._set_payload("sv8", 1), "sv7": self._set_payload("sv7", 1)}

        with (
            patch.object(
                TCGClient,
                "search_all",
                side_effect=lambda q, **_kw: sets[q.split('"')[1]],
            ),
            patch.object(lookup_mod.time, "sleep") as mock_sleep,
        ):
            warm_cards(TCGClient(), set_ids=list(sets), throttle_ms=250)

        # One sleep per set walked (both succeed). 250 ms == 0.25 s.
        self.assertEqual(mock_sleep.call_count, 2)
        for call in mock_sleep.call_args_list:
            self.assertAlmostEqual(call.args[0], 0.25, places=3)

    def test_throttle_ms_also_sleeps_after_empty_set(self) -> None:
        """A set whose search returns no cards still gets a throttle sleep
        before moving to the next id — the upstream call happened either
        way, so the rate-limit budget got spent."""
        from mgz_pkmn import lookup as lookup_mod

        with (
            patch.object(TCGClient, "search_all", return_value=[]),
            patch.object(lookup_mod.time, "sleep") as mock_sleep,
        ):
            warm_cards(TCGClient(), set_ids=["ghost"], throttle_ms=100)

        self.assertEqual(mock_sleep.call_count, 1)

    def test_card_without_id_lands_in_failed(self) -> None:
        """A malformed card object (no `id` field) increments `cards_failed`
        rather than silently dropping it. Catches upstream schema drift."""
        bad_card = {"name": "Mystery"}  # no id
        good_card = {"id": "sv8-1", "name": "Card1"}
        with patch.object(
            TCGClient,
            "search_all",
            return_value=[bad_card, good_card],
        ):
            result = warm_cards(TCGClient(), set_ids=["sv8"])

        self.assertEqual(result.cards_warmed, 1)
        self.assertEqual(result.cards_failed, 1)

    def test_progress_callback_fires_once_per_set(self) -> None:
        sets = {"sv8": self._set_payload("sv8", 1), "sv7": self._set_payload("sv7", 1)}
        calls: list[tuple[int, int, str]] = []

        with patch.object(
            TCGClient,
            "search_all",
            side_effect=lambda q, **_kw: sets[q.split('"')[1]],
        ):
            warm_cards(
                TCGClient(),
                set_ids=list(sets),
                on_progress=lambda i, t, s: calls.append((i, t, s)),
            )

        self.assertEqual(calls, [(1, 2, "sv8"), (2, 2, "sv7")])


# ---------------------------------------------------------------------------
# CacheStats projection
# ---------------------------------------------------------------------------


class CardWarmStatsProjectionTests(_IsolatedCacheMixin):
    def test_stats_reflects_card_warm_manifest(self) -> None:
        disk_cache.write_card_warm(
            cards_warmed=18_500, cards_failed=12, sets_attempted=173, sets_failed=["x"]
        )
        s = disk_cache.stats()
        self.assertEqual(s.card_warm_count, 18_500)
        self.assertEqual(s.card_warm_failed_count, 12)
        self.assertIsInstance(s.card_warm_timestamp, float)

    def test_stats_zeroed_when_no_manifest(self) -> None:
        s = disk_cache.stats()
        self.assertEqual(s.card_warm_count, 0)
        self.assertEqual(s.card_warm_failed_count, 0)
        self.assertIsNone(s.card_warm_timestamp)


if __name__ == "__main__":
    unittest.main()
