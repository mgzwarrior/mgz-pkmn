from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.binder import (
    CONDENSED_LAYOUT,
    LANG_LABELS,
    STANDARD_LAYOUT,
    _ensure_cjk_fonts,
    _font_for_name,
    write_binder_pdf,
)
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.spreadsheet import Row


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


def _row(tag: str = "t", market: float | None = 12.5) -> Row:
    card = {
        "id": "x",
        "name": "Pikachu",
        "number": "1",
        "set": {"name": "Surging Sparks", "printedTotal": 191, "total": 252},
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


if __name__ == "__main__":
    unittest.main()
