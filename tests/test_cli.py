from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn import cache
from mgz_pkmn.cli import _dedupe_rows, _format_age, _format_bytes, cli
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.report import build_json_report
from mgz_pkmn.spreadsheet import Row


def _make_row(card_id: str | None, market: float | None = None) -> Row:
    card = {"id": card_id, "name": "Card"} if card_id else None
    return Row(
        query=CardQuery(raw="x", name="x"),
        card=card,
        pricing=Pricing(market=market),
        tag="t1",
    )


class CliHelpersTests(unittest.TestCase):
    def test_dedupe_rows_removes_duplicate_card_ids(self) -> None:
        rows = [_make_row("a", 10), _make_row("a", 12), _make_row("b", 8), _make_row(None, None)]
        deduped, removed = _dedupe_rows(rows)
        self.assertEqual(removed, 1)
        self.assertEqual(len(deduped), 3)
        self.assertEqual((deduped[0].card or {}).get("id"), "a")
        self.assertEqual((deduped[1].card or {}).get("id"), "b")
        self.assertIsNone(deduped[2].card)

    def test_json_report_includes_rows_deduped(self) -> None:
        rows = [_make_row("a", 10)]
        payload = build_json_report(
            rows=rows,
            counters={"bulk": 3},
            input_lines=2,
            elapsed=1.2,
            deduped_rows=4,
        )
        self.assertEqual(payload["summary"]["rows_deduped"], 4)
        self.assertEqual(payload["summary"]["rows_total"], 1)
        self.assertEqual(payload["summary"]["rows_bulk_expanded"], 3)


class FormatHelpersTests(unittest.TestCase):
    def test_format_bytes_renders_each_unit(self) -> None:
        self.assertEqual(_format_bytes(0), "0 B")
        self.assertEqual(_format_bytes(512), "512 B")
        self.assertEqual(_format_bytes(2048), "2.0 KB")
        self.assertEqual(_format_bytes(5 * 1024 * 1024), "5.0 MB")

    def test_format_age_returns_dash_for_none(self) -> None:
        self.assertEqual(_format_age(None), "—")

    def test_format_age_bucket_boundaries(self) -> None:
        now = 1_000_000.0
        self.assertEqual(_format_age(now - 10, now=now), "just now")
        self.assertEqual(_format_age(now - 5 * 60, now=now), "5m ago")
        self.assertEqual(_format_age(now - 2 * 3600, now=now), "2h ago")
        self.assertEqual(_format_age(now - 3 * 86400, now=now), "3d ago")


class CacheStatsCommandTests(unittest.TestCase):
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

    def test_stats_command_prints_each_section(self) -> None:
        cache.write_api("https://example.com/a", {"x": 1})
        cache.write_api("https://example.com/b", {"y": 2})
        cache.record_url_override("Mew", None, "https://pc/mew")

        result = CliRunner().invoke(cli, ["cache", "stats"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Cache stats", result.output)
        self.assertIn("API responses: 2 entries", result.output)
        self.assertIn("URL overrides: 1 entries", result.output)
        self.assertIn(self._tmp.name, result.output)

    def test_stats_command_on_empty_cache(self) -> None:
        result = CliRunner().invoke(cli, ["cache", "stats"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("API responses: 0 entries", result.output)
        self.assertIn("oldest —", result.output)


if __name__ == "__main__":
    unittest.main()
