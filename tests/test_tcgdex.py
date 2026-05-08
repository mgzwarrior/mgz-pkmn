from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.sources.tcgdex import _normalize_tcgdex


class NormalizeTcgdexTests(unittest.TestCase):
    def _payload(self) -> dict:
        return {
            "id": "swsh3-25",
            "name": "リザードン",
            "localId": "25",
            "rarity": "Holo Rare",
            "image": "https://assets.tcgdex.net/ja/swsh/swsh3/25",
            "set": {
                "id": "swsh3",
                "name": "Darkness Ablaze",
                "cardCount": {"total": 201, "official": 189},
            },
        }

    def test_japanese_card_has_language_field(self) -> None:
        out = _normalize_tcgdex(self._payload(), "ja")
        self.assertEqual(out["language"], "ja")

    def test_english_card_has_language_field(self) -> None:
        out = _normalize_tcgdex(self._payload(), "en")
        self.assertEqual(out["language"], "en")

    def test_database_string_still_includes_lang(self) -> None:
        # Backward compatibility: spreadsheet "Database" column reads from
        # _database, so the existing format must be preserved.
        out = _normalize_tcgdex(self._payload(), "fr")
        self.assertEqual(out["_database"], "tcgdex (fr)")


if __name__ == "__main__":
    unittest.main()
