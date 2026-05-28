"""Tests for `pkmn cache warm-set-cards` — the per-set card-list warming pass.

Mirrors the structure of `test_warm_concepts.py`: stub clients,
manifest read/write/freshness, CLI summary, stats projection, and
the FastAPI startup hook. Lives in its own module so the warm-concepts
file stays focused."""

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
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.lookup import (
    WarmSetCardsResult,
    warm_set_cards,
)

# ---------------------------------------------------------------------------
# Stub clients used across the warm tests. We deliberately don't reuse the
# `_CountingTCGClient` from test_warm_concepts because that returns the same
# fixed payload for every query; here we want to script per-set behaviour
# so the "some sets succeed, some fail" branch is exercised.
# ---------------------------------------------------------------------------


class _StubTCGClient:
    """Stub `TCGClient` whose `search_all` consults a per-query mapping.

    `cards_by_query[<query>] = [<card>, ...]` controls what each warmed
    query returns. Missing keys produce an empty list — the "set
    upstream-missing" branch."""

    def __init__(self, cards_by_query: dict[str, list[dict]] | None = None) -> None:
        self.cards_by_query: dict[str, list[dict]] = cards_by_query or {}
        self.queries: list[str] = []
        # `session` is hit by `fetch_set_ids` only — left as None so any
        # accidental network access surfaces as an AttributeError, not a
        # silent live HTTP call.
        self.session = None

    def search_all(self, query: str, **_: object) -> list[dict]:
        self.queries.append(query)
        return self.cards_by_query.get(query, [])


# ---------------------------------------------------------------------------
# Core warmer behaviour
# ---------------------------------------------------------------------------


class WarmSetCardsCoreTests(unittest.TestCase):
    def test_returns_zero_when_no_set_ids_passed_and_no_fetch(self) -> None:
        # With an explicit empty set list, no upstream call fires and the
        # result is a clean zero. Useful smoke check that the no-ids
        # path doesn't try to fetch the catalog.
        client = _StubTCGClient()
        result = warm_set_cards(client, set_ids=[])
        self.assertEqual(result.sets_attempted, 0)
        self.assertEqual(result.sets_warmed, 0)
        self.assertEqual(result.sets_failed, [])
        self.assertEqual(client.queries, [])

    def test_walks_explicit_set_ids_and_counts_warmed(self) -> None:
        client = _StubTCGClient(
            cards_by_query={
                'set.id:"sv8"': [{"id": "sv8-1", "name": "Pikachu"}],
                'set.id:"sv9"': [{"id": "sv9-1", "name": "Bulbasaur"}],
                # `bogus` returns nothing → counts as missed.
                'set.id:"bogus"': [],
            }
        )
        result = warm_set_cards(client, set_ids=["sv8", "sv9", "bogus"])
        self.assertEqual(result.sets_attempted, 3)
        self.assertEqual(result.sets_warmed, 2)
        self.assertEqual(result.sets_failed, ["bogus"])

    def test_query_shape_matches_endpoint(self) -> None:
        # The disk-cache key is derived from the request URL deep inside
        # `TCGClient._fetch_page`, so the warmer's query string MUST match
        # `_fetch_set_cards` exactly or the cache keys won't line up.
        client = _StubTCGClient()
        warm_set_cards(client, set_ids=["sv8"])
        self.assertEqual(client.queries, ['set.id:"sv8"'])

    def test_progress_callback_fires_per_set(self) -> None:
        progress: list[tuple[int, int, str]] = []
        client = _StubTCGClient(
            cards_by_query={
                'set.id:"a"': [{"id": "a-1"}],
                'set.id:"b"': [{"id": "b-1"}],
            }
        )
        warm_set_cards(
            client,
            set_ids=["a", "b"],
            on_progress=lambda i, t, s: progress.append((i, t, s)),
        )
        self.assertEqual(progress, [(1, 2, "a"), (2, 2, "b")])

    def test_falls_back_to_fetched_catalog_when_no_set_ids(self) -> None:
        # When `set_ids` is None we should call `fetch_set_ids`. Patch
        # that helper to avoid live HTTP and assert the call shape.
        client = _StubTCGClient(cards_by_query={'set.id:"a"': [{"id": "a"}], 'set.id:"b"': []})
        with patch("mgz_pkmn.lookup.fetch_set_ids", return_value=["a", "b"]) as fetch_mock:
            result = warm_set_cards(client)
        fetch_mock.assert_called_once_with(client)
        self.assertEqual(result.sets_attempted, 2)
        self.assertEqual(result.sets_warmed, 1)
        self.assertEqual(result.sets_failed, ["b"])


