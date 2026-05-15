from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import mgz_pkmn
from mgz_pkmn.parser import detect_card_language, parse_line, parse_lines


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

    def test_all_subject_cards_returns_every_match(self) -> None:
        # "All …" means *all* known cards, not a top-N cut. Signaled by
        # bulk_all=True; bulk_top stays None.
        q = parse_line("All Exeggutor cards")
        assert q is not None
        self.assertTrue(q.bulk_all)
        self.assertIsNone(q.bulk_top)
        self.assertEqual(q.name, "Exeggutor")

    def test_all_subject_prints(self) -> None:
        q = parse_line("All Exeggutor prints")
        assert q is not None
        self.assertTrue(q.bulk_all)
        self.assertIsNone(q.bulk_top)
        self.assertEqual(q.name, "Exeggutor")

    def test_all_with_pipe_set_hint(self) -> None:
        q = parse_line("All Charizard cards | Hidden Fates")
        assert q is not None
        self.assertTrue(q.bulk_all)
        self.assertIsNone(q.bulk_top)
        self.assertEqual(q.name, "Charizard")
        self.assertEqual(q.set_hint, "Hidden Fates")

    def test_all_without_suffix_is_not_bulk(self) -> None:
        # The required-suffix rule is what stops "All Charizard" from being
        # mistaken for a bulk request.
        q = parse_line("All Charizard")
        assert q is not None
        self.assertFalse(q.bulk_all)
        self.assertIsNone(q.bulk_top)

    def test_all_energy_removal_is_a_real_card_not_bulk(self) -> None:
        # The motivating regression: "All Energy Removal" is a real card name
        # (Base Set #92) and must never be promoted to a bulk query.
        q = parse_line("All Energy Removal")
        assert q is not None
        self.assertFalse(q.bulk_all)
        self.assertIsNone(q.bulk_top)
        self.assertIn("Energy Removal", q.name)

    def test_all_card_suffix_singular_form(self) -> None:
        # frozenset includes both plural and singular forms.
        q = parse_line("All Mew card")
        assert q is not None
        self.assertTrue(q.bulk_all)
        self.assertIsNone(q.bulk_top)
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


class PriceComparatorTests(unittest.TestCase):
    """`>` / `<` are strict; `>=` / `<=` are inclusive. The parser must
    preserve that distinction so the lookup filter can drop the boundary
    value when the user wrote a strict comparator."""

    def test_inclusive_min(self) -> None:
        q = parse_line("Charizard >= $20")
        assert q is not None
        self.assertEqual(q.price_min, 20.0)
        self.assertFalse(q.price_min_exclusive)

    def test_strict_min(self) -> None:
        q = parse_line("Charizard > $20")
        assert q is not None
        self.assertEqual(q.price_min, 20.0)
        self.assertTrue(q.price_min_exclusive)

    def test_inclusive_max(self) -> None:
        q = parse_line("top 10 Charizard cards <= $50")
        assert q is not None
        self.assertEqual(q.price_max, 50.0)
        self.assertFalse(q.price_max_exclusive)

    def test_strict_max(self) -> None:
        q = parse_line("top 10 Charizard cards < $50")
        assert q is not None
        self.assertEqual(q.price_max, 50.0)
        self.assertTrue(q.price_max_exclusive)

    def test_two_min_bounds_narrow_to_higher_value(self) -> None:
        # `>= 20 > 30` → the strict 30 wins (it's the more restrictive).
        q = parse_line("Charizard >= $20 > $30")
        assert q is not None
        self.assertEqual(q.price_min, 30.0)
        self.assertTrue(q.price_min_exclusive)

    def test_same_value_strict_wins_over_inclusive_min(self) -> None:
        # When both bounds name the same value, the strict one excludes the
        # boundary — strictly stricter, so it wins.
        q = parse_line("Charizard >= $20 > $20")
        assert q is not None
        self.assertEqual(q.price_min, 20.0)
        self.assertTrue(q.price_min_exclusive)

    def test_same_value_strict_wins_over_inclusive_max(self) -> None:
        q = parse_line("top 10 Charizard cards <= $50 < $50")
        assert q is not None
        self.assertEqual(q.price_max, 50.0)
        self.assertTrue(q.price_max_exclusive)

    def test_str_renders_strict_comparators(self) -> None:
        q = parse_line("top 5 Charizard cards > $20 < $50")
        assert q is not None
        rendered = str(q)
        self.assertIn(">$20", rendered)
        self.assertIn("<$50", rendered)
        # Should not have rendered as inclusive.
        self.assertNotIn(">=$20", rendered)
        self.assertNotIn("<=$50", rendered)

    def test_str_renders_inclusive_comparators(self) -> None:
        q = parse_line("top 5 Charizard cards >= $20 <= $50")
        assert q is not None
        rendered = str(q)
        self.assertIn(">=$20", rendered)
        self.assertIn("<=$50", rendered)


