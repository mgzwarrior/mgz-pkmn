"""Tests for `pkmn cache warm-concepts` — the concept-keyword warming pass."""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.lookup import (
    WARM_SOURCES,
    iter_concept_names,
    warm_concepts,
)


class _CountingTCGClient:
    """Stub `TCGClient` that always returns the same card for any name query.

    Records each Lucene query string it sees so a test can verify call
    counts after a warm pass."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def search_all(self, query: str, **_: object) -> list[dict]:
        self.queries.append(query)
        # Return a single plausible card — search_pokemontcg's scorer needs
        # name + set so the result counts as "found".
        return [
            {
                "id": "card-1",
                "name": "Charizard",
                "number": "4",
                "set": {"name": "Base Set", "series": "Base"},
                "subtypes": [],
                "rarity": "Rare Holo",
            }
        ]

    def search(self, query: str, **kwargs: object) -> list[dict]:
        return self.search_all(query, **kwargs)


class _EmptyTCGClient:
    """Stub `TCGClient` that always misses."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def search_all(self, query: str, **_: object) -> list[dict]:
        self.queries.append(query)
        return []

    def search(self, query: str, **kwargs: object) -> list[dict]:
        return self.search_all(query, **kwargs)


class _CountingTCGDexClient:
    """Stub `TCGDexClient` that returns a usable card for every name."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []  # (name, lang)

    def search(self, name: str, *, lang: str = "en", **_: object) -> list[dict]:
        self.calls.append((name, lang))
        return [
            {
                "id": "tcgdex-1",
                "name": name,
                "number": "1",
                "set": {"name": "Base", "series": "Base"},
            }
        ]


class _EmptyTCGDexClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def search(self, name: str, *, lang: str = "en", **_: object) -> list[dict]:
        self.calls.append((name, lang))
        return []


# ---------------------------------------------------------------------------
# iter_concept_names — pure helper, no external state.
# ---------------------------------------------------------------------------


class IterConceptNamesTests(unittest.TestCase):
    def test_returns_distinct_names(self) -> None:
        names = iter_concept_names()
        # Duplicates across concepts (Riolu in both `puppy` and `baby`) must
        # only appear once.
        self.assertEqual(len(names), len(set(names)))

    def test_includes_known_concept_members(self) -> None:
        names = iter_concept_names()
        # Spot-check a handful of names that should be present.
        self.assertIn("Charmander", names)
        self.assertIn("Eevee", names)
        self.assertIn("Riolu", names)  # appears in both `puppy` and `baby`

    def test_strips_whitespace_and_drops_empties(self) -> None:
        # The real dictionary doesn't ship empty entries, but the helper is
        # responsible for staying robust if a future edit introduces them.
        self.assertNotIn("", iter_concept_names())
        self.assertTrue(all(n == n.strip() for n in iter_concept_names()))

    def test_concept_keywords_total_is_modest(self) -> None:
        # Bounds-check: the warming pass is sized around "<200 distinct
        # names" per the issue. If this grows past 500 we should revisit
        # whether warm-on-startup still makes sense.
        self.assertLess(len(iter_concept_names()), 500)


# ---------------------------------------------------------------------------
# warm_concepts — call-count + source-filter semantics.
# ---------------------------------------------------------------------------


class WarmConceptsTests(unittest.TestCase):
    def test_rejects_unknown_source(self) -> None:
        pkmn = _CountingTCGClient()
        tcgdex = _CountingTCGDexClient()
        with self.assertRaises(ValueError):
            warm_concepts(pkmn, tcgdex, source="nope")

    def test_walks_every_distinct_name_via_pokemontcg(self) -> None:
        pkmn = _CountingTCGClient()
        tcgdex = _CountingTCGDexClient()
        result = warm_concepts(pkmn, tcgdex, source="pokemontcg")
        expected = len(iter_concept_names())
        self.assertEqual(result.names_attempted, expected)
        self.assertEqual(result.names_warmed, expected)
        self.assertEqual(result.names_failed, [])
        # Exactly one query per distinct name — `warm_concepts` calls
        # `pkmn.search_all(name_clause(name))` directly to mirror
        # `find_top_cards`' unconstrained query shape (so cache keys line up).
        self.assertEqual(len(pkmn.queries), expected)
        # Every query is a `name:"..."` clause (no set/series fallbacks).
        self.assertTrue(all(q.startswith("name:") for q in pkmn.queries))
        # TCGdex was not touched in source="pokemontcg" mode.
        self.assertEqual(tcgdex.calls, [])

    def test_source_tcgdex_skips_pokemontcg(self) -> None:
        pkmn = _CountingTCGClient()
        tcgdex = _CountingTCGDexClient()
        result = warm_concepts(pkmn, tcgdex, source="tcgdex")
        self.assertEqual(result.names_warmed, result.names_attempted)
        # pokemontcg.io was bypassed entirely.
        self.assertEqual(pkmn.queries, [])
        # TCGdex was queried once per name (in English).
        self.assertEqual(len(tcgdex.calls), len(iter_concept_names()))
        self.assertTrue(all(lang == "en" for _, lang in tcgdex.calls))

    def test_source_all_falls_through_to_tcgdex_on_miss(self) -> None:
        pkmn = _EmptyTCGClient()
        tcgdex = _CountingTCGDexClient()
        result = warm_concepts(pkmn, tcgdex, source="all")
        # pokemontcg.io missed every name → TCGdex picked them all up.
        self.assertEqual(result.names_warmed, result.names_attempted)
        self.assertEqual(result.names_failed, [])
        # Both sources were called for every name.
        self.assertGreater(len(pkmn.queries), 0)
        self.assertEqual(len(tcgdex.calls), len(iter_concept_names()))

    def test_records_failures_when_every_source_misses(self) -> None:
        pkmn = _EmptyTCGClient()
        tcgdex = _EmptyTCGDexClient()
        result = warm_concepts(pkmn, tcgdex, source="all")
        self.assertEqual(result.names_warmed, 0)
        # Every distinct name is in names_failed.
        self.assertEqual(sorted(result.names_failed), sorted(iter_concept_names()))

    def test_progress_callback_invoked_once_per_name(self) -> None:
        pkmn = _CountingTCGClient()
        tcgdex = _CountingTCGDexClient()
        events: list[tuple[int, int, str]] = []
        warm_concepts(
            pkmn,
            tcgdex,
            source="pokemontcg",
            on_progress=lambda i, total, n: events.append((i, total, n)),
        )
        # One event per name, with monotonically-increasing index.
        self.assertEqual(len(events), len(iter_concept_names()))
        indices = [e[0] for e in events]
        self.assertEqual(indices, sorted(indices))
        # `total` is constant across the run.
        totals = {e[1] for e in events}
        self.assertEqual(totals, {len(iter_concept_names())})


# ---------------------------------------------------------------------------
# Concept-warm manifest — write/read/freshness/stats.
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


class ConceptWarmManifestTests(_IsolatedCacheMixin):
    def test_read_returns_none_when_absent(self) -> None:
        self.assertIsNone(disk_cache.read_concept_warm())

    def test_write_then_read_roundtrip(self) -> None:
        disk_cache.write_concept_warm(
            names_warmed=42,
            names_failed=["Mew Jr."],
            source="all",
        )
        data = disk_cache.read_concept_warm()
        self.assertIsNotNone(data)
        assert data is not None  # narrow for mypy/pyright
        self.assertEqual(data["names_warmed"], 42)
        self.assertEqual(data["names_failed"], ["Mew Jr."])
        self.assertEqual(data["source"], "all")
        self.assertIsInstance(data["timestamp"], float)

    def test_read_rejects_malformed_payload(self) -> None:
        # Write a malformed manifest directly.
        path = disk_cache._concept_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json", encoding="utf-8")
        self.assertIsNone(disk_cache.read_concept_warm())

    def test_read_rejects_unknown_schema_version(self) -> None:
        path = disk_cache._concept_warm_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            '{"version": 99, "timestamp": 0.0, "names_warmed": 0, "names_failed": [], "source": "all"}',
            encoding="utf-8",
        )
        self.assertIsNone(disk_cache.read_concept_warm())


class ConceptWarmFreshnessTests(_IsolatedCacheMixin):
    def test_no_manifest_is_not_fresh(self) -> None:
        self.assertFalse(disk_cache.concept_warm_is_fresh())

    def test_fresh_within_window(self) -> None:
        disk_cache.write_concept_warm(names_warmed=10, names_failed=[], source="all")
        # Default window is 24 h — a freshly-written manifest must pass.
        self.assertTrue(disk_cache.concept_warm_is_fresh())

    def test_stale_outside_window(self) -> None:
        disk_cache.write_concept_warm(names_warmed=10, names_failed=[], source="all")
        # Pretend we're checking 25 h in the future.
        future = time.time() + (25 * 60 * 60)
        self.assertFalse(disk_cache.concept_warm_is_fresh(now=future))

    def test_zero_warmed_manifest_is_not_fresh(self) -> None:
        # A warm pass that managed to write a manifest but didn't actually
        # warm anything (every upstream call failed) must NOT count as
        # fresh — otherwise a transient outage would suppress the startup
        # retry for a full 24 h while the cache stayed cold.
        disk_cache.write_concept_warm(
            names_warmed=0, names_failed=["Charmander", "Eevee"], source="all"
        )
        self.assertFalse(disk_cache.concept_warm_is_fresh())


class StatsIncludesConceptWarmTests(_IsolatedCacheMixin):
    def test_stats_returns_none_timestamp_when_no_manifest(self) -> None:
        s = disk_cache.stats()
        self.assertIsNone(s.concept_warm_timestamp)
        self.assertEqual(s.concept_warm_names, 0)

    def test_stats_reflects_manifest(self) -> None:
        disk_cache.write_concept_warm(names_warmed=37, names_failed=[], source="all")
        s = disk_cache.stats()
        self.assertIsNotNone(s.concept_warm_timestamp)
        self.assertEqual(s.concept_warm_names, 37)


# ---------------------------------------------------------------------------
# Sanity-check the public source-filter constant.
# ---------------------------------------------------------------------------


class WarmSourcesConstantTests(unittest.TestCase):
    def test_warm_sources_contains_the_three_known_options(self) -> None:
        self.assertEqual(set(WARM_SOURCES), {"pokemontcg", "tcgdex", "all"})


# ---------------------------------------------------------------------------
# CLI — `pkmn cache warm-concepts` end-to-end via Click's CliRunner.
# These cover the user-facing branches (verbose progress, source filter,
# upstream failure, empty-dictionary error, post-run manifest persistence)
# that the pure-function tests above leave uncovered.
# ---------------------------------------------------------------------------


class CacheWarmConceptsCLITests(_IsolatedCacheMixin):
    def _invoke(self, *args: str):  # type: ignore[no-untyped-def]
        from click.testing import CliRunner

        from mgz_pkmn.cli import cli

        return CliRunner().invoke(cli, ["cache", "warm-concepts", *args])

    def _stub_warm(
        self,
        *,
        attempted: int | None = None,
        warmed: int | None = None,
        failed: list[str] | None = None,
    ):
        """Return a fake `warm_concepts` that records its kwargs and returns
        a synthetic WarmConceptsResult. Patched in for each test so the CLI
        runs without making real network calls."""
        from mgz_pkmn.lookup import WarmConceptsResult

        calls: dict[str, object] = {}

        def _fake(pkmn, tcgdex, *, source="all", on_progress=None):  # type: ignore[no-untyped-def]
            calls["source"] = source
            calls["on_progress"] = on_progress
            total = attempted if attempted is not None else 3
            # Fire the progress callback if one was supplied so the verbose
            # branch's output is exercised.
            if on_progress is not None:
                for i, name in enumerate(["Mew", "Eevee", "Pikachu"][:total], start=1):
                    on_progress(i, total, name)
            return WarmConceptsResult(
                names_attempted=total,
                names_warmed=warmed if warmed is not None else total,
                names_failed=failed or [],
            )

        return _fake, calls

    def test_happy_path_writes_manifest_and_prints_summary(self) -> None:
        from unittest.mock import patch as _patch

        fake, calls = self._stub_warm(attempted=5, warmed=5)
        with _patch("mgz_pkmn.cli.warm_concepts", side_effect=fake):
            result = self._invoke()

        self.assertEqual(result.exit_code, 0, result.output)
        # Section heading + summary line both appear.
        self.assertIn("Warming concept cache", result.output)
        self.assertIn("5 names", result.output)
        self.assertIn("5 warmed", result.output)
        # Default --source is 'all'.
        self.assertEqual(calls["source"], "all")
        # Manifest persisted to disk.
        manifest = disk_cache.read_concept_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None
        self.assertEqual(manifest["names_warmed"], 5)
        self.assertEqual(manifest["source"], "all")

    def test_source_flag_passes_through_to_warm_concepts(self) -> None:
        from unittest.mock import patch as _patch

        fake, calls = self._stub_warm()
        with _patch("mgz_pkmn.cli.warm_concepts", side_effect=fake):
            result = self._invoke("--source", "pokemontcg")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(calls["source"], "pokemontcg")
        # The manifest records the source the operator chose.
        manifest = disk_cache.read_concept_warm()
        assert manifest is not None
        self.assertEqual(manifest["source"], "pokemontcg")

    def test_verbose_progress_lands_in_output(self) -> None:
        from unittest.mock import patch as _patch

        fake, _calls = self._stub_warm(attempted=3, warmed=3)
        with _patch("mgz_pkmn.cli.warm_concepts", side_effect=fake):
            result = self._invoke("-v")
        self.assertEqual(result.exit_code, 0, result.output)
        # Each [i/total] line plus its name renders to the stream.
        self.assertIn("[1/3]", result.output)
        self.assertIn("[3/3]", result.output)
        self.assertIn("Pikachu", result.output)

    def test_verbose_lists_missed_names(self) -> None:
        from unittest.mock import patch as _patch

        fake, _calls = self._stub_warm(attempted=3, warmed=2, failed=["Eevee"])
        with _patch("mgz_pkmn.cli.warm_concepts", side_effect=fake):
            result = self._invoke("-v")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("1 missed", result.output)
        # The verbose branch also prints the literal failed names.
        self.assertIn("missed: ", result.output)
        self.assertIn("Eevee", result.output)

    def test_upstream_request_failure_surfaces_as_click_exception(self) -> None:
        from unittest.mock import patch as _patch

        import requests as _requests

        with _patch(
            "mgz_pkmn.cli.warm_concepts",
            side_effect=_requests.ConnectionError("network down"),
        ):
            result = self._invoke()

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("concept warm failed", result.output)
        self.assertIn("network down", result.output)
        # No manifest should land when the warm pass aborted.
        self.assertIsNone(disk_cache.read_concept_warm())

    def test_empty_dictionary_raises_click_exception(self) -> None:
        from unittest.mock import patch as _patch

        fake, _calls = self._stub_warm(attempted=0, warmed=0)
        with _patch("mgz_pkmn.cli.warm_concepts", side_effect=fake):
            result = self._invoke()
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("_CONCEPT_KEYWORDS produced no names", result.output)


class CacheStatsConceptLineTests(_IsolatedCacheMixin):
    """Cover the two branches of the `pkmn cache stats` Concepts line:
    "not warmed" (no manifest) vs. "N names · warmed <age>" (manifest present).
    The pure-function stats() coverage is in StatsIncludesConceptWarmTests
    above; this exercises the CLI's rendering specifically."""

    def _invoke(self):  # type: ignore[no-untyped-def]
        from click.testing import CliRunner

        from mgz_pkmn.cli import cli

        return CliRunner().invoke(cli, ["cache", "stats"])

    def test_renders_not_warmed_when_no_manifest(self) -> None:
        result = self._invoke()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("not warmed", result.output)
        self.assertIn("warm-concepts", result.output)

    def test_renders_warmed_age_when_manifest_present(self) -> None:
        disk_cache.write_concept_warm(names_warmed=42, names_failed=[], source="all")
        result = self._invoke()
        self.assertEqual(result.exit_code, 0, result.output)
        # Branch covered: includes the count + "warmed" with a relative age.
        self.assertIn("42 names", result.output)
        self.assertIn("warmed", result.output)
        # "not warmed" text from this slice's branch must NOT appear here.
        # We scope the negative assertion to the Concepts line so a sibling
        # slice (e.g. the Set cards line, which renders "not warmed" when
        # its own manifest is missing) doesn't break this test.
        concepts_line = next(
            (line for line in result.output.splitlines() if "Concepts:" in line),
            "",
        )
        self.assertNotIn("not warmed", concepts_line)


