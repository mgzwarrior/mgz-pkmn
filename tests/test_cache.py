from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any

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


class ImageCacheEdgeCaseTests(_IsolatedCacheDirMixin):
    def test_safe_image_key_empty_falls_back_to_default(self) -> None:
        # An empty (or whitespace-only) key collapses to "image" rather than
        # producing a hidden dot-prefixed file like `.png`. Non-empty but
        # all-punctuation keys collapse to `_` via the regex sub.
        path_blank = cache.write_image("sets/logo", "   ", b"data")
        self.assertIsNotNone(path_blank)
        self.assertTrue(path_blank.name.startswith("image"))  # type: ignore[union-attr]
        path_punct = cache.write_image("sets/logo", "!!!", b"other")
        self.assertIsNotNone(path_punct)
        self.assertEqual(path_punct.name, "_.png")  # type: ignore[union-attr]

    def test_read_image_returns_none_when_dir_missing(self) -> None:
        # Cache root exists (touched by setUp via overrides path) but the
        # `images/` subdir was never created — read should short-circuit.
        self.assertIsNone(cache.read_image("sets/logo", "anything"))

    def test_zero_byte_file_is_treated_as_missing(self) -> None:
        # An interrupted write that left a zero-byte file shouldn't poison
        # the cache — the next read must fall through to a fresh fetch.
        target = cache._image_dir("sets/logo") / "ghost.png"
        target.write_bytes(b"")
        self.assertIsNone(cache.read_image("sets/logo", "ghost"))

    def test_write_returns_none_when_filesystem_errors(self) -> None:
        # Simulate a transient OS write error during the rename step. The
        # function should swallow it and return None rather than crash the
        # caller, and no half-written temp should be left behind.
        from unittest.mock import patch as _patch

        with _patch("pathlib.Path.replace", side_effect=OSError("disk full")):
            self.assertIsNone(cache.write_image("sets/logo", "x", b"bytes"))
        # And the temp file is cleaned up so the next attempt sees an empty
        # category dir.
        leftovers = list((cache.cache_root() / "images").rglob("*"))
        self.assertEqual([p.name for p in leftovers if p.is_file()], [])


class ClearImageCacheEdgeCaseTests(_IsolatedCacheDirMixin):
    def test_clear_returns_zero_when_no_image_dir(self) -> None:
        # Fresh cache with no `images/` subdir — clear is a no-op, not an
        # error.
        self.assertEqual(cache.clear_image_cache(), 0)

    def test_clear_removes_nested_category_dirs(self) -> None:
        # After clear, the category subdirectories should be pruned so
        # subsequent `stats()` doesn't show ghost entries.
        cache.write_image("sets/logo", "a", b"x")
        cache.write_image("sets/symbol", "b", b"y")
        cache.clear_image_cache()
        images_dir = cache.cache_root() / "images"
        # The leaf categories should be gone.
        self.assertFalse((images_dir / "sets" / "logo").exists())
        self.assertFalse((images_dir / "sets" / "symbol").exists())


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


# ---------------------------------------------------------------------------
# Split-cache tests (#372). Structural cached indefinitely; pricing cached
# for 24h with stale-while-revalidate.
# ---------------------------------------------------------------------------


def _make_card(card_id: str, *, name: str = "Pikachu", with_pricing: bool = True) -> dict:
    card = {
        "id": card_id,
        "name": name,
        "number": "25/102",
        "set": {"id": "base1", "name": "Base"},
        "images": {"small": "u/small.png", "large": "u/large.png"},
    }
    if with_pricing:
        card["tcgplayer"] = {"prices": {"normal": {"market": 10.0}}, "url": "tcg/u"}
        card["cardmarket"] = {"prices": {"averageSellPrice": 9.5}, "url": "cm/u"}
    return card


def _backdate(path: Path, seconds_ago: float) -> None:
    """`os.utime` the file to `seconds_ago` in the past."""
    t = time.time() - seconds_ago
    os.utime(path, (t, t))


