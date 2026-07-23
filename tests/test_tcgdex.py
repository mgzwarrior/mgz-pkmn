from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.parser import CardQuery
from mgz_pkmn.sources.tcgdex import _normalize_tcgdex, search_tcgdex


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


class _StubTCGDexClient:
    def __init__(self, cards: list[dict]) -> None:
        self.cards = cards

    def search(self, name: str, lang: str = "en", limit: int = 8) -> list[dict]:
        return list(self.cards)


class SearchTcgdexCandidatesTests(unittest.TestCase):
    """An ambiguous name-only query should expose the full candidate pool
    (#948) instead of silently committing to the highest-scoring printing."""

    def test_multiple_name_matches_populate_candidates(self) -> None:
        cards = [
            {
                "id": "swsh3-25",
                "name": "Charizard",
                "number": "25",
                "set": {"name": "Darkness Ablaze"},
            },
            {"id": "base1-4", "name": "Charizard", "number": "4", "set": {"name": "Base Set"}},
        ]
        client = _StubTCGDexClient(cards)
        q = CardQuery(raw="Charizard", name="Charizard")

        result = search_tcgdex(client, q, "en")

        self.assertEqual(result.reason, "matched")
        self.assertIsNotNone(result.candidates)
        assert result.candidates is not None
        self.assertEqual(len(result.candidates), 2)

    def test_unambiguous_match_leaves_candidates_none(self) -> None:
        client = _StubTCGDexClient(
            [{"id": "base1-58", "name": "Pikachu", "number": "58", "set": {"name": "Base Set"}}]
        )
        q = CardQuery(raw="Pikachu", name="Pikachu")

        result = search_tcgdex(client, q, "en")

        self.assertEqual(result.reason, "matched")
        self.assertIsNone(result.candidates)

    def test_set_hint_narrowed_ambiguity_still_populates_candidates(self) -> None:
        cards = [
            {"id": "base1-4", "name": "Charizard", "number": "4", "set": {"name": "Base Set"}},
            {"id": "base1-4h", "name": "Charizard", "number": "4", "set": {"name": "Base Set"}},
        ]
        client = _StubTCGDexClient(cards)
        q = CardQuery(raw="Charizard | Base Set", name="Charizard", set_hint="Base Set")

        result = search_tcgdex(client, q, "en")

        self.assertEqual(result.reason, "matched")
        self.assertIsNotNone(result.candidates)
        assert result.candidates is not None
        self.assertEqual(len(result.candidates), 2)


if __name__ == "__main__":
    unittest.main()
