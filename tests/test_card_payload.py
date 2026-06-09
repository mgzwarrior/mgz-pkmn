"""Tests for `api.db.card_payload` — the promoted-column extractor.

This is the single place that knows how to pull identity + price out of
a pokemontcg.io-shaped card payload. Both the insert routes (write time)
and the Alembic backfill (one-shot pass over existing rows) call into
it, so it has to be conservative: a missing or malformed field defaults
to ``None``, never raises.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.db.card_payload import extract_card_identity, extract_price_snapshot

# A representative pokemontcg.io payload — trimmed to the shape our
# extractor actually inspects. Real payloads carry a lot more (attacks,
# abilities, weaknesses) but those stay in card_json.
FULL_CARD = {
    "id": "swsh1-25",
    "name": "Charizard V",
    "set": {"id": "swsh1", "name": "Sword & Shield"},
    "number": "25",
    "rarity": "Ultra Rare",
    "types": ["Fire"],
    "images": {
        "small": "https://images.pokemontcg.io/swsh1/25.png",
        "large": "https://images.pokemontcg.io/swsh1/25_hires.png",
    },
    "tcgplayer": {
        "prices": {
            "holofoil": {"low": 10.0, "mid": 15.0, "market": 18.5},
            "reverseHolofoil": {"low": 8.0, "market": 12.0},
        }
    },
}


class ExtractCardIdentityTests(unittest.TestCase):
    def test_pulls_every_field_when_present(self) -> None:
        got = extract_card_identity(FULL_CARD)
        self.assertEqual(got["card_set_id"], "swsh1")
        self.assertEqual(got["card_number"], "25")
        self.assertEqual(got["card_name"], "Charizard V")
        self.assertEqual(got["card_rarity"], "Ultra Rare")
        self.assertEqual(got["card_types_json"], ["Fire"])
        self.assertEqual(got["card_image_url"], "https://images.pokemontcg.io/swsh1/25.png")

    def test_falls_back_to_id_when_set_is_missing(self) -> None:
        # Some legacy payloads omit set.id but the canonical card id
        # (``<set_id>-<number>``) is always present.
        card = {"id": "base1-4", "name": "Charizard", "number": "4"}
        got = extract_card_identity(card)
        self.assertEqual(got["card_set_id"], "base1")

    def test_prefers_small_image_over_large(self) -> None:
        # Small wins because it's faster in the grid view.
        got = extract_card_identity(FULL_CARD)
        self.assertEqual(got["card_image_url"], "https://images.pokemontcg.io/swsh1/25.png")

    def test_falls_back_to_large_when_small_missing(self) -> None:
        card = dict(FULL_CARD)
        card["images"] = {"large": "https://example.com/large.png"}
        got = extract_card_identity(card)
        self.assertEqual(got["card_image_url"], "https://example.com/large.png")

    def test_empty_payload_yields_all_nulls(self) -> None:
        got = extract_card_identity({})
        for key in (
            "card_set_id",
            "card_number",
            "card_name",
            "card_rarity",
            "card_types_json",
            "card_image_url",
        ):
            self.assertIsNone(got[key], f"expected {key} to be None")

    def test_none_payload_is_safe(self) -> None:
        # The migration backfill feeds rows whose ``card_json`` may be
        # null on a malformed legacy row; we don't want it to raise.
        got = extract_card_identity(None)
        self.assertIsNone(got["card_set_id"])

    def test_types_coerced_to_strings(self) -> None:
        # Source-side drift could land a non-str element; we drop falsy
        # values and stringify the rest so the JSON column stays clean.
        card = {"types": ["Fire", "", None, 0, "Water"]}
        got = extract_card_identity(card)
        self.assertEqual(got["card_types_json"], ["Fire", "Water"])

    def test_whitespace_trimmed_on_string_fields(self) -> None:
        card = {"id": "base1-4", "name": "  Charizard  ", "number": "4 "}
        got = extract_card_identity(card)
        self.assertEqual(got["card_name"], "Charizard")
        self.assertEqual(got["card_number"], "4")


class ExtractPriceSnapshotTests(unittest.TestCase):
    def test_takes_max_market_across_tcgplayer_variants(self) -> None:
        # Holofoil market is the highest in the fixture; that's the
        # value the chart should track.
        self.assertEqual(extract_price_snapshot(FULL_CARD), 18.5)

    def test_falls_back_to_direct_market_price_field(self) -> None:
        # Our own pipeline sometimes flattens a single ``market_price``
        # for speed. Honor it before tcgplayer.
        card = {"market_price": 42.0, "tcgplayer": {"prices": {}}}
        self.assertEqual(extract_price_snapshot(card), 42.0)

    def test_falls_back_to_cardmarket_average(self) -> None:
        card = {"cardmarket": {"prices": {"averageSellPrice": 7.25}}}
        self.assertEqual(extract_price_snapshot(card), 7.25)

    def test_returns_none_when_no_recognizable_price(self) -> None:
        # Empty payload, all-null prices, and missing-key payloads must
        # never silently emit zero — that would poison value-over-time.
        self.assertIsNone(extract_price_snapshot({}))
        self.assertIsNone(extract_price_snapshot({"tcgplayer": {"prices": {}}}))
        self.assertIsNone(extract_price_snapshot(None))

    def test_ignores_non_positive_market_values(self) -> None:
        # pokemontcg.io occasionally emits 0 for unpriced variants —
        # treat that as "no signal" rather than "$0 card."
        card = {"tcgplayer": {"prices": {"normal": {"market": 0}}}}
        self.assertIsNone(extract_price_snapshot(card))


if __name__ == "__main__":
    unittest.main()
