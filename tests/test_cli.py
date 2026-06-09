from __future__ import annotations

import json
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
from mgz_pkmn.cli import (
    _dedupe_rows,
    _format_age,
    _format_bytes,
    _format_price,
    _warn_if_cache_large,
    cli,
)
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


class FormatPriceTests(unittest.TestCase):
    def test_none_renders_plain_dash_without_currency_symbol(self) -> None:
        text = click.unstyle(_format_price(None, "USD"))
        self.assertEqual(text, "—")
        self.assertNotIn("$", text)
        self.assertNotIn("€", text)

    def test_usd_renders_dollar_amount(self) -> None:
        self.assertEqual(click.unstyle(_format_price(12.5, "USD")), "$12.50")

    def test_eur_renders_euro_amount(self) -> None:
        self.assertEqual(click.unstyle(_format_price(12.5, "EUR")), "€12.50")

    def test_unknown_currency_falls_back_to_dollar_amount(self) -> None:
        self.assertEqual(click.unstyle(_format_price(12.5, "GBP")), "$12.50")


class DedupeRowsTests(unittest.TestCase):
    def test_empty_input_returns_empty_rows_and_zero_removed(self) -> None:
        self.assertEqual(_dedupe_rows([]), ([], 0))

    def test_duplicate_card_ids_keep_first_row(self) -> None:
        first = _make_row("a", 10)
        duplicate = _make_row("a", 12)

        deduped, removed = _dedupe_rows([first, duplicate])

        self.assertEqual(deduped, [first])
        self.assertEqual(removed, 1)

    def test_rows_without_cards_are_all_kept(self) -> None:
        first = _make_row(None)
        second = _make_row(None)

        deduped, removed = _dedupe_rows([first, second])

        self.assertEqual(deduped, [first, second])
        self.assertEqual(removed, 0)

    def test_mixed_matched_and_unmatched_only_collapses_matched_duplicates(self) -> None:
        first = _make_row("a", 10)
        unmatched = _make_row(None)
        duplicate = _make_row("a", 12)
        other = _make_row("b", 8)

        deduped, removed = _dedupe_rows([first, unmatched, duplicate, other])

        self.assertEqual(deduped, [first, unmatched, other])
        self.assertEqual(removed, 1)


class FormatBytesTests(unittest.TestCase):
    def test_format_bytes_renders_boundary_units(self) -> None:
        self.assertEqual(_format_bytes(0), "0 B")
        self.assertEqual(_format_bytes(1023), "1023 B")
        self.assertEqual(_format_bytes(1024), "1.0 KB")
        self.assertEqual(_format_bytes(1024 * 1024), "1.0 MB")
        self.assertEqual(_format_bytes(10 * 1024**4), "10.0 TB")


