from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.sources.card_shows import CardShow, SeedCardShowProvider


class SeedCardShowProviderTests(unittest.TestCase):
    def test_filters_by_radius(self) -> None:
        # 10001 (NYC) and 90001 (LA) are ~2,400mi apart — a 50mi radius from
        # NYC must exclude the LA show.
        provider = SeedCardShowProvider()
        results = provider.shows_near("10001", radius_mi=50)
        self.assertTrue(all(show.zip_code == "10001" for show in results))
        self.assertTrue(any(show.name == "Empire State Card Show" for show in results))
        self.assertFalse(any(show.name == "SoCal Card Expo" for show in results))

    def test_includes_nearby_zip_within_radius(self) -> None:
        # 07030 (Hoboken) has no show of its own but sits ~5mi from 10001 —
        # a wide-enough radius from Hoboken should still surface the NYC show.
        provider = SeedCardShowProvider()
        results = provider.shows_near("07030", radius_mi=25)
        self.assertTrue(any(show.name == "Empire State Card Show" for show in results))

    def test_unknown_zip_returns_empty(self) -> None:
        provider = SeedCardShowProvider()
        self.assertEqual(provider.shows_near("00000", radius_mi=100), [])

    def test_results_sorted_soonest_first(self) -> None:
        shows = (
            CardShow(
                name="Later Show",
                venue="Venue A",
                date=date(2026, 12, 1),
                url="https://example.com/later",
                source="seed",
                zip_code="10001",
            ),
            CardShow(
                name="Sooner Show",
                venue="Venue B",
                date=date(2026, 9, 1),
                url="https://example.com/sooner",
                source="seed",
                zip_code="10001",
            ),
        )
        provider = SeedCardShowProvider(shows=shows)
        results = provider.shows_near("10001", radius_mi=10)
        self.assertEqual([s.name for s in results], ["Sooner Show", "Later Show"])

    def test_radius_zero_excludes_farther_shows_at_same_zip_only_matches_exact(self) -> None:
        provider = SeedCardShowProvider()
        results = provider.shows_near("60601", radius_mi=0)
        self.assertEqual([s.name for s in results], ["Windy City Card Con"])

    def test_excludes_shows_that_have_already_happened(self) -> None:
        # Windy City Card Con is seeded for 2026-10-03 — "today" past that
        # date must drop it instead of surfacing a stale event as upcoming.
        provider = SeedCardShowProvider(today=date(2026, 10, 4))
        results = provider.shows_near("60601", radius_mi=10)
        self.assertEqual(results, [])

    def test_includes_show_happening_today(self) -> None:
        provider = SeedCardShowProvider(today=date(2026, 10, 3))
        results = provider.shows_near("60601", radius_mi=10)
        self.assertEqual([s.name for s in results], ["Windy City Card Con"])


if __name__ == "__main__":
    unittest.main()