class ApiSplitCacheTests(_IsolatedCacheDirMixin):
    """Round-trip + state-A/B/D coverage for the split read/write path.

    Migration (state C) lives in its own class below for readability."""

    def test_write_split_produces_both_files(self) -> None:
        cards = [_make_card("a"), _make_card("b")]
        cache.write_api_split("u", cards)
        self.assertTrue(cache._api_structural_path("u").exists())
        self.assertTrue(cache._api_pricing_path("u").exists())
        # The legacy file is not touched by the split writer.
        self.assertFalse(cache._api_path("u").exists())

    def test_split_writer_strips_pricing_from_structural_file(self) -> None:
        cache.write_api_split("u", [_make_card("a")])
        structurals = json.loads(cache._api_structural_path("u").read_text())
        self.assertEqual(structurals[0]["name"], "Pikachu")
        for forbidden in ("tcgplayer", "cardmarket", "_pc_prices", "_pc_url"):
            self.assertNotIn(forbidden, structurals[0])
        pricings = json.loads(cache._api_pricing_path("u").read_text())
        self.assertEqual(pricings[0]["id"], "a")
        self.assertEqual(pricings[0]["tcgplayer"]["url"], "tcg/u")

    def test_read_split_hit_returns_merged_view_within_ttl(self) -> None:
        cards = [_make_card("a")]
        cache.write_api_split("u", cards)
        result, status = cache.read_api_split("u")
        self.assertEqual(status, "HIT")
        assert result is not None  # narrow for mypy
        self.assertEqual(result[0]["name"], "Pikachu")
        self.assertEqual(result[0]["tcgplayer"]["prices"]["normal"]["market"], 10.0)

    def test_read_split_stale_returns_merged_view_past_ttl(self) -> None:
        cache.write_api_split("u", [_make_card("a")])
        # Back-date pricing past the 24h TTL.
        _backdate(cache._api_pricing_path("u"), 25 * 3600)
        result, status = cache.read_api_split("u")
        self.assertEqual(status, "STALE")
        assert result is not None
        # Stale pricing is still merged in — the whole point of SWR.
        self.assertIn("tcgplayer", result[0])

    def test_read_split_miss_when_neither_file_exists(self) -> None:
        result, status = cache.read_api_split("u")
        self.assertEqual(status, "MISS")
        self.assertIsNone(result)

    def test_structural_without_pricing_reads_as_stale(self) -> None:
        # Simulate a partial state: structural landed, pricing didn't.
        cache.write_api_split("u", [_make_card("a")])
        cache._api_pricing_path("u").unlink()
        result, status = cache.read_api_split("u")
        self.assertEqual(status, "STALE")
        assert result is not None
        # No pricing fields in the merged view since pricing is absent.
        self.assertNotIn("tcgplayer", result[0])
        self.assertEqual(result[0]["name"], "Pikachu")

    def test_no_cache_env_suppresses_split_reads_and_writes(self) -> None:
        cache.write_api_split("u", [_make_card("a")])  # land a fresh entry first
        os.environ[cache._NO_CACHE_ENV] = "1"
        try:
            # Reads return MISS even with files on disk.
            result, status = cache.read_api_split("u")
            self.assertEqual(status, "MISS")
            self.assertIsNone(result)
            # Writes are no-ops — clear and verify.
            cache._api_structural_path("u").unlink()
            cache._api_pricing_path("u").unlink()
            cache.write_api_split("u", [_make_card("b")])
            self.assertFalse(cache._api_structural_path("u").exists())
            self.assertFalse(cache._api_pricing_path("u").exists())
        finally:
            os.environ.pop(cache._NO_CACHE_ENV, None)


class LazyLegacyMigrationTests(_IsolatedCacheDirMixin):
    """State C: a pre-split legacy `api/{sha1}.json` file is migrated on
    first read, with mtime inherited so TTL gates behave consistently."""

    def test_legacy_file_migrates_eagerly_on_read(self) -> None:
        cache.write_api("u", [_make_card("a")])
        legacy_mtime = cache._api_path("u").stat().st_mtime
        result, status = cache.read_api_split("u")
        # Fresh legacy file (< 24h old) → HIT after migration.
        self.assertEqual(status, "HIT")
        assert result is not None
        self.assertEqual(result[0]["name"], "Pikachu")
        # Both split files now exist and the legacy file is gone.
        self.assertTrue(cache._api_structural_path("u").exists())
        self.assertTrue(cache._api_pricing_path("u").exists())
        self.assertFalse(cache._api_path("u").exists())
        # Pricing inherits the legacy mtime so a near-stale legacy file
        # doesn't reset to fresh on migration.
        self.assertAlmostEqual(
            cache._api_pricing_path("u").stat().st_mtime, legacy_mtime, delta=1.0
        )

    def test_legacy_file_older_than_pricing_ttl_migrates_to_stale(self) -> None:
        cache.write_api("u", [_make_card("a")])
        _backdate(cache._api_path("u"), 25 * 3600)
        _, status = cache.read_api_split("u")
        self.assertEqual(status, "STALE")
        # Pricing mtime is inherited; it should still be ~25h old.
        age = time.time() - cache._api_pricing_path("u").stat().st_mtime
        self.assertGreater(age, 24 * 3600)

    def test_legacy_file_malformed_deletes_and_returns_miss(self) -> None:
        cache._api_path("u").write_text("not json {", encoding="utf-8")
        result, status = cache.read_api_split("u")
        self.assertEqual(status, "MISS")
        self.assertIsNone(result)
        self.assertFalse(cache._api_path("u").exists())


