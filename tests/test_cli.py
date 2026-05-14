from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import click

from mgz_pkmn import cache
from mgz_pkmn.cli import _dedupe_rows, _format_age, _format_bytes, _warn_if_cache_large, cli
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.report import build_json_report
from mgz_pkmn.sources.base import MatchResult
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

    def test_json_report_includes_sort_mode(self) -> None:
        rows = [_make_row("a", 10)]
        payload = build_json_report(
            rows=rows,
            counters={},
            input_lines=1,
            elapsed=1.0,
            sort_mode="price-desc",
        )
        self.assertEqual(payload["summary"]["sort_mode"], "price-desc")


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


class WarnIfCacheLargeTests(unittest.TestCase):
    """The soft-warn helper invoked at `pkmn lookup` start. We drive it
    through a throwaway Click command so its `secho(err=True)` output lands
    in `result.stderr` rather than leaking onto the real test terminal."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_warn = os.environ.get(cache._WARN_BYTES_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(cache._WARN_BYTES_ENV, None)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_warn is None:
            os.environ.pop(cache._WARN_BYTES_ENV, None)
        else:
            os.environ[cache._WARN_BYTES_ENV] = self._old_warn
        self._tmp.cleanup()

    @staticmethod
    def _invoke() -> object:
        @click.command()
        def runner() -> None:
            _warn_if_cache_large()

        return CliRunner().invoke(runner, [])

    def test_no_warning_on_empty_cache(self) -> None:
        result = self._invoke()
        self.assertEqual(result.exit_code, 0)
        self.assertEqual(result.stderr, "")

    def test_no_warning_below_threshold(self) -> None:
        cache.write_api("k", {"x": 1})
        # Real default is 50 MB — a single tiny JSON file falls well under.
        result = self._invoke()
        self.assertEqual(result.stderr, "")

    def test_warning_emitted_when_over_threshold(self) -> None:
        cache.write_api("k", {"x": 1})
        os.environ[cache._WARN_BYTES_ENV] = "1"
        result = self._invoke()
        self.assertIn("cache directory is", result.stderr)
        self.assertIn("threshold", result.stderr)
        self.assertIn("--clear-cache", result.stderr)

    def test_warning_shell_quotes_path_with_spaces(self) -> None:
        # XDG roots with spaces are real (e.g. macOS "Application Support").
        # The `rm -rf …` suggestion must be copy-pasteable, so the path
        # needs to be quoted in the printed message.
        spaced = tempfile.TemporaryDirectory(prefix="cache space ")
        self.addCleanup(spaced.cleanup)
        os.environ["XDG_CACHE_HOME"] = spaced.name
        cache.write_api("k", {"x": 1})
        os.environ[cache._WARN_BYTES_ENV] = "1"
        result = self._invoke()
        # The unquoted path would land in the message verbatim; the quoted
        # form wraps it in single quotes (shlex.quote's behaviour on paths
        # with spaces). Either way, the literal "rm -rf <space><space>" with
        # an unquoted space MUST NOT appear.
        self.assertIn("'", result.stderr)
        self.assertNotIn(f"rm -rf {spaced.name}/mgz-pkmn ", result.stderr)

    def test_zero_threshold_disables_warning(self) -> None:
        cache.write_api("k", {"x": 1})
        os.environ[cache._WARN_BYTES_ENV] = "0"
        result = self._invoke()
        self.assertEqual(result.stderr, "")


class LookupSummaryCacheTests(unittest.TestCase):
    """End-to-end check that `· N cached / M fetched` appears in the summary
    when the run produced cache hits — and is suppressed when it didn't.

    We stub `find_card` so the test stays hermetic, but drive real disk-cache
    reads/writes from inside the stub so the counters increment for the same
    reason they would in production."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_warn = os.environ.get(cache._WARN_BYTES_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        # Silence the size-warn helper so it doesn't pollute the captured
        # output we're asserting against.
        os.environ[cache._WARN_BYTES_ENV] = "0"
        cache.reset_api_counters()

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_warn is None:
            os.environ.pop(cache._WARN_BYTES_ENV, None)
        else:
            os.environ[cache._WARN_BYTES_ENV] = self._old_warn

    def _write_inputs(self, names: list[str]) -> Path:
        path = Path(self._tmp.name) / "in.txt"
        path.write_text("\n".join(names) + "\n", encoding="utf-8")
        return path

    def _make_stub(self) -> object:
        """Return a `find_card` replacement that simulates cache traffic.

        Each call reads a per-query URL from disk; if absent, performs a
        write (the production `_fetch_page` does the same). Pre-seeding
        keys before invoking the CLI lets the test force a specific
        hit/fetch mix."""

        def stub(pkmn, tcgdex, pc, q, default_lang=None):
            url = f"https://example.test/q={q.name}"
            if cache.read_api(url) is None:
                cache.write_api(url, {"id": q.name, "name": q.name})
            card = {
                "id": q.name,
                "name": q.name,
                "number": "1",
                "set": {"name": "Test Set"},
                "rarity": "Common",
                "_database": "stub",
            }
            return MatchResult(card, "matched")

        return stub

    def test_summary_includes_cached_and_fetched_counts(self) -> None:
        # Pre-seed one URL so the first query is a hit; the second query
        # writes a fresh entry (a "fetch"). Expected: 1 cached / 1 fetched.
        cache.write_api("https://example.test/q=Mew", {"id": "Mew", "name": "Mew"})
        input_path = self._write_inputs(["Mew", "Pikachu"])
        out = Path(self._tmp.name) / "out.xlsx"

        with patch("mgz_pkmn.cli.find_card", side_effect=self._make_stub()):
            result = CliRunner().invoke(
                cli,
                ["lookup", str(input_path), "-o", str(out), "--no-images"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("1 cached / 1 fetched", result.output)

    def test_summary_omits_cache_counts_when_no_hits(self) -> None:
        # Fresh cache → every query is a fetch, no hits. The summary tail
        # should be suppressed entirely on a zero-hit run.
        input_path = self._write_inputs(["Pikachu"])
        out = Path(self._tmp.name) / "out.xlsx"

        with patch("mgz_pkmn.cli.find_card", side_effect=self._make_stub()):
            result = CliRunner().invoke(
                cli,
                ["lookup", str(input_path), "-o", str(out), "--no-images"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertNotIn("cached", result.output)
        self.assertNotIn("fetched", result.output)


if __name__ == "__main__":
    unittest.main()