class DetectCardLanguageTests(unittest.TestCase):
    def test_japanese_katakana_in_name(self) -> None:
        # The real motivating case: pokemontcg.io card xy12-109 returns
        # 'ナッシー[Exeggutor]' (Japanese name + bracketed English gloss).
        self.assertEqual(detect_card_language("ナッシー[Exeggutor]"), "ja")

    def test_japanese_hiragana_in_name(self) -> None:
        self.assertEqual(detect_card_language("ぴかちゅう"), "ja")

    def test_korean_hangul_in_name(self) -> None:
        self.assertEqual(detect_card_language("피카츄"), "ko")

    def test_kanji_only_name_treated_as_chinese(self) -> None:
        # No kana → most likely Chinese in this database (Japanese cards
        # almost always carry kana somewhere in the name).
        self.assertEqual(detect_card_language("喷火龙"), "zh-cn")

    def test_pricecharting_url_chinese_slug(self) -> None:
        # The motivating PriceCharting case: Calvin's Cubone Chinese SIR.
        url = "https://www.pricecharting.com/game/pokemon-chinese-gem-pack-3/cubone-407"
        self.assertEqual(detect_card_language("Cubone", url=url), "zh-cn")

    def test_set_name_keyword_japanese(self) -> None:
        self.assertEqual(
            detect_card_language("Charizard", set_name="Japanese Promo Set"),
            "ja",
        )

    def test_plain_english_card_defaults_to_en(self) -> None:
        self.assertEqual(detect_card_language("Charizard"), "en")
        self.assertEqual(
            detect_card_language(
                "Charizard",
                set_name="Base Set",
                url="https://pricecharting.com/game/pokemon-base-set/charizard-4",
            ),
            "en",
        )

    def test_url_keyword_loses_to_script_evidence(self) -> None:
        # A katakana name plus a URL slug saying "chinese" should still come
        # back as ja — the script of the actual card name is stronger evidence
        # than a URL token.
        self.assertEqual(
            detect_card_language(
                "ナッシー",
                url="https://www.pricecharting.com/game/pokemon-chinese-gem-pack-3/x",
            ),
            "ja",
        )


class ParseLinesTests(unittest.TestCase):
    """Tests for the public ``parse_lines()`` API covering every supported input form."""

    def test_exported_from_package(self) -> None:
        self.assertIs(mgz_pkmn.parse_lines, parse_lines)
        self.assertIs(
            mgz_pkmn.CardQuery, __import__("mgz_pkmn.parser", fromlist=["CardQuery"]).CardQuery
        )

    def test_empty_string_returns_empty_list(self) -> None:
        self.assertEqual(parse_lines(""), [])

    def test_blank_lines_are_dropped(self) -> None:
        result = parse_lines("\n\n   \n")
        self.assertEqual(result, [])

    def test_comment_lines_are_dropped(self) -> None:
        result = parse_lines("# This is a comment\nCharizard\n# another comment")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "Charizard")

    def test_pipe_delimited_name_set_number(self) -> None:
        result = parse_lines("Charizard | Base Set | 4/102")
        self.assertEqual(len(result), 1)
        q = result[0]
        self.assertEqual(q.name, "Charizard")
        self.assertEqual(q.set_hint, "Base Set")
        self.assertEqual(q.number, "4/102")

    def test_pipe_delimited_name_set(self) -> None:
        result = parse_lines("Pikachu | Base Set")
        self.assertEqual(len(result), 1)
        q = result[0]
        self.assertEqual(q.name, "Pikachu")
        self.assertEqual(q.set_hint, "Base Set")

    def test_positional_name_only(self) -> None:
        result = parse_lines("Mewtwo")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "Mewtwo")

    def test_positional_number_token(self) -> None:
        result = parse_lines("Charizard 4/102")
        self.assertEqual(len(result), 1)
        q = result[0]
        self.assertEqual(q.name, "Charizard")
        self.assertEqual(q.number, "4/102")

    def test_bulk_top_form(self) -> None:
        result = parse_lines("top:5 Charizard cards")
        self.assertEqual(len(result), 1)
        q = result[0]
        self.assertEqual(q.bulk_top, 5)
        self.assertEqual(q.name, "Charizard")

    def test_bulk_all_form(self) -> None:
        result = parse_lines("All Exeggutor cards")
        self.assertEqual(len(result), 1)
        q = result[0]
        self.assertTrue(q.bulk_all)
        self.assertIsNone(q.bulk_top)
        self.assertEqual(q.name, "Exeggutor")

    def test_url_only_line(self) -> None:
        result = parse_lines("https://www.pricecharting.com/game/pokemon-base-set/charizard-4")
        self.assertEqual(len(result), 1)
        self.assertIsNotNone(result[0].url_hint)

    def test_markdown_list_prefix_stripped(self) -> None:
        result = parse_lines("- [ ] Charizard | Base Set")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "Charizard")

    def test_variant_hint_parsed(self) -> None:
        result = parse_lines("Charizard [Holo]")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].variant_hint, "Holo")

    def test_price_condition_parsed(self) -> None:
        result = parse_lines("top 10 Charizard cards >= $20")
        self.assertEqual(len(result), 1)
        q = result[0]
        self.assertEqual(q.price_min, 20.0)
        self.assertFalse(q.price_min_exclusive)

    def test_multiple_cards_returned_in_order(self) -> None:
        text = "Charizard | Base Set\nPikachu\ntop:3 Mewtwo cards"
        result = parse_lines(text)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0].name, "Charizard")
        self.assertEqual(result[1].name, "Pikachu")
        self.assertEqual(result[2].name, "Mewtwo")
        self.assertEqual(result[2].bulk_top, 3)

    def test_mixed_blanks_and_comments_between_cards(self) -> None:
        text = "# Header\n\nCharizard | Base Set\n   \n# comment\nPikachu\n"
        result = parse_lines(text)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].name, "Charizard")
        self.assertEqual(result[1].name, "Pikachu")


if __name__ == "__main__":
    unittest.main()
