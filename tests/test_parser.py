from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.parser import DEFAULT_BULK_TOP, parse_line


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
        self.assertEqual(
            q.url_hint, "https://www.pricecharting.com/game/pokemon-base-set/charizard-4"
        )
        self.assertEqual(q.name, "Charizard")


class BulkDetectionTests(unittest.TestCase):
    """Cover the bulk-line detection paths in `_try_bulk` (parser.py).

    These lock in the contract for `top:N`, `top N`, and `All …` prefixes —
    including the cases the recent ReDoS-hardening patches changed (suffix
    handling moved from regex to str.rsplit + frozenset)."""

    # --- "top:N <subject>" / "top N <subject>" ---

    def test_top_colon_form(self) -> None:
        q = parse_line("top:5 Charizard")
        assert q is not None
        self.assertEqual(q.bulk_top, 5)
        self.assertEqual(q.name, "Charizard")

    def test_top_space_form(self) -> None:
        q = parse_line("top 3 Pikachu")
        assert q is not None
        self.assertEqual(q.bulk_top, 3)
        self.assertEqual(q.name, "Pikachu")

    def test_top_with_optional_cards_suffix(self) -> None:
        q = parse_line("top 10 Charizard cards")
        assert q is not None
        self.assertEqual(q.bulk_top, 10)
        self.assertEqual(q.name, "Charizard")

    def test_top_with_alt_prints_suffix(self) -> None:
        q = parse_line("top 4 Charizard prints")
        assert q is not None
        self.assertEqual(q.bulk_top, 4)
        self.assertEqual(q.name, "Charizard")

    def test_top_with_alt_versions_suffix(self) -> None:
        q = parse_line("top 4 Charizard versions")
        assert q is not None
        self.assertEqual(q.bulk_top, 4)
        self.assertEqual(q.name, "Charizard")

    def test_top_preserves_pipe_set_hint(self) -> None:
        q = parse_line("top:5 Charizard | Hidden Fates")
        assert q is not None
        self.assertEqual(q.bulk_top, 5)
        self.assertEqual(q.name, "Charizard")
        self.assertEqual(q.set_hint, "Hidden Fates")

    def test_top_without_subject_is_not_bulk(self) -> None:
        # "top:5" with no subject should fall through to the non-bulk path
        # rather than emit an empty bulk query.
        q = parse_line("top:5")
        if q is not None:
            self.assertIsNone(q.bulk_top)

    # --- "All <subject> cards|prints|versions" ---

    def test_all_subject_cards_uses_default_top(self) -> None:
        q = parse_line("All Exeggutor cards")
        assert q is not None
        self.assertEqual(q.bulk_top, DEFAULT_BULK_TOP)
        self.assertEqual(q.name, "Exeggutor")

    def test_all_subject_prints(self) -> None:
        q = parse_line("All Exeggutor prints")
        assert q is not None
        self.assertEqual(q.bulk_top, DEFAULT_BULK_TOP)
        self.assertEqual(q.name, "Exeggutor")

    def test_all_with_pipe_set_hint(self) -> None:
        q = parse_line("All Charizard cards | Hidden Fates")
        assert q is not None
        self.assertEqual(q.bulk_top, DEFAULT_BULK_TOP)
        self.assertEqual(q.name, "Charizard")
        self.assertEqual(q.set_hint, "Hidden Fates")

    def test_all_without_suffix_is_not_bulk(self) -> None:
        # The required-suffix rule is what stops "All Charizard" from being
        # mistaken for a bulk request.
        q = parse_line("All Charizard")
        assert q is not None
        self.assertIsNone(q.bulk_top)

    def test_all_energy_removal_is_a_real_card_not_bulk(self) -> None:
        # The motivating regression: "All Energy Removal" is a real card name
        # (Base Set #92) and must never be promoted to a bulk top-N query.
        q = parse_line("All Energy Removal")
        assert q is not None
        self.assertIsNone(q.bulk_top)
        self.assertIn("Energy Removal", q.name)

    def test_all_card_suffix_singular_form(self) -> None:
        # frozenset includes both plural and singular forms.
        q = parse_line("All Mew card")
        assert q is not None
        self.assertEqual(q.bulk_top, DEFAULT_BULK_TOP)
        self.assertEqual(q.name, "Mew")

    # --- ReDoS hardening regression ---

    def test_pathological_whitespace_input_is_fast(self) -> None:
        # Adversarial input that previously caused polynomial backtracking
        # in the suffix regex. Should resolve in well under a second.
        nasty = "top 10 " + (" " * 500) + "Charizard cards"
        start = time.perf_counter()
        q = parse_line(nasty)
        elapsed = time.perf_counter() - start
        assert q is not None
        self.assertEqual(q.bulk_top, 10)
        self.assertLess(elapsed, 0.5, f"parse_line was too slow: {elapsed:.3f}s")


if __name__ == "__main__":
    unittest.main()
