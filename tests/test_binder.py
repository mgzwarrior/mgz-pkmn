from __future__ import annotations

import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.binder import (
    CONDENSED_LAYOUT,
    LANG_LABELS,
    STANDARD_LAYOUT,
    _divider_year,
    _ensure_cjk_fonts,
    _font_for_name,
    write_binder_pdf,
)
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.spreadsheet import Row


def _page_count(pdf_bytes: bytes) -> int:
    """Count ``/Type /Page`` object dicts (excluding ``/Type /Pages``) —
    a lightweight page-count check with no new PDF-parsing dependency."""
    return len(re.findall(rb"/Type\s*/Page[^s]", pdf_bytes))


class CjkFontPickerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # Register the CID Asian fonts once for the whole class. _font_for_name
        # consults the registered set; without this the helper falls through
        # to Helvetica for every input and the tests below can't distinguish
        # "fell back gracefully" from "picked the right font".
        _ensure_cjk_fonts()

    def test_japanese_katakana_picks_cjk_font(self) -> None:
        self.assertEqual(
            _font_for_name("ナッシー[Exeggutor]", "ja", bold=True),
            "HeiseiKakuGo-W5",
        )

    def test_korean_hangul_picks_cjk_font(self) -> None:
        self.assertEqual(_font_for_name("피카츄", "ko", bold=True), "HYSMyeongJo-Medium")

    def test_kanji_only_picks_chinese_font(self) -> None:
        self.assertEqual(_font_for_name("喷火龙", "zh-cn", bold=True), "STSong-Light")

    def test_plain_latin_falls_back_to_helvetica_bold(self) -> None:
        self.assertEqual(_font_for_name("Charizard", "en", bold=True), "Helvetica-Bold")

    def test_regular_weight_falls_back_to_plain_helvetica(self) -> None:
        self.assertEqual(_font_for_name("Charizard", "en", bold=False), "Helvetica")

    def test_script_in_name_overrides_lang_tag(self) -> None:
        # An EN-tagged card carrying katakana (mis-tagged or pre-detection)
        # should still get the Japanese font — glyphs don't lie.
        self.assertEqual(
            _font_for_name("ナッシー[Exeggutor]", "en", bold=True),
            "HeiseiKakuGo-W5",
        )


class LangLabelsTests(unittest.TestCase):
    def test_known_codes_have_full_names(self) -> None:
        self.assertEqual(LANG_LABELS["ja"], "Japanese")
        self.assertEqual(LANG_LABELS["zh-cn"], "Chinese")
        self.assertEqual(LANG_LABELS["zh-tw"], "Chinese")
        self.assertEqual(LANG_LABELS["ko"], "Korean")
        self.assertEqual(LANG_LABELS["fr"], "French")


class LayoutPresetTests(unittest.TestCase):
    def test_standard_is_3x3(self) -> None:
        self.assertEqual(STANDARD_LAYOUT.cols, 3)
        self.assertEqual(STANDARD_LAYOUT.rows_per_page, 3)
        self.assertEqual(STANDARD_LAYOUT.cards_per_page, 9)

    def test_condensed_is_6x4_and_denser(self) -> None:
        self.assertEqual(CONDENSED_LAYOUT.cols, 6)
        self.assertEqual(CONDENSED_LAYOUT.rows_per_page, 4)
        self.assertEqual(CONDENSED_LAYOUT.cards_per_page, 24)
        # Smaller fonts than standard.
        self.assertLess(CONDENSED_LAYOUT.name_font_size, STANDARD_LAYOUT.name_font_size)
        self.assertLess(CONDENSED_LAYOUT.caption_leading, STANDARD_LAYOUT.caption_leading)


def _row(tag: str = "t", market: float | None = 12.5, set_name: str = "Surging Sparks") -> Row:
    card = {
        "id": "x",
        "name": "Pikachu",
        "number": "1",
        "set": {"name": set_name, "printedTotal": 191, "total": 252},
        "_database": "pokemontcg.io",
        "language": "en",
    }
    return Row(
        query=CardQuery(raw="Pikachu", name="Pikachu"),
        card=card,
        pricing=Pricing(market=market, currency="USD"),
        image_path=None,
        tag=tag,
    )


