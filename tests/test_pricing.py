from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.pricing import Pricing, extract_pricing


class ExtractPricingTests(unittest.TestCase):
    """Characterization tests for `extract_pricing`'s source priority and
    variant resolution, locking the behaviour the per-source resolvers
    preserve (#553)."""

    def test_pricecharting_wins_over_tcgplayer(self) -> None:
        card = {
            "_pc_prices": {"used": 12.5, "new": 20},
            "_pc_url": "https://pc/mew",
            "tcgplayer": {"prices": {"normal": {"market": 99}}, "url": "https://tcg/mew"},
        }
        pricing = extract_pricing(card, None)
        self.assertEqual(pricing.market, 12.5)
        self.assertEqual(pricing.variant, "used")
        self.assertEqual(pricing.source, "pricecharting")
        self.assertEqual(pricing.url, "https://pc/mew")
        self.assertEqual(pricing.currency, "USD")

    def test_pricecharting_label_priority_skips_empty(self) -> None:
        card = {"_pc_prices": {"used": 0, "new": 0, "graded": 30}}
        pricing = extract_pricing(card, None)
        self.assertEqual(pricing.market, 30.0)
        self.assertEqual(pricing.variant, "graded")

    def test_tcgplayer_variant_hint_takes_precedence(self) -> None:
        card = {
            "tcgplayer": {
                "prices": {
                    "holofoil": {"market": 10},
                    "reverseHolofoil": {"market": 5},
                },
                "url": "https://tcg/x",
            }
        }
        pricing = extract_pricing(card, "reverseHolofoil")
        self.assertEqual(pricing.market, 5.0)
        self.assertEqual(pricing.variant, "reverseHolofoil")
        self.assertEqual(pricing.source, "tcgplayer")

    def test_tcgplayer_preference_order_when_no_hint(self) -> None:
        # `holofoil` outranks `normal` in PRICE_VARIANT_PREFERENCE.
        card = {
            "tcgplayer": {
                "prices": {
                    "normal": {"market": 3},
                    "holofoil": {"market": 8},
                }
            }
        }
        pricing = extract_pricing(card, None)
        self.assertEqual(pricing.variant, "holofoil")
        self.assertEqual(pricing.market, 8.0)

    def test_tcgplayer_falls_back_market_then_mid_then_low(self) -> None:
        card = {"tcgplayer": {"prices": {"normal": {"low": 4, "mid": 6}}}}
        pricing = extract_pricing(card, None)
        self.assertEqual(pricing.market, 6.0)  # mid chosen over low

    def test_cardmarket_used_when_tcgplayer_absent(self) -> None:
        card = {
            "cardmarket": {
                "prices": {"trendPrice": 7.25},
                "url": "https://cm/x",
                "_currency": "EUR",
            }
        }
        pricing = extract_pricing(card, None)
        self.assertEqual(pricing.market, 7.25)
        self.assertEqual(pricing.variant, "trendPrice")
        self.assertEqual(pricing.source, "cardmarket")
        self.assertEqual(pricing.url, "https://cm/x")
        self.assertEqual(pricing.currency, "EUR")

    def test_cardmarket_falls_back_to_tcgplayer_url(self) -> None:
        card = {
            "tcgplayer": {"prices": {}, "url": "https://tcg/x"},
            "cardmarket": {"prices": {"avg7": 2.0}},
        }
        pricing = extract_pricing(card, None)
        self.assertEqual(pricing.source, "cardmarket")
        self.assertEqual(pricing.url, "https://tcg/x")

    def test_no_prices_returns_bare_pricing_with_available_url(self) -> None:
        card = {"tcgplayer": {"prices": {}, "url": "https://tcg/x"}, "cardmarket": {}}
        pricing = extract_pricing(card, None)
        self.assertEqual(pricing, Pricing(url="https://tcg/x"))

    def test_empty_card_returns_empty_pricing(self) -> None:
        self.assertEqual(extract_pricing({}, None), Pricing())


if __name__ == "__main__":
    unittest.main()
