from __future__ import annotations

import json
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


class ApiCounterTests(_IsolatedCacheDirMixin):
    def setUp(self) -> None:
        super().setUp()
        cache.reset_api_counters()

    def test_reset_zeroes_counters(self) -> None:
        cache.write_api("k", {"x": 1})
        cache.read_api("k")
        self.assertNotEqual(cache.api_counters(), (0, 0))
        cache.reset_api_counters()
        self.assertEqual(cache.api_counters(), (0, 0))

    def test_write_increments_fetches(self) -> None:
        cache.write_api("k1", {"a": 1})
        cache.write_api("k2", {"b": 2})
        hits, fetches = cache.api_counters()
        self.assertEqual(hits, 0)
        self.assertEqual(fetches, 2)

    def test_read_hit_increments_hits(self) -> None:
        cache.write_api("k", {"x": 1})
        cache.reset_api_counters()
        self.assertEqual(cache.read_api("k"), {"x": 1})
        self.assertEqual(cache.read_api("k"), {"x": 1})
        hits, fetches = cache.api_counters()
        self.assertEqual(hits, 2)
        self.assertEqual(fetches, 0)

    def test_read_miss_does_not_increment_hits(self) -> None:
        self.assertIsNone(cache.read_api("never-written"))
        self.assertEqual(cache.api_counters(), (0, 0))

    def test_ttl_expiry_is_not_a_hit(self) -> None:
        key = "expired"
        cache.write_api(key, {"x": 1})
        cache.reset_api_counters()
        path = cache._api_path(key)
        old = time.time() - (cache.DEFAULT_API_TTL_SECONDS + 100)
        os.utime(path, (old, old))
        self.assertIsNone(cache.read_api(key))
        self.assertEqual(cache.api_counters(), (0, 0))

    def test_no_cache_env_suppresses_both_counters(self) -> None:
        cache.write_api("k", {"x": 1})
        cache.reset_api_counters()
        os.environ[cache._NO_CACHE_ENV] = "1"
        self.assertIsNone(cache.read_api("k"))
        cache.write_api("k2", {"y": 2})
        self.assertEqual(cache.api_counters(), (0, 0))


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


class UrlOverrideSchemaTests(_IsolatedCacheDirMixin):
    """Versioned `url_overrides.json` schema — see issue #18.

    On-disk shape is `{"schema_version": N, "overrides": {...}}`. We still
    accept the pre-#18 flat-dict layout transparently so existing caches
    keep working; the first write upgrades them in place."""

    def test_save_uses_versioned_shape(self) -> None:
        cache.record_url_override("Mew", None, "https://pc/mew")
        raw = json.loads(cache._overrides_path().read_text(encoding="utf-8"))
        self.assertEqual(raw.get("schema_version"), cache.OVERRIDES_SCHEMA_VERSION)
        self.assertEqual(raw.get("overrides"), {"mew|": "https://pc/mew"})

    def test_reads_legacy_flat_dict(self) -> None:
        # Simulate a cache written by an older client (no schema_version wrapper).
        legacy = {"mew|hidden fates": "https://pc/legacy-mew"}
        cache._overrides_path().write_text(json.dumps(legacy), encoding="utf-8")
        self.assertEqual(
            cache.find_url_override("Mew", "Hidden Fates"),
            "https://pc/legacy-mew",
        )
        self.assertEqual(
            cache.list_url_overrides(),
            {"mew|hidden fates": "https://pc/legacy-mew"},
        )

    def test_next_write_upgrades_legacy_file(self) -> None:
        legacy = {"mew|hidden fates": "https://pc/legacy-mew"}
        cache._overrides_path().write_text(json.dumps(legacy), encoding="utf-8")
        # Adding a new override should rewrite the file in the versioned shape
        # while preserving the legacy entry.
        cache.record_url_override("Penny", "S&V Base", "https://pc/penny")
        raw = json.loads(cache._overrides_path().read_text(encoding="utf-8"))
        self.assertEqual(raw.get("schema_version"), cache.OVERRIDES_SCHEMA_VERSION)
        self.assertEqual(
            raw.get("overrides"),
            {
                "mew|hidden fates": "https://pc/legacy-mew",
                "penny|s&v base": "https://pc/penny",
            },
        )

    def test_reads_versioned_shape(self) -> None:
        document = {
            "schema_version": cache.OVERRIDES_SCHEMA_VERSION,
            "overrides": {"penny|s&v base": "https://pc/penny"},
        }
        cache._overrides_path().write_text(json.dumps(document), encoding="utf-8")
        self.assertEqual(
            cache.find_url_override("Penny", "S&V Base"),
            "https://pc/penny",
        )

    def test_versioned_without_overrides_payload_reads_empty(self) -> None:
        # Malformed: schema_version present but `overrides` missing / wrong type.
        cache._overrides_path().write_text(
            json.dumps({"schema_version": 1, "overrides": "not a dict"}),
            encoding="utf-8",
        )
        self.assertEqual(cache.list_url_overrides(), {})

    def test_stats_counts_versioned_overrides(self) -> None:
        document = {
            "schema_version": cache.OVERRIDES_SCHEMA_VERSION,
            "overrides": {
                "mew|": "https://pc/mew",
                "penny|s&v base": "https://pc/penny",
            },
        }
        cache._overrides_path().write_text(json.dumps(document), encoding="utf-8")
        self.assertEqual(cache.stats().override_count, 2)

    def test_stats_counts_legacy_overrides(self) -> None:
        legacy = {"mew|": "https://pc/mew", "penny|s&v base": "https://pc/penny"}
        cache._overrides_path().write_text(json.dumps(legacy), encoding="utf-8")
        self.assertEqual(cache.stats().override_count, 2)


