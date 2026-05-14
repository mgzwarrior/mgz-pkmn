from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn import cache


class _IsolatedCacheDirMixin(unittest.TestCase):
    """Point `cache_root()` at a fresh tempdir per test via XDG_CACHE_HOME so
    no test ever touches the user's real ~/.cache. The cache module re-reads
    the env on every call, so simply setting it is enough — no monkeypatch."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(cache._NO_CACHE_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(cache._NO_CACHE_ENV, None)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(cache._NO_CACHE_ENV, None)
        else:
            os.environ[cache._NO_CACHE_ENV] = self._old_no_cache
        os.environ.pop(cache._WARN_BYTES_ENV, None)
        self._tmp.cleanup()


class CacheSizeTests(_IsolatedCacheDirMixin):
    def test_empty_cache_size_is_zero(self) -> None:
        self.assertEqual(cache.cache_size_bytes(), 0)

    def test_size_sums_api_and_overrides(self) -> None:
        cache.write_api("k1", {"a": 1})
        cache.write_api("k2", {"b": 2})
        cache.record_url_override("Mew", None, "https://pc/mew")
        api_dir = cache.cache_root() / "api"
        expected = sum(p.stat().st_size for p in api_dir.glob("*.json"))
        expected += cache._overrides_path().stat().st_size
        self.assertEqual(cache.cache_size_bytes(), expected)

    def test_size_check_does_not_create_cache_root(self) -> None:
        # Point at a fresh, untouched XDG location and call size_bytes — it
        # should report 0 *without* the side effect of creating the dir
        # (matters for read-only filesystems and clean-environment checks).
        fresh = tempfile.TemporaryDirectory()
        self.addCleanup(fresh.cleanup)
        os.environ["XDG_CACHE_HOME"] = fresh.name
        root = cache._cache_root_path()
        self.assertFalse(root.exists())
        self.assertEqual(cache.cache_size_bytes(), 0)
        self.assertFalse(root.exists(), "size check must not create the cache dir")


class CacheWarnThresholdTests(_IsolatedCacheDirMixin):
    def test_default_is_50_mb(self) -> None:
        self.assertEqual(cache.cache_warn_threshold(), 50 * 1024 * 1024)
        self.assertEqual(cache.cache_warn_threshold(), cache.DEFAULT_CACHE_WARN_BYTES)

    def test_env_override_parses_integer(self) -> None:
        os.environ[cache._WARN_BYTES_ENV] = "12345"
        self.assertEqual(cache.cache_warn_threshold(), 12345)

    def test_zero_disables_warning(self) -> None:
        os.environ[cache._WARN_BYTES_ENV] = "0"
        self.assertEqual(cache.cache_warn_threshold(), 0)

    def test_bad_env_falls_back_to_default(self) -> None:
        os.environ[cache._WARN_BYTES_ENV] = "not-a-number"
        self.assertEqual(cache.cache_warn_threshold(), cache.DEFAULT_CACHE_WARN_BYTES)


class ApiCacheTests(_IsolatedCacheDirMixin):
    def test_round_trip(self) -> None:
        cache.write_api("https://example.com/cards?q=name:Mew", {"data": [1, 2, 3]})
        self.assertEqual(
            cache.read_api("https://example.com/cards?q=name:Mew"),
            {"data": [1, 2, 3]},
        )

    def test_miss_returns_none(self) -> None:
        self.assertIsNone(cache.read_api("https://example.com/never-written"))

    def test_ttl_expiry(self) -> None:
        key = "https://example.com/expiring"
        cache.write_api(key, {"data": "old"})
        # Backdate the file's mtime to force a TTL miss without sleeping.
        path = cache._api_path(key)
        old = time.time() - (cache.DEFAULT_API_TTL_SECONDS + 100)
        os.utime(path, (old, old))
        self.assertIsNone(cache.read_api(key))
        # Custom shorter TTL should also miss.
        cache.write_api(key, {"data": "new"})
        os.utime(path, (time.time() - 5, time.time() - 5))
        self.assertIsNone(cache.read_api(key, ttl_seconds=1))

    def test_clear_api_cache_wipes_files_and_returns_count(self) -> None:
        cache.write_api("k1", {"a": 1})
        cache.write_api("k2", {"b": 2})
        cache.write_api("k3", {"c": 3})
        api_dir = cache.cache_root() / "api"
        self.assertEqual(len(list(api_dir.glob("*.json"))), 3)
        cleared = cache.clear_api_cache()
        self.assertEqual(cleared, 3)
        self.assertEqual(list(api_dir.glob("*.json")), [])
        # Subsequent reads miss; cache is fully empty.
        self.assertIsNone(cache.read_api("k1"))

    def test_clear_api_cache_preserves_url_overrides(self) -> None:
        cache.record_url_override("Penny", None, "https://pc/penny")
        cache.write_api("k", {"x": 1})
        cache.clear_api_cache()
        # Override survives the api-only wipe.
        self.assertEqual(cache.find_url_override("Penny", None), "https://pc/penny")
        # API cache is gone.
        self.assertIsNone(cache.read_api("k"))

    def test_clear_api_cache_runs_even_when_no_cache_env_set(self) -> None:
        # Wiping is an explicit user action — shouldn't be silently skipped
        # just because reads/writes are disabled this run.
        cache.write_api("k", {"x": 1})
        os.environ[cache._NO_CACHE_ENV] = "1"
        cleared = cache.clear_api_cache()
        self.assertEqual(cleared, 1)

    def test_clear_api_cache_on_empty_cache_returns_zero(self) -> None:
        self.assertEqual(cache.clear_api_cache(), 0)

    def test_no_cache_env_disables_reads_and_writes(self) -> None:
        cache.write_api("k", {"x": 1})
        os.environ[cache._NO_CACHE_ENV] = "1"
        # Read returns None even though the file exists on disk.
        self.assertIsNone(cache.read_api("k"))
        # Writes are no-ops; nothing new should appear under api/.
        cache.write_api("brand-new-key", {"y": 2})
        api_dir = cache.cache_root() / "api"
        # Only the original file from before NO_CACHE was set.
        self.assertEqual(len(list(api_dir.glob("*.json"))), 1)


class CacheStatsTests(_IsolatedCacheDirMixin):
    def test_empty_cache_reports_zeros(self) -> None:
        s = cache.stats()
        self.assertEqual(s.api_entry_count, 0)
        self.assertEqual(s.api_bytes, 0)
        self.assertIsNone(s.api_oldest_mtime)
        self.assertEqual(s.override_count, 0)
        self.assertEqual(s.override_bytes, 0)
        self.assertEqual(s.root, cache.cache_root())

    def test_reports_api_entry_count_size_and_oldest(self) -> None:
        cache.write_api("k1", {"a": 1})
        cache.write_api("k2", {"b": 2})
        cache.write_api("k3", {"c": 3})
        # Backdate one entry so we have a determinate "oldest".
        oldest_path = cache._api_path("k2")
        target = time.time() - 3600
        os.utime(oldest_path, (target, target))

        s = cache.stats()
        self.assertEqual(s.api_entry_count, 3)
        self.assertGreater(s.api_bytes, 0)
        # Sum of individual file sizes — sanity-check the aggregate.
        api_dir = cache.cache_root() / "api"
        expected = sum(p.stat().st_size for p in api_dir.glob("*.json"))
        self.assertEqual(s.api_bytes, expected)
        assert s.api_oldest_mtime is not None
        self.assertAlmostEqual(s.api_oldest_mtime, target, delta=1.0)

    def test_reports_override_count_and_size(self) -> None:
        cache.record_url_override("Penny", "S&V Base", "https://pc/penny")
        cache.record_url_override("Mew", "Hidden Fates", "https://pc/mew")

        s = cache.stats()
        self.assertEqual(s.override_count, 2)
        self.assertGreater(s.override_bytes, 0)
        self.assertEqual(s.override_bytes, cache._overrides_path().stat().st_size)

    def test_runs_even_when_no_cache_env_set(self) -> None:
        # Inspecting on-disk state should not be silenced by the runtime
        # disable flag — the user is asking about real files.
        cache.write_api("k", {"x": 1})
        cache.record_url_override("Mew", None, "https://pc/mew")
        os.environ[cache._NO_CACHE_ENV] = "1"

        s = cache.stats()
        self.assertEqual(s.api_entry_count, 1)
        self.assertEqual(s.override_count, 1)


class UrlOverrideTests(_IsolatedCacheDirMixin):
    def test_record_and_find_round_trip(self) -> None:
        cache.record_url_override(
            "Penny", "S&V Base", "https://www.pricecharting.com/game/x/penny-239"
        )
        self.assertEqual(
            cache.find_url_override("Penny", "S&V Base"),
            "https://www.pricecharting.com/game/x/penny-239",
        )

    def test_lookup_is_case_insensitive(self) -> None:
        cache.record_url_override("Mew", "Hidden Fates", "https://pc/mew-1")
        self.assertEqual(cache.find_url_override("mew", "hidden fates"), "https://pc/mew-1")
        self.assertEqual(cache.find_url_override("MEW", "HIDDEN FATES"), "https://pc/mew-1")

    def test_set_hint_distinguishes_overrides(self) -> None:
        cache.record_url_override("Penny", "Scarlet & Violet", "https://pc/sv-penny")
        cache.record_url_override("Penny", "Paldean Fates", "https://pc/paf-penny")
        self.assertEqual(cache.find_url_override("Penny", "Paldean Fates"), "https://pc/paf-penny")
        self.assertEqual(
            cache.find_url_override("Penny", "Scarlet & Violet"), "https://pc/sv-penny"
        )

    def test_re_record_same_value_does_not_rewrite(self) -> None:
        cache.record_url_override("Mew", None, "https://pc/mew")
        path = cache._overrides_path()
        first_mtime = path.stat().st_mtime
        # Sleep briefly to ensure mtime would change if we wrote again.
        time.sleep(0.01)
        cache.record_url_override("Mew", None, "https://pc/mew")
        self.assertEqual(path.stat().st_mtime, first_mtime)

    def test_overwrite_with_new_url(self) -> None:
        cache.record_url_override("Mew", None, "https://pc/old")
        cache.record_url_override("Mew", None, "https://pc/new")
        self.assertEqual(cache.find_url_override("Mew", None), "https://pc/new")


if __name__ == "__main__":
    unittest.main()
