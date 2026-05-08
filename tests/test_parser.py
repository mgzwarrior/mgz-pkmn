from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.parser import parse_line


class ParseLineTests(unittest.TestCase):
    def test_bulk_top_with_inline_max(self) -> None:
        q = parse_line("top 10 Surging Sparks cards <= $50")
        assert q is not None
        self.assertEqual(q.bulk_top, 10)
        self.assertEqual(q.name, "Surging Sparks")
        self.assertEqual(q.price_max, 50.0)
        self.assertIsNone(q.price_min)

    def test_structured_single_card_keeps_price_bounds(self) -> None:
        q = parse_line("Charizard | Base | 4/102 >= $100")
        assert q is not None
        self.assertIsNone(q.bulk_top)
        self.assertEqual(q.name, "Charizard")
        self.assertEqual(q.set_hint, "Base")
        self.assertEqual(q.number, "4/102")
        self.assertEqual(q.price_min, 100.0)

    def test_url_only_line_extracts_name_hint(self) -> None:
        q = parse_line("https://www.pricecharting.com/game/pokemon-base-set/charizard-4")
        assert q is not None
        self.assertEqual(q.url_hint, "https://www.pricecharting.com/game/pokemon-base-set/charizard-4")
        self.assertEqual(q.name, "Charizard")


if __name__ == "__main__":
    unittest.main()
