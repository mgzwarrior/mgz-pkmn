from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.binder import (
    LANG_LABELS,
    _ensure_cjk_fonts,
    _font_for_name,
)


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


if __name__ == "__main__":
    unittest.main()