class WriteBinderTests(unittest.TestCase):
    def test_standard_layout_writes_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            write_binder_pdf([_row()], out, layout=STANDARD_LAYOUT)
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)

    def test_condensed_layout_writes_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            write_binder_pdf([_row()], out, layout=CONDENSED_LAYOUT)
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)


class WriteBinderFieldsTests(unittest.TestCase):
    """A #262 field subset must render without crashing and without
    disturbing the fixed caption geometry — see binder.py's `_draw_cell`
    docstring for why a disabled field blanks its line instead of
    reclaiming the space."""

    def test_empty_fields_still_writes_a_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            write_binder_pdf([_row()], out, layout=STANDARD_LAYOUT, fields=frozenset())
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)

    def test_single_field_subset_writes_a_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            write_binder_pdf(
                [_row(market=None)], out, layout=CONDENSED_LAYOUT, fields=frozenset({"name"})
            )
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)

    def test_unpriced_row_with_comps_enabled_writes_a_pdf(self) -> None:
        # Market is None — the comp loop must skip drawing rather than
        # raising on `None * pct`.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            write_binder_pdf(
                [_row(market=None)],
                out,
                layout=STANDARD_LAYOUT,
                fields=frozenset({"market", "comp_80", "comp_95"}),
            )
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)


class DividerYearTests(unittest.TestCase):
    def test_extracts_leading_four_digits(self) -> None:
        self.assertEqual(_divider_year("2024-05-31"), "2024")

    def test_none_for_missing_or_malformed_input(self) -> None:
        self.assertIsNone(_divider_year(None))
        self.assertIsNone(_divider_year(""))
        self.assertIsNone(_divider_year("not-a-date"))


class LeadWithIdCardTests(unittest.TestCase):
    """#788 — a divider cutout leading each section, off by default."""

    def test_off_by_default_leaves_page_count_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            rows = [_row() for _ in range(STANDARD_LAYOUT.cards_per_page)]
            write_binder_pdf(rows, out, layout=STANDARD_LAYOUT)
            self.assertEqual(_page_count(out.read_bytes()), 1)

    def test_reserves_a_cell_and_pushes_a_full_page_to_a_second_page(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            # Exactly a full page's worth of cards — the divider taking slot 0
            # means the last card no longer fits, so a second page is needed.
            rows = [_row() for _ in range(STANDARD_LAYOUT.cards_per_page)]
            write_binder_pdf(rows, out, layout=STANDARD_LAYOUT, lead_with_id_card=True)
            self.assertEqual(_page_count(out.read_bytes()), 2)

    def test_multiple_small_sections_still_write_one_page_each(self) -> None:
        # Two single-card sections — each well under capacity even with a
        # divider taking a slot, so adding one shouldn't force extra pages.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            rows = [_row(tag="Set A"), _row(tag="Set B")]
            write_binder_pdf(rows, out, layout=STANDARD_LAYOUT, lead_with_id_card=True)
            self.assertEqual(_page_count(out.read_bytes()), 2)

    def test_empty_rows_write_without_a_stray_divider_page(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            write_binder_pdf([], out, layout=STANDARD_LAYOUT, lead_with_id_card=True)
            self.assertTrue(out.exists())

    def test_labels_every_set_in_a_mixed_tag_section(self) -> None:
        # One tag ('t') spanning two sets, 4 cards apiece — a plain lookup
        # list or collection-detail export isn't guaranteed to be one set
        # per tag. A single divider for the whole section (the pre-fix
        # behavior) would fit 1 divider + 8 cards in 9 slots — one page.
        # Labelling both sets takes 2 dividers + 8 cards = 10 slots, which
        # spills onto a second page.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "binder.pdf"
            rows = [_row(set_name="Set A") for _ in range(4)] + [
                _row(set_name="Set B") for _ in range(4)
            ]
            write_binder_pdf(rows, out, layout=STANDARD_LAYOUT, lead_with_id_card=True)
            self.assertEqual(_page_count(out.read_bytes()), 2)


if __name__ == "__main__":
    unittest.main()