# ---------------------------------------------------------------------------
# Manifest read/write + freshness gate
# ---------------------------------------------------------------------------


class _IsolatedCacheMixin(unittest.TestCase):
    """Point XDG_CACHE_HOME at a tempdir so manifest writes don't touch $HOME."""

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


class SetCardsManifestTests(_IsolatedCacheMixin):
    def test_read_returns_none_when_absent(self) -> None:
        self.assertIsNone(disk_cache.read_set_cards_warm())

    def test_write_then_read_roundtrip(self) -> None:
        disk_cache.write_set_cards_warm(sets_warmed=12, sets_failed=["bogus"])
        data = disk_cache.read_set_cards_warm()
        self.assertIsNotNone(data)
        assert data is not None  # narrow for type checkers
        self.assertEqual(data["sets_warmed"], 12)
        self.assertEqual(data["sets_failed"], ["bogus"])
        self.assertIsInstance(data["timestamp"], float)

    def test_read_rejects_malformed_payload(self) -> None:
        path = disk_cache._set_cards_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json", encoding="utf-8")
        self.assertIsNone(disk_cache.read_set_cards_warm())

    def test_read_rejects_unknown_schema_version(self) -> None:
        path = disk_cache._set_cards_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"version": 99, "timestamp": 0.0, "sets_warmed": 0, "sets_failed": []}),
            encoding="utf-8",
        )
        self.assertIsNone(disk_cache.read_set_cards_warm())


class SetCardsFreshnessTests(_IsolatedCacheMixin):
    def test_no_manifest_is_not_fresh(self) -> None:
        self.assertFalse(disk_cache.set_cards_warm_is_fresh())

    def test_fresh_within_window(self) -> None:
        disk_cache.write_set_cards_warm(sets_warmed=5, sets_failed=[])
        self.assertTrue(disk_cache.set_cards_warm_is_fresh())

    def test_stale_outside_window(self) -> None:
        disk_cache.write_set_cards_warm(sets_warmed=5, sets_failed=[])
        # Pretend we're checking 8 days in the future — past the 7-day
        # SET_CARDS_WARM_STALE_SECONDS window.
        future = time.time() + (8 * 24 * 60 * 60)
        self.assertFalse(disk_cache.set_cards_warm_is_fresh(now=future))

    def test_zero_warmed_manifest_is_not_fresh(self) -> None:
        # Even a recent manifest must not suppress retry when its
        # `sets_warmed` is zero — that's the "every upstream call failed"
        # signal, and the next startup should re-attempt the warm.
        disk_cache.write_set_cards_warm(sets_warmed=0, sets_failed=["a", "b"])
        self.assertFalse(disk_cache.set_cards_warm_is_fresh())


# ---------------------------------------------------------------------------
# Stats projection + CLI line
# ---------------------------------------------------------------------------


class StatsIncludesSetCardsWarmTests(_IsolatedCacheMixin):
    def test_stats_reports_none_when_no_manifest(self) -> None:
        s = disk_cache.stats()
        self.assertIsNone(s.set_cards_warm_timestamp)
        self.assertEqual(s.set_cards_warm_count, 0)

    def test_stats_reflects_recorded_manifest(self) -> None:
        disk_cache.write_set_cards_warm(sets_warmed=42, sets_failed=[])
        s = disk_cache.stats()
        self.assertIsNotNone(s.set_cards_warm_timestamp)
        self.assertEqual(s.set_cards_warm_count, 42)