# ---------------------------------------------------------------------------
# API startup hook — `_warm_concepts_in_background` short-circuits when the
# manifest is fresh, otherwise spawns a daemon thread that runs the warm
# pass and writes the manifest. We test both branches without involving
# the real FastAPI app or real HTTP.
# ---------------------------------------------------------------------------


class WarmConceptsBackgroundHookTests(_IsolatedCacheMixin):
    def test_skips_when_cache_is_fresh(self) -> None:
        from unittest.mock import patch as _patch

        from api.main import _warm_concepts_in_background

        # Plant a fresh manifest so the freshness gate short-circuits.
        disk_cache.write_concept_warm(names_warmed=10, names_failed=[], source="all")
        with _patch("api.main.warm_concepts") as warm_mock:
            _warm_concepts_in_background()
            # The freshness short-circuit must keep us out of the thread path.
            warm_mock.assert_not_called()

    def test_runs_warm_and_persists_manifest_when_stale(self) -> None:
        import threading
        from unittest.mock import patch as _patch

        from api.main import _warm_concepts_in_background
        from mgz_pkmn.lookup import WarmConceptsResult

        # No prior manifest → the gate returns False and we expect a real
        # background run. We mock warm_concepts itself so no HTTP fires, then
        # block until the daemon thread completes.
        done = threading.Event()

        def _fake_warm(pkmn, tcgdex, *, source="all"):
            try:
                return WarmConceptsResult(names_attempted=4, names_warmed=4, names_failed=[])
            finally:
                done.set()

        with (
            _patch("api.main.warm_concepts", side_effect=_fake_warm),
            _patch("api.main.TCGClient"),
            _patch("api.main.TCGDexClient"),
        ):
            _warm_concepts_in_background()
            self.assertTrue(done.wait(timeout=5.0), "background thread did not finish")
            # Give the writer a tick to land the manifest after warm returns.
            for _ in range(50):
                if disk_cache.read_concept_warm() is not None:
                    break
                time.sleep(0.02)

        manifest = disk_cache.read_concept_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None
        self.assertEqual(manifest["names_warmed"], 4)

    def test_swallows_exceptions_so_service_keeps_running(self) -> None:
        import threading
        from unittest.mock import patch as _patch

        from api.main import _warm_concepts_in_background

        done = threading.Event()

        def _boom(*_args, **_kwargs):
            try:
                raise RuntimeError("upstream down")
            finally:
                done.set()

        # Even when warm_concepts raises, the hook must not propagate (the
        # daemon thread should log + swallow). No manifest is written.
        with (
            _patch("api.main.warm_concepts", side_effect=_boom),
            _patch("api.main.TCGClient"),
            _patch("api.main.TCGDexClient"),
        ):
            _warm_concepts_in_background()  # must return without raising
            self.assertTrue(done.wait(timeout=5.0))

        self.assertIsNone(disk_cache.read_concept_warm())


