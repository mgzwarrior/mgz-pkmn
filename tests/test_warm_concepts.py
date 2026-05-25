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
        # pokemontcg.io was queried once per distinct name (search_pokemontcg
        # may issue more than one Lucene query in its fallback chain, so we
        # check ≥, not ==).
        self.assertGreaterEqual(len(pkmn.queries), expected)
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


if __name__ == "__main__":
    unittest.main()