class SwrCoordinatorTests(_IsolatedCacheDirMixin):
    """spawn_pricing_refresh coalesces concurrent triggers + clears inflight on exit."""

    def _patch_thread_sync(self) -> None:
        """Replace threading.Thread.start with an inline-run shim for this test.

        Restored in tearDown via the cache-mixin's class-level state."""
        import threading as _t

        self._orig_start = _t.Thread.start

        def _sync_start(thread_self: _t.Thread) -> None:  # type: ignore[override]
            target = thread_self._target  # type: ignore[attr-defined]
            args = thread_self._args  # type: ignore[attr-defined]
            kwargs = thread_self._kwargs  # type: ignore[attr-defined]
            if target is not None:
                target(*args, **kwargs)

        _t.Thread.start = _sync_start  # type: ignore[method-assign]

    def tearDown(self) -> None:
        if hasattr(self, "_orig_start"):
            import threading as _t

            _t.Thread.start = self._orig_start  # type: ignore[method-assign]
        # Drain any leftover in-flight keys from sibling tests.
        with cache._inflight_lock:
            cache._inflight_pricing.clear()
        cache.reset_pricing_counters()
        super().tearDown()

    def test_spawn_pricing_refresh_runs_callable_and_writes_pricing(self) -> None:
        self._patch_thread_sync()
        # Pre-land a structural slice so the pricing write has somewhere to land.
        cache.write_api_split("u", [_make_card("a")])
        _backdate(cache._api_pricing_path("u"), 30 * 3600)
        stale_mtime = cache._api_pricing_path("u").stat().st_mtime

        fresh_cards = [_make_card("a", with_pricing=True)]
        started = cache.spawn_pricing_refresh("u", lambda: fresh_cards)
        self.assertTrue(started)

        new_mtime = cache._api_pricing_path("u").stat().st_mtime
        self.assertGreater(new_mtime, stale_mtime)
        attempts, writes = cache.pricing_counters()
        self.assertEqual((attempts, writes), (1, 1))
        # In-flight set drained after completion.
        self.assertNotIn("u", cache._inflight_pricing)

    def test_spawn_pricing_refresh_coalesces_concurrent_calls(self) -> None:
        # Pre-occupy the in-flight set so the *next* spawn no-ops.
        with cache._inflight_lock:
            cache._inflight_pricing.add("u")
        try:

            def _should_not_run() -> list[dict[str, Any]]:
                raise AssertionError("coalesced spawn should not have called refetch")

            started = cache.spawn_pricing_refresh("u", _should_not_run)  # type: ignore[arg-type]
            self.assertFalse(started)
        finally:
            with cache._inflight_lock:
                cache._inflight_pricing.discard("u")

    def test_spawn_pricing_refresh_clears_inflight_on_exception(self) -> None:
        self._patch_thread_sync()

        def _boom() -> list[dict[str, Any]]:
            raise RuntimeError("upstream down")

        cache.spawn_pricing_refresh("u", _boom)  # type: ignore[arg-type]
        self.assertNotIn("u", cache._inflight_pricing)
        attempts, writes = cache.pricing_counters()
        self.assertEqual((attempts, writes), (1, 0))

    def test_spawn_pricing_refresh_no_write_when_refetch_returns_none(self) -> None:
        self._patch_thread_sync()
        cache.write_api_split("u", [_make_card("a")])
        before = cache._api_pricing_path("u").stat().st_mtime
        time.sleep(0.01)  # ensure mtime resolution gap is visible

        cache.spawn_pricing_refresh("u", lambda: None)
        after = cache._api_pricing_path("u").stat().st_mtime
        # Pricing file untouched.
        self.assertEqual(after, before)
        attempts, writes = cache.pricing_counters()
        self.assertEqual((attempts, writes), (1, 0))


if __name__ == "__main__":
    unittest.main()