# ---------------------------------------------------------------------------
# Cache edges — covers the few remaining lines codecov flagged in cache.py:
# write_concept_warm's OSError suppression and behaviour under
# MGZ_PKMN_NO_CACHE=1 (the manifest is meant to be honoured anyway, per the
# stats-is-real-state contract).
# ---------------------------------------------------------------------------


class ConceptWarmManifestEdgeCasesTests(_IsolatedCacheMixin):
    def test_write_swallows_oserror(self) -> None:
        from unittest.mock import patch as _patch

        # Force the underlying file write to raise; the helper must absorb
        # it silently so a read-only filesystem doesn't crash a successful
        # warm run.
        with _patch("pathlib.Path.write_text", side_effect=OSError("disk full")):
            disk_cache.write_concept_warm(names_warmed=1, names_failed=[], source="all")
        # Nothing landed on disk, but the call returned normally.
        self.assertIsNone(disk_cache.read_concept_warm())

    def test_manifest_honoured_when_no_cache_env_is_set(self) -> None:
        # Operators reading `pkmn cache stats` want real on-disk state even
        # when MGZ_PKMN_NO_CACHE=1 is set for the current run. The manifest
        # helpers must not short-circuit on that env var.
        disk_cache.write_concept_warm(names_warmed=7, names_failed=[], source="all")
        try:
            os.environ[disk_cache._NO_CACHE_ENV] = "1"
            data = disk_cache.read_concept_warm()
            self.assertIsNotNone(data)
            assert data is not None
            self.assertEqual(data["names_warmed"], 7)
            self.assertTrue(disk_cache.concept_warm_is_fresh())
            s = disk_cache.stats()
            self.assertEqual(s.concept_warm_names, 7)
        finally:
            # _IsolatedCacheMixin.tearDown restores the env var to its
            # original state; this is just defensive in case the test
            # body raises mid-way.
            os.environ.pop(disk_cache._NO_CACHE_ENV, None)


if __name__ == "__main__":
    unittest.main()