class FormatAgeTests(unittest.TestCase):
    def test_format_age_returns_dash_for_none(self) -> None:
        self.assertEqual(_format_age(None), "—")

    def test_format_age_renders_relative_buckets(self) -> None:
        now = 1_000_000.0
        self.assertEqual(_format_age(now - 30, now=now), "just now")
        self.assertEqual(_format_age(now - 120, now=now), "2m ago")
        self.assertEqual(_format_age(now - 7200, now=now), "2h ago")
        self.assertEqual(_format_age(now - 86400 * 3, now=now), "3d ago")


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
        cache.write_image("sets/logo", "sv8", b"img-bytes")

        result = CliRunner().invoke(cli, ["cache", "stats"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Cache stats", result.output)
        self.assertIn("API responses: 2 entries", result.output)
        self.assertIn("URL overrides: 1 entries", result.output)
        self.assertIn("Images:        1 entries", result.output)
        self.assertIn("indefinite TTL", result.output)
        self.assertIn(self._tmp.name, result.output)

    def test_stats_command_on_empty_cache(self) -> None:
        result = CliRunner().invoke(cli, ["cache", "stats"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("API responses: 0 entries", result.output)
        self.assertIn("oldest —", result.output)

    def test_stats_command_can_emit_json(self) -> None:
        cache.write_api("https://example.com/a", {"x": 1})
        cache.record_url_override("Mew", None, "https://pc/mew")

        result = CliRunner().invoke(cli, ["cache", "stats", "--json"])

        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        self.assertEqual(
            set(payload),
            {
                "api_bytes",
                "api_entry_count",
                "api_oldest_mtime",
                "override_bytes",
                "override_count",
                "image_bytes",
                "image_entry_count",
                "concept_warm_timestamp",
                "concept_warm_names",
                "set_cards_warm_timestamp",
                "set_cards_warm_count",
                "sets_warm_timestamp",
                "sets_warm_count",
                "card_warm_timestamp",
                "card_warm_count",
                "card_warm_failed_count",
                "card_images_warm_timestamp",
                "card_images_warm_count",
                "card_images_warm_bytes",
                "card_images_warm_budget_reached",
                "api_structural_entry_count",
                "api_structural_bytes",
                "api_pricing_entry_count",
                "api_pricing_bytes",
                "api_pricing_oldest_mtime",
                "root",
            },
        )
        self.assertEqual(payload["api_entry_count"], 1)
        self.assertGreater(payload["api_bytes"], 0)
        self.assertIsInstance(payload["api_oldest_mtime"], float)
        self.assertEqual(payload["override_count"], 1)
        self.assertGreater(payload["override_bytes"], 0)
        # New indefinite-TTL image slice. Defaults to zero on a fresh cache;
        # exercised end-to-end by the warm-sets test.
        self.assertEqual(payload["image_entry_count"], 0)
        self.assertEqual(payload["image_bytes"], 0)
        self.assertEqual(payload["root"], str(Path(self._tmp.name) / "mgz-pkmn"))

    def test_warm_sets_primes_cache_and_summarises(self) -> None:
        # The CLI subcommand should walk the catalog (mocked here) and
        # populate `cache/images/sets/{logo,symbol}` with one entry per set,
        # then print a summary line that reflects the per-kind counts.
        from unittest.mock import patch as _patch

        sets = [
            {
                "id": "sv8",
                "name": "Surging Sparks",
                "images": {
                    "logo": "https://ex/sv8-logo.png",
                    "symbol": "https://ex/sv8-symbol.png",
                },
            },
            {
                "id": "sv7",
                "name": "Stellar Crown",
                "images": {"logo": "https://ex/sv7-logo.png"},
            },
        ]

        def _fake_download(category, key, url, session, *, timeout=30):
            # Persist a sentinel byte so image_cache_size reports >0.
            return cache.write_image(category, key, b"warm", ext=url)

        with (
            _patch("mgz_pkmn.set_cards.fetch_all_sets", return_value=sets),
            _patch(
                "mgz_pkmn.set_cards.disk_cache.download_and_cache_image",
                side_effect=_fake_download,
            ),
        ):
            result = CliRunner().invoke(cli, ["cache", "warm-sets"])

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("2 sets", result.output)
        self.assertIn("2 logos", result.output)
        self.assertIn("1 symbols", result.output)
        # On-disk: a logo for each set, plus the one symbol.
        self.assertIsNotNone(cache.read_image("sets/logo", "sv8"))
        self.assertIsNotNone(cache.read_image("sets/logo", "sv7"))
        self.assertIsNotNone(cache.read_image("sets/symbol", "sv8"))
        self.assertIsNone(cache.read_image("sets/symbol", "sv7"))
        # Manifest is written so `sets_warm_is_fresh()` returns True for
        # the next caller (e.g. the lifespan startup bootstrap). Without
        # this, every restart would re-walk upstream.
        manifest = cache.read_sets_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None  # narrow for type checkers
        self.assertEqual(manifest["sets_warmed"], 2)
        self.assertEqual(manifest["logos_cached"], 2)
        self.assertEqual(manifest["symbols_cached"], 1)
        self.assertEqual(manifest["failures"], 0)

    def test_warm_sets_verbose_prints_per_set_progress(self) -> None:
        # `-v` should fire the on_progress callback so each set's id lands
        # in the output. Covers the verbose branch of cache_warm_sets_command.
        from unittest.mock import patch as _patch

        sets = [
            {"id": "sv8", "name": "Surging Sparks", "images": {"logo": "u"}},
            {"id": "sv7", "name": "Stellar Crown", "images": {"logo": "u"}},
        ]

        def _fake_download(category, key, url, session, *, timeout=30):
            return cache.write_image(category, key, b"warm", ext=url)

        with (
            _patch("mgz_pkmn.set_cards.fetch_all_sets", return_value=sets),
            _patch(
                "mgz_pkmn.set_cards.disk_cache.download_and_cache_image",
                side_effect=_fake_download,
            ),
        ):
            result = CliRunner().invoke(cli, ["cache", "warm-sets", "-v"])

        self.assertEqual(result.exit_code, 0, result.output)
        # Both set ids appear with [n/total] prefixes.
        self.assertIn("[1/2]", result.output)
        self.assertIn("sv8", result.output)
        self.assertIn("[2/2]", result.output)
        self.assertIn("sv7", result.output)

    def test_warm_sets_surfaces_upstream_request_failures(self) -> None:
        # A network failure during `fetch_all_sets` should surface as a
        # ClickException with the underlying error message — not a bare
        # traceback.
        from unittest.mock import patch as _patch

        import requests as _requests

        with _patch(
            "mgz_pkmn.set_cards.fetch_all_sets",
            side_effect=_requests.ConnectionError("network down"),
        ):
            result = CliRunner().invoke(cli, ["cache", "warm-sets"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("set fetch failed", result.output)
        self.assertIn("network down", result.output)

    def test_warm_sets_reports_failures_in_summary(self) -> None:
        # When some images fail to download, the summary line should
        # surface the failure count in yellow rather than hiding it.
        from unittest.mock import patch as _patch

        sets = [
            {
                "id": "sv8",
                "name": "Surging Sparks",
                "images": {
                    "logo": "https://example/sv8-logo.png",
                    "symbol": "https://example/sv8-symbol.png",
                },
            },
        ]

        def _half_failing(category, key, url, session, *, timeout=30):
            # Logo succeeds, symbol fails.
            if "logo" in category:
                return cache.write_image(category, key, b"warm", ext=url)
            return None

        with (
            _patch("mgz_pkmn.set_cards.fetch_all_sets", return_value=sets),
            _patch(
                "mgz_pkmn.set_cards.disk_cache.download_and_cache_image",
                side_effect=_half_failing,
            ),
        ):
            result = CliRunner().invoke(cli, ["cache", "warm-sets"])

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("1 failures", result.output)

    def test_set_cards_set_flag_filters_writer(self) -> None:
        # `pkmn set-cards --set sv8 --set sv7` should reach
        # write_set_cards_pdf with only those two entries.
        from unittest.mock import patch as _patch

        sets = [
            {"id": "sv8", "name": "Surging Sparks", "images": {}},
            {"id": "sv7", "name": "Stellar Crown", "images": {}},
            {"id": "sv6", "name": "Twilight Masquerade", "images": {}},
        ]
        captured: dict = {}

        def _fake_writer(rows, out_path, *, logos_dir=None, session=None, today=None):
            captured["sets"] = rows
            out_path.write_bytes(b"%PDF\n")
            return len(rows)

        with (
            _patch("mgz_pkmn.cli.set_cards.fetch_all_sets", return_value=sets),
            _patch("mgz_pkmn.cli.set_cards.write_set_cards_pdf", side_effect=_fake_writer),
            tempfile.TemporaryDirectory() as tmp,
        ):
            out = Path(tmp) / "out.pdf"
            result = CliRunner().invoke(
                cli, ["set-cards", "-o", str(out), "--set", "sv8", "--set", "sv7"]
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("filtered to 2 sets", result.output)
        self.assertEqual([s["id"] for s in captured["sets"]], ["sv8", "sv7"])

    def test_set_cards_set_flag_with_unknown_id_fails(self) -> None:
        # An id that doesn't match any catalog entry should surface as a
        # ClickException — not silently produce an empty PDF.
        from unittest.mock import patch as _patch

        sets = [{"id": "sv8", "name": "Surging Sparks", "images": {}}]

        with (
            _patch("mgz_pkmn.cli.set_cards.fetch_all_sets", return_value=sets),
            tempfile.TemporaryDirectory() as tmp,
        ):
            out = Path(tmp) / "out.pdf"
            result = CliRunner().invoke(
                cli, ["set-cards", "-o", str(out), "--set", "does-not-exist"]
            )

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("does-not-exist", result.output)

    def test_warm_sets_clickfails_when_catalog_is_empty(self) -> None:
        # An empty catalog should surface as a ClickException, not a silent
        # success — the user installing fresh would otherwise have no
        # signal that the warm pass did nothing.
        from unittest.mock import patch as _patch

        with _patch("mgz_pkmn.set_cards.fetch_all_sets", return_value=[]):
            result = CliRunner().invoke(cli, ["cache", "warm-sets"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("no sets", result.output.lower())

    def test_path_command_prints_bare_cache_root(self) -> None:
        expected = Path(self._tmp.name) / "mgz-pkmn"

        result = CliRunner().invoke(cli, ["cache", "path"])

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(result.output, f"{expected}\n")
        self.assertNotRegex(result.output, r"\x1b\[")

    def test_clear_command_on_empty_cache_reports_zero(self) -> None:
        # Fresh cache: nothing to wipe, but the command should still exit
        # cleanly and report a coherent summary rather than blowing up on
        # the missing `api/` directory.
        result = CliRunner().invoke(cli, ["cache", "clear"])

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Clearing API response cache", result.output)
        self.assertIn("0 entries cleared", result.output)
        self.assertIn("0 B freed", result.output)

    def test_clear_command_wipes_api_entries_and_preserves_overrides(self) -> None:
        cache.write_api("https://example.com/a", {"x": 1})
        cache.write_api("https://example.com/b", {"y": 2})
        cache.record_url_override("Mew", None, "https://pc/mew")
        cache.write_image("sets/logo", "sv8", b"img-bytes")
        api_bytes_before = cache.stats().api_bytes
        self.assertGreater(api_bytes_before, 0)

        result = CliRunner().invoke(cli, ["cache", "clear"])

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("2 entries cleared", result.output)
        # Bytes-freed reflects the pre-wipe API slice — humanised via
        # `_format_bytes`, so we just assert the unit suffix is present
        # rather than pinning a precise byte count that changes with
        # JSON formatting.
        self.assertRegex(result.output, r"\d+ B freed|\d+\.\d+ KB freed")
        # API slice is gone; overrides + images stay put.
        after = cache.stats()
        self.assertEqual(after.api_entry_count, 0)
        self.assertEqual(after.api_bytes, 0)
        self.assertEqual(after.override_count, 1)
        self.assertEqual(after.image_entry_count, 1)
        # Overrides remain usable after the wipe (not just on disk — the
        # full read path still resolves).
        self.assertEqual(cache.find_url_override("Mew", None), "https://pc/mew")

    def test_clear_command_runs_even_when_no_cache_env_set(self) -> None:
        # `--clear-cache` / `clear_api_cache()` are documented as honoured
        # even under `MGZ_PKMN_NO_CACHE=1` — the user's explicit wipe wins
        # over the implicit skip. The subcommand has to honour the same
        # contract so scripts that set the env still get a working wipe.
        cache.write_api("https://example.com/a", {"x": 1})
        os.environ[cache._NO_CACHE_ENV] = "1"

        result = CliRunner().invoke(cli, ["cache", "clear"])

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("1 entry cleared", result.output)
        self.assertEqual(cache.stats().api_entry_count, 0)


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

        with patch("mgz_pkmn.cli.lookup.find_card", side_effect=self._make_stub()):
            result = CliRunner().invoke(
                cli,
                ["lookup", str(input_path), "-o", str(out), "--no-images"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("1 cached / 1 fetched", result.output)

    def test_report_json_records_sort_mode_from_cli(self) -> None:
        # Drives the full CLI wiring: `--sort` must reach `summary.sort_mode`
        # in the written report, not just `build_json_report`'s argument.
        input_path = self._write_inputs(["Mew"])
        out = Path(self._tmp.name) / "out.xlsx"
        report_path = Path(self._tmp.name) / "summary.json"

        with patch("mgz_pkmn.cli.lookup.find_card", side_effect=self._make_stub()):
            result = CliRunner().invoke(
                cli,
                [
                    "lookup",
                    str(input_path),
                    "-o",
                    str(out),
                    "--no-images",
                    "--report-json",
                    str(report_path),
                    "--sort",
                    "price-desc",
                ],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(payload["summary"]["sort_mode"], "price-desc")

    def test_print_summary_only_suppresses_all_writes(self) -> None:
        # --print-summary-only must still print the run summary but write
        # nothing: no xlsx, PDF, or JSON report on disk.
        input_path = self._write_inputs(["Mew", "Pikachu"])
        out = Path(self._tmp.name) / "out.xlsx"
        pdf = Path(self._tmp.name) / "binder.pdf"
        report_path = Path(self._tmp.name) / "summary.json"

        with patch("mgz_pkmn.cli.lookup.find_card", side_effect=self._make_stub()):
            result = CliRunner().invoke(
                cli,
                [
                    "lookup",
                    str(input_path),
                    "-o",
                    str(out),
                    "--pdf",
                    str(pdf),
                    "--report-json",
                    str(report_path),
                    "--print-summary-only",
                ],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("matched", result.output)
        self.assertIn("outputs skipped (--print-summary-only)", result.output)
        self.assertFalse(out.exists(), "xlsx should not be written")
        self.assertFalse(pdf.exists(), "PDF should not be written")
        self.assertFalse(report_path.exists(), "JSON report should not be written")

    def test_summary_omits_cache_counts_when_no_hits(self) -> None:
        # Fresh cache → every query is a fetch, no hits. The summary tail
        # should be suppressed entirely on a zero-hit run.
        input_path = self._write_inputs(["Pikachu"])
        out = Path(self._tmp.name) / "out.xlsx"

        with patch("mgz_pkmn.cli.lookup.find_card", side_effect=self._make_stub()):
            result = CliRunner().invoke(
                cli,
                ["lookup", str(input_path), "-o", str(out), "--no-images"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertNotIn("cached", result.output)
        self.assertNotIn("fetched", result.output)


class LookupCurrencyWarningTests(unittest.TestCase):
    """The ⚠ currency-blind warning should appear only when --max-price is set
    AND the result set contains a genuine mix of USD and non-USD priced rows."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_warn = os.environ.get(cache._WARN_BYTES_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
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

    @staticmethod
    def _mixed_currency_stub(pkmn, tcgdex, pc, q, default_lang=None):
        """Return USD pricing for 'Mew', EUR pricing for 'Pikachu'."""
        if q.name == "Pikachu":
            card = {
                "id": "pikachu-eur",
                "name": "Pikachu",
                "number": "1",
                "set": {"name": "Test Set"},
                "_database": "stub",
                "cardmarket": {
                    "_currency": "EUR",
                    "prices": {"averageSellPrice": 15.0},
                },
            }
        else:
            card = {
                "id": "mew-usd",
                "name": "Mew",
                "number": "1",
                "set": {"name": "Test Set"},
                "_database": "stub",
                "tcgplayer": {"prices": {"holofoil": {"market": 10.0}}},
            }
        return MatchResult(card, "matched")

    @staticmethod
    def _usd_only_stub(pkmn, tcgdex, pc, q, default_lang=None):
        card = {
            "id": q.name,
            "name": q.name,
            "number": "1",
            "set": {"name": "Test Set"},
            "_database": "stub",
            "tcgplayer": {"prices": {"holofoil": {"market": 10.0}}},
        }
        return MatchResult(card, "matched")

    def test_warning_emitted_for_mixed_currencies_with_max_price(self) -> None:
        input_path = self._write_inputs(["Mew", "Pikachu"])
        out = Path(self._tmp.name) / "out.xlsx"

        with patch("mgz_pkmn.cli.lookup.find_card", side_effect=self._mixed_currency_stub):
            result = CliRunner().invoke(
                cli,
                ["lookup", str(input_path), "-o", str(out), "--no-images", "--max-price", "20"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("currency-blind", result.output)

    def test_warning_suppressed_for_single_currency_with_max_price(self) -> None:
        input_path = self._write_inputs(["Mew", "Pikachu"])
        out = Path(self._tmp.name) / "out.xlsx"

        with patch("mgz_pkmn.cli.lookup.find_card", side_effect=self._usd_only_stub):
            result = CliRunner().invoke(
                cli,
                ["lookup", str(input_path), "-o", str(out), "--no-images", "--max-price", "20"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertNotIn("currency-blind", result.output)

    def test_warning_suppressed_without_max_price(self) -> None:
        input_path = self._write_inputs(["Mew", "Pikachu"])
        out = Path(self._tmp.name) / "out.xlsx"

        with patch("mgz_pkmn.cli.lookup.find_card", side_effect=self._mixed_currency_stub):
            result = CliRunner().invoke(
                cli,
                ["lookup", str(input_path), "-o", str(out), "--no-images"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertNotIn("currency-blind", result.output)


# ---------------------------------------------------------------------------
# `pkmn cache warm-cards` — Phase 1 of the pre-Scrydex catalog-warm epic
# (#370). Mirrors the warm-sets CLI tests above: mock the upstream
# `warm_cards` call, assert the CLI reports the result + writes the
# manifest.
# ---------------------------------------------------------------------------


class CacheWarmCardsCommandTests(unittest.TestCase):
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

    def test_warm_cards_writes_manifest_and_reports_counts(self) -> None:
        from unittest.mock import patch as _patch

        from mgz_pkmn.lookup import WarmCardsResult

        fake_result = WarmCardsResult(
            sets_attempted=2,
            cards_warmed=42,
            cards_failed=0,
            sets_failed=[],
        )

        with _patch("mgz_pkmn.cli.cache.warm_cards", return_value=fake_result):
            result = CliRunner().invoke(
                cli, ["cache", "warm-cards", "--set", "sv8", "--set", "sv7"]
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("2 sets", result.output)
        self.assertIn("42 cards warmed", result.output)

        # Manifest landed on disk with the result counts.
        manifest = cache.read_card_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None
        self.assertEqual(manifest["cards_warmed"], 42)
        self.assertEqual(manifest["sets_attempted"], 2)
        self.assertEqual(manifest["cards_failed"], 0)

    def test_warm_cards_surfaces_request_failure(self) -> None:
        from unittest.mock import patch as _patch

        import requests as _requests

        with _patch(
            "mgz_pkmn.cli.cache.warm_cards", side_effect=_requests.ConnectionError("network down")
        ):
            result = CliRunner().invoke(cli, ["cache", "warm-cards"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("card warm failed", result.output)
        self.assertIn("network down", result.output)

    def test_warm_cards_verbose_prints_per_set_progress_and_missed_dump(self) -> None:
        """`-v` exercises the on_progress callback and the missed-sets dump
        at the end. Also drives `--max-cards` so the section header reflects
        the cap."""
        from unittest.mock import patch as _patch

        from mgz_pkmn.lookup import WarmCardsResult

        def fake_warm(pkmn, *, set_ids, max_cards, skip_existing, throttle_ms, on_progress):
            # Drive the progress callback so the verbose branch (lines 1468-1470)
            # fires for both sets the CLI passed in.
            on_progress(1, 2, "sv8")
            on_progress(2, 2, "ghost")
            return WarmCardsResult(
                sets_attempted=2,
                cards_warmed=5,
                cards_failed=0,
                sets_failed=["ghost"],
            )

        with _patch("mgz_pkmn.cli.cache.warm_cards", side_effect=fake_warm):
            result = CliRunner().invoke(
                cli,
                [
                    "cache",
                    "warm-cards",
                    "--set",
                    "sv8",
                    "--set",
                    "ghost",
                    "--max-cards",
                    "5",
                    "-v",
                ],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        # `--max-cards 5` lands in the section header.
        self.assertIn("max 5 cards", result.output)
        # Per-set progress lines fired.
        self.assertIn("[1/2]", result.output)
        self.assertIn("sv8", result.output)
        self.assertIn("[2/2]", result.output)
        # Missed-sets dump fired at the end.
        self.assertIn("missed:", result.output)
        self.assertIn("ghost", result.output)

    def test_warm_cards_rejects_empty_pass(self) -> None:
        from unittest.mock import patch as _patch

        from mgz_pkmn.lookup import WarmCardsResult

        with _patch(
            "mgz_pkmn.cli.cache.warm_cards",
            return_value=WarmCardsResult(
                sets_attempted=0, cards_warmed=0, cards_failed=0, sets_failed=[]
            ),
        ):
            result = CliRunner().invoke(cli, ["cache", "warm-cards"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("no sets to warm", result.output)


# ---------------------------------------------------------------------------
# `pkmn cache warm-card-images` — Phase 2 of the pre-Scrydex catalog-warm
# epic (#371). Mirrors CacheWarmCardsCommandTests above: mock the upstream
# `warm_card_images` call, assert the CLI reports the result + writes the
# manifest, and exercise the flag parsers (--sizes / --max-bytes).
# ---------------------------------------------------------------------------


class CacheWarmCardImagesCommandTests(unittest.TestCase):
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

    def test_warm_card_images_writes_manifest_and_reports_summary(self) -> None:
        from unittest.mock import patch as _patch

        from mgz_pkmn.card_images import WarmCardImagesResult

        fake_result = WarmCardImagesResult(
            sets_attempted=3,
            images_warmed=120,
            images_failed=2,
            bytes_written=10 * 1024 * 1024,
            budget_reached=False,
            sets_failed=[],
        )
        with _patch("mgz_pkmn.cli.cache.warm_card_images", return_value=fake_result):
            result = CliRunner().invoke(
                cli, ["cache", "warm-card-images", "--set", "sv8", "--set", "sv7", "--set", "base1"]
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("3 sets", result.output)
        self.assertIn("120 images warmed", result.output)
        self.assertIn("10.0 MB downloaded", result.output)
        self.assertIn("2 failed", result.output)

        manifest = cache.read_card_images_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None
        self.assertEqual(manifest["images_warmed"], 120)
        self.assertEqual(manifest["bytes_written"], 10 * 1024 * 1024)
        self.assertFalse(manifest["budget_reached"])

    def test_warm_card_images_max_bytes_and_sizes_parsers(self) -> None:
        """Exercise --max-bytes (parses 100MB → bytes) and --sizes small."""
        from unittest.mock import patch as _patch

        from mgz_pkmn.card_images import WarmCardImagesResult

        captured: dict = {}

        def fake_warm(pkmn, **kwargs):
            captured.update(kwargs)
            return WarmCardImagesResult(
                sets_attempted=1,
                images_warmed=1,
                images_failed=0,
                bytes_written=500,
                budget_reached=True,
                sets_failed=[],
            )

        with _patch("mgz_pkmn.cli.cache.warm_card_images", side_effect=fake_warm):
            result = CliRunner().invoke(
                cli,
                [
                    "cache",
                    "warm-card-images",
                    "--set",
                    "sv8",
                    "--max-bytes",
                    "100MB",
                    "--sizes",
                    "small",
                ],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(captured["max_bytes"], 100 * 1024 * 1024)
        self.assertEqual(captured["sizes"], ("small",))
        # Section header reflects both flags.
        self.assertIn("sizes=small", result.output)
        self.assertIn("max 100.0 MB", result.output)
        # `budget_reached=True` lands in the result line.
        self.assertIn("budget reached", result.output)

    def test_warm_card_images_invalid_sizes_rejected_at_parse_time(self) -> None:
        result = CliRunner().invoke(cli, ["cache", "warm-card-images", "--sizes", "huge"])
        self.assertNotEqual(result.exit_code, 0)
        # Click renders BadParameter as 'Invalid value for ...'.
        self.assertIn("unknown size", result.output.lower())

    def test_warm_card_images_invalid_max_bytes_rejected_at_parse_time(self) -> None:
        result = CliRunner().invoke(
            cli, ["cache", "warm-card-images", "--max-bytes", "five gigabytes"]
        )
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("invalid byte budget", result.output.lower())

    def test_warm_card_images_verbose_prints_per_set_progress_and_missed_dump(self) -> None:
        from unittest.mock import patch as _patch

        from mgz_pkmn.card_images import WarmCardImagesResult

        def fake_warm(pkmn, **kwargs):
            kwargs["on_progress"](1, 2, "sv8")
            kwargs["on_progress"](2, 2, "ghost")
            return WarmCardImagesResult(
                sets_attempted=2,
                images_warmed=4,
                images_failed=0,
                bytes_written=4096,
                budget_reached=False,
                sets_failed=["ghost"],
            )

        with _patch("mgz_pkmn.cli.cache.warm_card_images", side_effect=fake_warm):
            result = CliRunner().invoke(
                cli,
                ["cache", "warm-card-images", "--set", "sv8", "--set", "ghost", "-v"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("[1/2]", result.output)
        self.assertIn("sv8", result.output)
        self.assertIn("[2/2]", result.output)
        self.assertIn("missed:", result.output)
        self.assertIn("ghost", result.output)

    def test_warm_card_images_surfaces_request_failure(self) -> None:
        from unittest.mock import patch as _patch

        import requests as _requests

        with _patch(
            "mgz_pkmn.cli.cache.warm_card_images",
            side_effect=_requests.ConnectionError("network down"),
        ):
            result = CliRunner().invoke(cli, ["cache", "warm-card-images"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("card-image warm failed", result.output)
        self.assertIn("network down", result.output)

    def test_warm_card_images_rejects_empty_pass(self) -> None:
        from unittest.mock import patch as _patch

        from mgz_pkmn.card_images import WarmCardImagesResult

        with _patch(
            "mgz_pkmn.cli.cache.warm_card_images",
            return_value=WarmCardImagesResult(
                sets_attempted=0,
                images_warmed=0,
                images_failed=0,
                bytes_written=0,
                budget_reached=False,
                sets_failed=[],
            ),
        ):
            result = CliRunner().invoke(cli, ["cache", "warm-card-images"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("no sets to warm", result.output)


# ---------------------------------------------------------------------------
# `pkmn cache stats` rendering of the card_images warm slice (#371).
# ---------------------------------------------------------------------------


class CacheStatsCardImagesRowTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        os.environ["XDG_CACHE_HOME"] = self._tmp.name

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        self._tmp.cleanup()

    def test_stats_shows_not_warmed_when_no_manifest(self) -> None:
        result = CliRunner().invoke(cli, ["cache", "stats"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Card images:", result.output)
        self.assertIn("not warmed", result.output)
        self.assertIn("warm-card-images", result.output)

    def test_stats_shows_count_bytes_and_budget_when_manifest_present(self) -> None:
        cache.write_card_images_warm(
            images_warmed=200,
            images_failed=0,
            bytes_written=3 * 1024 * 1024 * 1024,
            budget_reached=True,
            sets_attempted=10,
            sets_failed=[],
        )
        result = CliRunner().invoke(cli, ["cache", "stats"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("200 images", result.output)
        self.assertIn("3.0 GB", result.output)
        self.assertIn("budget reached", result.output)


if __name__ == "__main__":
    unittest.main()
