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
        self._tmp.cleanup()


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
