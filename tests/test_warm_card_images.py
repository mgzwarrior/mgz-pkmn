"""Coverage for `warm_card_images` + the `card_images_warm.json` manifest.

Phase 2 of the pre-Scrydex catalog-warm epic (#368). Validates that:

- `warm_card_images` walks the supplied set ids, downloads each card's
  `large` and `small` image bytes, persists them under the unified
  image cache, and returns counts that match what landed on disk.
- `--skip-existing` honors already-present entries.
- `--max-bytes` short-circuits the walk with `budget_reached=True` and
  never partially writes past the cap.
- The freshness gate + read/write helpers behave the same way as the
  other warm manifests.

Network is mocked at `TCGClient.search_all` (for set payloads) and at
`mgz_pkmn.card_images._download_bytes` (for image fetches) so no real
upstream is hit.
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
from mgz_pkmn import card_images as card_images_mod
from mgz_pkmn.card_images import (
    LARGE_CATEGORY,
    SMALL_CATEGORY,
    parse_bytes_budget,
    warm_card_images,
)
from mgz_pkmn.sources.pokemontcg import TCGClient


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


def _card(set_id: str, n: int) -> dict:
    """Build a synthetic card with both image sizes pointing at fake URLs."""
    cid = f"{set_id}-{n}"
    return {
        "id": cid,
        "name": f"Card{n}",
        "set": {"id": set_id, "name": set_id.title()},
        "images": {
            "large": f"https://images.example/{cid}_lg.png",
            "small": f"https://images.example/{cid}_sm.png",
        },
    }


# ---------------------------------------------------------------------------
# Manifest helpers (mirror tests/test_warm_cards.py)
# ---------------------------------------------------------------------------


class CardImagesWarmManifestTests(_IsolatedCacheMixin):
    def test_read_returns_none_when_absent(self) -> None:
        self.assertIsNone(disk_cache.read_card_images_warm())

    def test_write_then_read_roundtrip(self) -> None:
        disk_cache.write_card_images_warm(
            images_warmed=100,
            images_failed=2,
            bytes_written=1_234_567,
            budget_reached=False,
            sets_attempted=10,
            sets_failed=["bogus"],
        )
        data = disk_cache.read_card_images_warm()
        self.assertIsNotNone(data)
        assert data is not None
        self.assertEqual(data["images_warmed"], 100)
        self.assertEqual(data["images_failed"], 2)
        self.assertEqual(data["bytes_written"], 1_234_567)
        self.assertFalse(data["budget_reached"])
        self.assertEqual(data["sets_attempted"], 10)
        self.assertEqual(data["sets_failed"], ["bogus"])
        self.assertIsInstance(data["timestamp"], float)

    def test_read_rejects_malformed_payload(self) -> None:
        path = disk_cache._card_images_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json", encoding="utf-8")
        self.assertIsNone(disk_cache.read_card_images_warm())

    def test_read_rejects_unknown_schema_version(self) -> None:
        path = disk_cache._card_images_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "version": 99,
                    "timestamp": 0.0,
                    "images_warmed": 0,
                    "images_failed": 0,
                    "bytes_written": 0,
                    "budget_reached": False,
                    "sets_attempted": 0,
                    "sets_failed": [],
                }
            ),
            encoding="utf-8",
        )
        self.assertIsNone(disk_cache.read_card_images_warm())


class CardImagesWarmFreshnessTests(_IsolatedCacheMixin):
    def test_no_manifest_is_not_fresh(self) -> None:
        self.assertFalse(disk_cache.card_images_warm_is_fresh())

    def test_fresh_within_window(self) -> None:
        disk_cache.write_card_images_warm(
            images_warmed=10,
            images_failed=0,
            bytes_written=1024,
            budget_reached=False,
            sets_attempted=1,
            sets_failed=[],
        )
        self.assertTrue(disk_cache.card_images_warm_is_fresh())

    def test_stale_outside_window(self) -> None:
        disk_cache.write_card_images_warm(
            images_warmed=10,
            images_failed=0,
            bytes_written=1024,
            budget_reached=False,
            sets_attempted=1,
            sets_failed=[],
        )
        future = time.time() + (8 * 24 * 60 * 60)
        self.assertFalse(disk_cache.card_images_warm_is_fresh(now=future))

    def test_zero_warmed_manifest_is_not_fresh(self) -> None:
        # Same guard as the other warm gates — a manifest written after a
        # fully-failed pass must not suppress the next retry for a week.
        disk_cache.write_card_images_warm(
            images_warmed=0,
            images_failed=12,
            bytes_written=0,
            budget_reached=False,
            sets_attempted=1,
            sets_failed=["a"],
        )
        self.assertFalse(disk_cache.card_images_warm_is_fresh())

    def test_budget_reached_manifest_is_still_fresh(self) -> None:
        # `budget_reached` should not flip the gate — the partial pass
        # *did* land bytes on disk and we don't want the next boot to
        # immediately re-walk just to chase the budget tail.
        disk_cache.write_card_images_warm(
            images_warmed=5,
            images_failed=0,
            bytes_written=999_999,
            budget_reached=True,
            sets_attempted=1,
            sets_failed=[],
        )
        self.assertTrue(disk_cache.card_images_warm_is_fresh())


# ---------------------------------------------------------------------------
# warm_card_images behavior
# ---------------------------------------------------------------------------


class WarmCardImagesTests(_IsolatedCacheMixin):
    def _patch_download(self, **byte_sizes: int):
        """Return a patch-context that swaps `_download_bytes` to return
        fixed-length bytes objects so we can predict bytes_written exactly."""
        default = 1024

        def fake_download(_session, url: str, *, timeout: float = 30.0) -> bytes | None:
            return b"x" * byte_sizes.get(url, default)

        return patch.object(card_images_mod, "_download_bytes", side_effect=fake_download)

    def test_writes_one_image_per_size_per_card(self) -> None:
        cards = [_card("sv8", 1), _card("sv8", 2)]
        with (
            patch.object(TCGClient, "search_all", return_value=cards),
            self._patch_download(),
        ):
            result = warm_card_images(TCGClient(), set_ids=["sv8"])

        self.assertEqual(result.sets_attempted, 1)
        self.assertEqual(result.images_warmed, 4)  # 2 cards x (large+small)
        self.assertEqual(result.images_failed, 0)
        self.assertFalse(result.budget_reached)
        self.assertEqual(result.bytes_written, 4 * 1024)
        # Files landed on disk under the expected categories.
        for c in cards:
            self.assertIsNotNone(disk_cache.read_image(LARGE_CATEGORY, c["id"]))
            self.assertIsNotNone(disk_cache.read_image(SMALL_CATEGORY, c["id"]))

    def test_skip_existing_does_not_re_download(self) -> None:
        cards = [_card("sv8", 1)]
        # Pre-seed both sizes so the warm pass should fully skip the
        # downloader.
        disk_cache.write_image(LARGE_CATEGORY, cards[0]["id"], b"existing-lg", ext=".png")
        disk_cache.write_image(SMALL_CATEGORY, cards[0]["id"], b"existing-sm", ext=".png")
        with (
            patch.object(TCGClient, "search_all", return_value=cards),
            patch.object(card_images_mod, "_download_bytes") as mock_download,
        ):
            result = warm_card_images(TCGClient(), set_ids=["sv8"])

        mock_download.assert_not_called()
        # Pre-existing entries still count as warmed (post-condition is
        # "image is on disk"), but no bytes were downloaded this pass.
        self.assertEqual(result.images_warmed, 2)
        self.assertEqual(result.bytes_written, 0)

    def test_max_bytes_never_exceeded_when_next_download_too_large(self) -> None:
        # Regression for Copilot review on #371: the pre-download
        # check stops only when `bytes_written >= max_bytes`. Without
        # a post-download check, a download larger than the remaining
        # budget would still be written and push us past the cap.
        # Here: budget is 1500, first image is 1024 (fits, leaves 476
        # remaining), second image is 1024 (would push to 2048).
        # Expected: 1 image written, 1024 bytes_written, budget_reached.
        cards = [_card("sv8", 1)]
        with (
            patch.object(TCGClient, "search_all", return_value=cards),
            self._patch_download(),  # default 1024 bytes per image
        ):
            result = warm_card_images(TCGClient(), set_ids=["sv8"], max_bytes=1500)
        # First image (large) fits within 1500; second (small) would
        # push to 2048 > 1500 → not written.
        self.assertEqual(result.images_warmed, 1)
        self.assertEqual(result.bytes_written, 1024)
        self.assertTrue(result.budget_reached)
        self.assertLessEqual(result.bytes_written, 1500)

    def test_max_bytes_stops_cleanly_without_partial_write(self) -> None:
        # 4 image fetches at 1 KB each would download 4 KB; cap at 2 KB
        # → exactly 2 images land, the rest are skipped, budget_reached=True.
        cards = [_card("sv8", 1), _card("sv8", 2)]
        with (
            patch.object(TCGClient, "search_all", return_value=cards),
            self._patch_download(),
        ):
            result = warm_card_images(TCGClient(), set_ids=["sv8"], max_bytes=2048)

        self.assertEqual(result.images_warmed, 2)
        self.assertEqual(result.bytes_written, 2048)
        self.assertTrue(result.budget_reached)
        # Verify exactly 2 image files exist on disk for sv8.
        sv8_dir = disk_cache._cache_root_path() / "images" / "cards"
        on_disk = list(sv8_dir.rglob("sv8-*"))
        self.assertEqual(len(on_disk), 2)

    def test_skip_existing_bytes_dont_count_toward_budget(self) -> None:
        # Pre-seed one card's images on disk. With skip-existing=True
        # (default) the warmer treats them as already-warmed without
        # downloading or counting bytes — so a small budget still
        # warms the second card cleanly.
        cards = [_card("sv8", 1), _card("sv8", 2)]
        disk_cache.write_image(LARGE_CATEGORY, cards[0]["id"], b"pre", ext=".png")
        disk_cache.write_image(SMALL_CATEGORY, cards[0]["id"], b"pre", ext=".png")
        with (
            patch.object(TCGClient, "search_all", return_value=cards),
            self._patch_download(),
        ):
            result = warm_card_images(TCGClient(), set_ids=["sv8"], max_bytes=2048)

        self.assertEqual(result.images_warmed, 4)  # 2 pre-warmed + 2 freshly written
        self.assertEqual(result.bytes_written, 2048)  # only the new writes
        self.assertFalse(result.budget_reached)

    def test_sizes_filter_restricts_what_gets_warmed(self) -> None:
        cards = [_card("sv8", 1)]
        with (
            patch.object(TCGClient, "search_all", return_value=cards),
            self._patch_download(),
        ):
            result = warm_card_images(TCGClient(), set_ids=["sv8"], sizes=("small",))

        self.assertEqual(result.images_warmed, 1)
        self.assertIsNone(disk_cache.read_image(LARGE_CATEGORY, cards[0]["id"]))
        self.assertIsNotNone(disk_cache.read_image(SMALL_CATEGORY, cards[0]["id"]))

    def test_card_without_images_dict_is_skipped(self) -> None:
        no_images_card = {"id": "sv8-99", "name": "Promo"}  # no images key
        with (
            patch.object(TCGClient, "search_all", return_value=[no_images_card]),
            self._patch_download(),
        ):
            result = warm_card_images(TCGClient(), set_ids=["sv8"])
        self.assertEqual(result.images_warmed, 0)
        self.assertEqual(result.images_failed, 0)

    def test_download_failure_increments_images_failed(self) -> None:
        cards = [_card("sv8", 1)]
        with (
            patch.object(TCGClient, "search_all", return_value=cards),
            patch.object(card_images_mod, "_download_bytes", return_value=None),
        ):
            result = warm_card_images(TCGClient(), set_ids=["sv8"])

        # Both sizes fail; both increment failed; nothing landed on disk.
        self.assertEqual(result.images_warmed, 0)
        self.assertEqual(result.images_failed, 2)
        self.assertIsNone(disk_cache.read_image(LARGE_CATEGORY, cards[0]["id"]))

    def test_set_returning_no_cards_lands_in_sets_failed(self) -> None:
        with (
            patch.object(TCGClient, "search_all", return_value=[]),
            self._patch_download(),
        ):
            result = warm_card_images(TCGClient(), set_ids=["ghost"])

        self.assertEqual(result.sets_failed, ["ghost"])
        self.assertEqual(result.images_warmed, 0)


# ---------------------------------------------------------------------------
# parse_bytes_budget
# ---------------------------------------------------------------------------


class ParseBytesBudgetTests(unittest.TestCase):
    def test_raw_int_string(self) -> None:
        self.assertEqual(parse_bytes_budget("1024"), 1024)

    def test_suffixes(self) -> None:
        self.assertEqual(parse_bytes_budget("1KB"), 1024)
        self.assertEqual(parse_bytes_budget("1MB"), 1024**2)
        self.assertEqual(parse_bytes_budget("1GB"), 1024**3)
        self.assertEqual(parse_bytes_budget("1TB"), 1024**4)

    def test_case_and_whitespace_tolerant(self) -> None:
        self.assertEqual(parse_bytes_budget(" 5 gb "), 5 * 1024**3)
        self.assertEqual(parse_bytes_budget("500mb"), 500 * 1024**2)

    def test_fractional_values(self) -> None:
        self.assertEqual(parse_bytes_budget("1.5GB"), int(1.5 * 1024**3))

    def test_invalid_raises(self) -> None:
        with self.assertRaises(ValueError):
            parse_bytes_budget("five gigabytes")
        with self.assertRaises(ValueError):
            parse_bytes_budget("")
        with self.assertRaises(ValueError):
            parse_bytes_budget("-1MB")

    def test_raw_negative_int_raises(self) -> None:
        # Regression for Copilot review on #371: a raw negative int
        # like `-1` used to bypass the negative-value guard because it
        # took the no-suffix `int(s)` branch.
        with self.assertRaises(ValueError):
            parse_bytes_budget("-1")
        with self.assertRaises(ValueError):
            parse_bytes_budget("-1024")


# ---------------------------------------------------------------------------
# CacheStats projection
# ---------------------------------------------------------------------------


class CardImagesWarmStatsProjectionTests(_IsolatedCacheMixin):
    def test_stats_reflects_card_images_warm_manifest(self) -> None:
        disk_cache.write_card_images_warm(
            images_warmed=36_000,
            images_failed=14,
            bytes_written=3_500_000_000,
            budget_reached=True,
            sets_attempted=173,
            sets_failed=["x"],
        )
        s = disk_cache.stats()
        self.assertEqual(s.card_images_warm_count, 36_000)
        self.assertEqual(s.card_images_warm_bytes, 3_500_000_000)
        self.assertTrue(s.card_images_warm_budget_reached)
        self.assertIsInstance(s.card_images_warm_timestamp, float)

    def test_stats_zeroed_when_no_manifest(self) -> None:
        s = disk_cache.stats()
        self.assertEqual(s.card_images_warm_count, 0)
        self.assertEqual(s.card_images_warm_bytes, 0)
        self.assertFalse(s.card_images_warm_budget_reached)
        self.assertIsNone(s.card_images_warm_timestamp)


if __name__ == "__main__":
    unittest.main()