# ---------------------------------------------------------------------------
# Image cache (indefinite TTL) — set logos, set symbols, future card art.
# ---------------------------------------------------------------------------


class _FakeResponse:
    """Stand-in for `requests.Response` with just the bits the cache needs."""

    def __init__(self, content: bytes, status: int = 200) -> None:
        self.content = content
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import requests as _r

            raise _r.HTTPError(f"HTTP {self.status_code}")


class _FakeSession:
    """Minimal session stub. `responses` is a URL → bytes (or exception) map."""

    def __init__(self, responses: dict[str, bytes | Exception]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def get(self, url: str, timeout: float | None = None) -> _FakeResponse:
        self.calls.append(url)
        result = self.responses.get(url)
        if isinstance(result, Exception):
            raise result
        if result is None:
            return _FakeResponse(b"", status=404)
        return _FakeResponse(result, status=200)


class ImageCacheRoundTripTests(_IsolatedCacheDirMixin):
    def test_write_then_read_returns_path(self) -> None:
        path = cache.write_image("sets/logo", "sv8", b"PNGDATA", ext=".png")
        self.assertIsNotNone(path)
        self.assertTrue(path.exists())  # type: ignore[union-attr]
        self.assertEqual(path.read_bytes(), b"PNGDATA")  # type: ignore[union-attr]

        found = cache.read_image("sets/logo", "sv8")
        self.assertEqual(found, path)

    def test_read_returns_none_when_missing(self) -> None:
        self.assertIsNone(cache.read_image("sets/logo", "nope"))

    def test_read_finds_any_allowed_extension(self) -> None:
        cache.write_image("sets/symbol", "base1", b"data", ext=".jpg")
        found = cache.read_image("sets/symbol", "base1")
        self.assertIsNotNone(found)
        self.assertEqual(found.suffix, ".jpg")  # type: ignore[union-attr]

    def test_unknown_extension_falls_back_to_png(self) -> None:
        path = cache.write_image("sets/logo", "x", b"bytes", ext=".bogus")
        self.assertIsNotNone(path)
        self.assertEqual(path.suffix, ".png")  # type: ignore[union-attr]

    def test_safe_image_key_strips_unsafe_chars(self) -> None:
        # Keys with slashes / spaces / punctuation must collapse to safe names
        # so no surprise subdirs sneak in via category-tunneling.
        path = cache.write_image("sets/logo", "weird id / with spaces!", b"x")
        self.assertIsNotNone(path)
        self.assertNotIn("/", path.name)  # type: ignore[union-attr]
        self.assertNotIn(" ", path.name)  # type: ignore[union-attr]

    def test_write_is_noop_when_cache_disabled(self) -> None:
        os.environ[cache._NO_CACHE_ENV] = "1"
        self.assertIsNone(cache.write_image("sets/logo", "x", b"bytes"))

    def test_read_returns_none_when_cache_disabled(self) -> None:
        cache.write_image("sets/logo", "x", b"bytes")
        os.environ[cache._NO_CACHE_ENV] = "1"
        self.assertIsNone(cache.read_image("sets/logo", "x"))


class DownloadAndCacheImageTests(_IsolatedCacheDirMixin):
    def test_miss_downloads_and_persists(self) -> None:
        session = _FakeSession({"https://example/logo.png": b"PNGBYTES"})
        path = cache.download_and_cache_image(
            "sets/logo", "sv8", "https://example/logo.png", session
        )
        self.assertIsNotNone(path)
        self.assertEqual(path.read_bytes(), b"PNGBYTES")  # type: ignore[union-attr]
        self.assertEqual(session.calls, ["https://example/logo.png"])

    def test_hit_skips_network(self) -> None:
        cache.write_image("sets/logo", "sv8", b"CACHED", ext=".png")
        session = _FakeSession({"https://example/logo.png": b"FRESH"})
        path = cache.download_and_cache_image(
            "sets/logo", "sv8", "https://example/logo.png", session
        )
        self.assertIsNotNone(path)
        self.assertEqual(path.read_bytes(), b"CACHED")  # type: ignore[union-attr]
        self.assertEqual(session.calls, [], "cache hit must not touch the network")

    def test_network_failure_returns_none_and_does_not_write(self) -> None:
        import requests

        session = _FakeSession({"https://example/logo.png": requests.ConnectionError("down")})
        path = cache.download_and_cache_image(
            "sets/logo", "sv8", "https://example/logo.png", session
        )
        self.assertIsNone(path)
        # Nothing on disk for that key.
        self.assertIsNone(cache.read_image("sets/logo", "sv8"))


class ImageCacheStatsAndClearTests(_IsolatedCacheDirMixin):
    def test_size_and_count_reflect_writes(self) -> None:
        cache.write_image("sets/logo", "a", b"abcdef")
        cache.write_image("sets/symbol", "a", b"01234")
        count, total = cache.image_cache_size()
        self.assertEqual(count, 2)
        self.assertEqual(total, len(b"abcdef") + len(b"01234"))

    def test_stats_surfaces_image_slice(self) -> None:
        cache.write_image("sets/logo", "a", b"1234")
        s = cache.stats()
        self.assertEqual(s.image_entry_count, 1)
        self.assertEqual(s.image_bytes, 4)

    def test_cache_size_bytes_includes_images(self) -> None:
        cache.write_api("k", {"x": 1})
        cache.write_image("sets/logo", "a", b"123456")
        # API write + image write must both appear in the total.
        total = cache.cache_size_bytes()
        api_size = sum(p.stat().st_size for p in (cache.cache_root() / "api").glob("*.json"))
        self.assertEqual(total, api_size + 6)

    def test_clear_image_cache_removes_only_images(self) -> None:
        cache.write_api("k", {"x": 1})
        cache.write_image("sets/logo", "a", b"img")
        removed = cache.clear_image_cache()
        self.assertEqual(removed, 1)
        # API cache survived.
        api_dir = cache.cache_root() / "api"
        self.assertGreater(len(list(api_dir.glob("*.json"))), 0)
        # Image cache is empty.
        self.assertEqual(cache.image_cache_size(), (0, 0))

    def test_clear_api_cache_does_not_touch_images(self) -> None:
        # The defining property of the indefinite slice: it survives an API
        # wipe. A user clearing stale API payloads should not lose a 30 MB
        # warmed set catalog.
        cache.write_image("sets/logo", "a", b"img-bytes")
        cache.write_api("k", {"x": 1})
        cache.clear_api_cache()
        self.assertEqual(cache.image_cache_size(), (1, len(b"img-bytes")))


if __name__ == "__main__":
    unittest.main()
