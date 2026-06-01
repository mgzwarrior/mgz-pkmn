"""Coverage for the `sets_warm.json` manifest helpers and freshness gate.

Mirrors `tests/test_warm_set_cards.py`'s SetCardsManifestTests /
SetCardsFreshnessTests structure so the three warm slices (concept,
set-cards, sets) all read the same shape end-to-end. Added in #369 when
runtime warming of set logos/symbols replaced the Dockerfile's build-time
`pkmn cache warm-sets` step.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn import cache as disk_cache


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


class SetsManifestTests(_IsolatedCacheMixin):
    def test_read_returns_none_when_absent(self) -> None:
        self.assertIsNone(disk_cache.read_sets_warm())

    def test_write_then_read_roundtrip(self) -> None:
        disk_cache.write_sets_warm(
            sets_warmed=173, logos_cached=173, symbols_cached=170, failures=3
        )
        data = disk_cache.read_sets_warm()
        self.assertIsNotNone(data)
        assert data is not None  # narrow for type checkers
        self.assertEqual(data["sets_warmed"], 173)
        self.assertEqual(data["logos_cached"], 173)
        self.assertEqual(data["symbols_cached"], 170)
        self.assertEqual(data["failures"], 3)
        self.assertIsInstance(data["timestamp"], float)

    def test_read_rejects_malformed_payload(self) -> None:
        path = disk_cache._sets_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json", encoding="utf-8")
        self.assertIsNone(disk_cache.read_sets_warm())

    def test_read_rejects_unknown_schema_version(self) -> None:
        path = disk_cache._sets_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "version": 99,
                    "timestamp": 0.0,
                    "sets_warmed": 0,
                    "logos_cached": 0,
                    "symbols_cached": 0,
                    "failures": 0,
                }
            ),
            encoding="utf-8",
        )
        self.assertIsNone(disk_cache.read_sets_warm())


class SetsFreshnessTests(_IsolatedCacheMixin):
    def test_no_manifest_is_not_fresh(self) -> None:
        self.assertFalse(disk_cache.sets_warm_is_fresh())

    def test_fresh_within_window(self) -> None:
        disk_cache.write_sets_warm(
            sets_warmed=173, logos_cached=173, symbols_cached=170, failures=3
        )
        self.assertTrue(disk_cache.sets_warm_is_fresh())

    def test_stale_outside_window(self) -> None:
        disk_cache.write_sets_warm(
            sets_warmed=173, logos_cached=173, symbols_cached=170, failures=3
        )
        # Pretend we're checking 8 days in the future — past the 7-day
        # SETS_WARM_STALE_SECONDS window.
        future = time.time() + (8 * 24 * 60 * 60)
        self.assertFalse(disk_cache.sets_warm_is_fresh(now=future))

    def test_zero_warmed_manifest_is_not_fresh(self) -> None:
        # Even a recent manifest must not suppress the next retry when
        # `sets_warmed` is zero — that's the "every upstream call failed"
        # signal, so the lifespan bootstrap should re-attempt on the next
        # container start.
        disk_cache.write_sets_warm(sets_warmed=0, logos_cached=0, symbols_cached=0, failures=5)
        self.assertFalse(disk_cache.sets_warm_is_fresh())


class CacheStatsProjectionTests(_IsolatedCacheMixin):
    def test_stats_reflects_sets_warm_manifest(self) -> None:
        disk_cache.write_sets_warm(
            sets_warmed=173, logos_cached=173, symbols_cached=170, failures=3
        )
        s = disk_cache.stats()
        self.assertEqual(s.sets_warm_count, 173)
        self.assertIsInstance(s.sets_warm_timestamp, float)

    def test_stats_zeroed_when_no_manifest(self) -> None:
        s = disk_cache.stats()
        self.assertEqual(s.sets_warm_count, 0)
        self.assertIsNone(s.sets_warm_timestamp)


if __name__ == "__main__":
    unittest.main()