class CacheStatsSetCardsLineTests(_IsolatedCacheMixin):
    """`pkmn cache stats` renders a Set cards: line, prompting a warm
    when no manifest exists."""

    def _invoke(self):  # type: ignore[no-untyped-def]
        from click.testing import CliRunner

        from mgz_pkmn.cli import cli

        return CliRunner().invoke(cli, ["cache", "stats"])

    def test_renders_not_warmed_prompt_when_no_manifest(self) -> None:
        result = self._invoke()
        self.assertEqual(result.exit_code, 0, result.output)
        # The Set cards line lives on its own; "not warmed" + the
        # subcommand name guide the operator to a fix.
        set_cards_line = next(
            (line for line in result.output.splitlines() if "Set cards:" in line),
            "",
        )
        self.assertIn("not warmed", set_cards_line)
        self.assertIn("warm-set-cards", set_cards_line)

    def test_renders_warmed_count_when_manifest_present(self) -> None:
        disk_cache.write_set_cards_warm(sets_warmed=173, sets_failed=[])
        result = self._invoke()
        self.assertEqual(result.exit_code, 0, result.output)
        set_cards_line = next(
            (line for line in result.output.splitlines() if "Set cards:" in line),
            "",
        )
        self.assertIn("173 sets", set_cards_line)
        self.assertIn("warmed", set_cards_line)
        # The not-warmed branch must NOT appear on this specific line.
        self.assertNotIn("not warmed", set_cards_line)


# ---------------------------------------------------------------------------
# CLI subcommand
# ---------------------------------------------------------------------------


class CacheWarmSetCardsCLITests(_IsolatedCacheMixin):
    def _invoke(self, *args: str):  # type: ignore[no-untyped-def]
        from click.testing import CliRunner

        from mgz_pkmn.cli import cli

        return CliRunner().invoke(cli, ["cache", "warm-set-cards", *args])

    def test_warm_command_writes_manifest_and_summarises(self) -> None:
        fake_result = WarmSetCardsResult(sets_attempted=3, sets_warmed=2, sets_failed=["bogus"])
        with patch("mgz_pkmn.cli.warm_set_cards", return_value=fake_result):
            result = self._invoke("--set", "sv8", "--set", "sv9", "--set", "bogus")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("3 sets", result.output)
        self.assertIn("2 warmed", result.output)
        # Manifest must have landed on disk so subsequent `stats` reflects
        # the run.
        manifest = disk_cache.read_set_cards_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None
        self.assertEqual(manifest["sets_warmed"], 2)
        self.assertEqual(manifest["sets_failed"], ["bogus"])

    def test_warm_command_fails_loudly_when_zero_sets(self) -> None:
        # An empty catalog (e.g. `--set` flag missing and `fetch_set_ids`
        # returned nothing) should surface as a click error rather than
        # silently writing a zero-count manifest.
        fake_result = WarmSetCardsResult(sets_attempted=0, sets_warmed=0, sets_failed=[])
        with patch("mgz_pkmn.cli.warm_set_cards", return_value=fake_result):
            result = self._invoke()
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("no sets to warm", result.output.lower())

    def test_warm_command_surfaces_upstream_failure(self) -> None:
        import requests as req_lib

        with patch(
            "mgz_pkmn.cli.warm_set_cards",
            side_effect=req_lib.ConnectionError("upstream down"),
        ):
            result = self._invoke("--set", "sv8")
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("set-cards warm failed", result.output)


# ---------------------------------------------------------------------------
# API startup hook
# ---------------------------------------------------------------------------


class WarmSetCardsBackgroundHookTests(_IsolatedCacheMixin):
    def test_skips_when_cache_is_fresh(self) -> None:
        from api.main import _warm_set_cards_in_background

        # Plant a fresh manifest — the gate should short-circuit before
        # touching the warm function.
        disk_cache.write_set_cards_warm(sets_warmed=10, sets_failed=[])
        with patch("api.main.warm_set_cards") as warm_mock:
            _warm_set_cards_in_background()
            warm_mock.assert_not_called()

    def test_runs_warm_and_persists_manifest_when_stale(self) -> None:
        import threading

        from api.main import _warm_set_cards_in_background

        # No manifest → freshness gate returns False → we expect a real
        # background daemon. Mock the warm function so no HTTP fires and
        # block on the thread.
        fake = WarmSetCardsResult(sets_attempted=5, sets_warmed=4, sets_failed=["x"])
        with patch("api.main.warm_set_cards", return_value=fake) as warm_mock:
            _warm_set_cards_in_background()
            # Daemon thread does the work; join via the named thread.
            for t in threading.enumerate():
                if t.name == "set-cards-warm":
                    t.join(timeout=5)
            warm_mock.assert_called_once()
        # Manifest landed.
        manifest = disk_cache.read_set_cards_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None
        self.assertEqual(manifest["sets_warmed"], 4)
        self.assertEqual(manifest["sets_failed"], ["x"])


if __name__ == "__main__":
    unittest.main()
