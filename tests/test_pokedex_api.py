from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


class PokedexRouteTests(unittest.TestCase):
    """`GET /api/v1/pokedex/{number}/cards` — every printing of one species."""

    def test_returns_cards_with_set_context(self) -> None:
        with patch(
            "api.routes.pokedex._fetch_pokedex_cards",
            return_value=[
                {
                    "id": "base1-4",
                    "name": "Charizard",
                    "number": "4",
                    "rarity": "Rare Holo",
                    "supertype": "Pokémon",
                    "subtypes": ["Stage 2"],
                    "thumb": None,
                    "market": 250.0,
                    "setId": "base1",
                    "setName": "Base",
                    "releaseDate": "1999/01/09",
                }
            ],
        ) as fetch_mock:
            resp = client.get("/api/v1/pokedex/6/cards")

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["number"], 6)
        self.assertEqual(len(body["cards"]), 1)
        card = body["cards"][0]
        # The per-card set context that set view leaves implicit.
        for field in ("setId", "setName", "releaseDate"):
            self.assertIn(field, card)
        self.assertEqual(card["setName"], "Base")
        fetch_mock.assert_called_once_with(6, None)

    def test_404_when_species_has_no_printings(self) -> None:
        with patch("api.routes.pokedex._fetch_pokedex_cards", return_value=[]):
            resp = client.get("/api/v1/pokedex/9999/cards")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("9999", resp.json()["detail"])

    def test_browser_cache_control_header(self) -> None:
        with patch(
            "api.routes.pokedex._fetch_pokedex_cards",
            return_value=[
                {
                    "id": "base1-4",
                    "name": "Charizard",
                    "number": "4",
                    "rarity": None,
                    "supertype": None,
                    "subtypes": [],
                    "thumb": None,
                    "market": None,
                    "setId": "base1",
                    "setName": "Base",
                    "releaseDate": "1999/01/09",
                }
            ],
        ):
            resp = client.get("/api/v1/pokedex/6/cards")
        self.assertEqual(resp.status_code, 200)
        cache_control = resp.headers.get("cache-control", "")
        self.assertIn("public", cache_control)
        self.assertIn("max-age=", cache_control)

    def test_rejects_non_integer_and_out_of_range(self) -> None:
        for bad in ("abc", "0", "-3", "999999"):
            with self.subTest(number=bad):
                resp = client.get(f"/api/v1/pokedex/{bad}/cards")
                self.assertEqual(resp.status_code, 422)

    def test_number_and_api_key_passed_through(self) -> None:
        with patch(
            "api.routes.pokedex._fetch_pokedex_cards",
            return_value=[
                {
                    "id": "x",
                    "name": "x",
                    "number": "1",
                    "rarity": None,
                    "supertype": None,
                    "subtypes": [],
                    "thumb": None,
                    "market": None,
                    "setId": "s",
                    "setName": "S",
                    "releaseDate": "2000/01/01",
                }
            ],
        ) as fetch_mock:
            client.get("/api/v1/pokedex/25/cards?api_key=abc")
        fetch_mock.assert_called_once_with(25, "abc")


class PokedexHelperTests(unittest.TestCase):
    def test_fetch_queries_national_dex_filter(self) -> None:
        # The Lucene query keys the disk cache; it MUST stay
        # `nationalPokedexNumbers:<n>` — see api/routes/pokedex.py.
        from api.routes.pokedex import _fetch_pokedex_cards

        captured: list[str] = []

        def _capture(self_, query):
            del self_
            captured.append(query)
            return [], "MISS"

        with patch("mgz_pkmn.sources.pokemontcg.TCGClient.search_all", _capture):
            _fetch_pokedex_cards(6, api_key=None)

        self.assertEqual(captured, ["nationalPokedexNumbers:6"])

    def test_trim_adds_set_context(self) -> None:
        from api.routes.pokedex import _trim_pokedex_card

        slim = _trim_pokedex_card(
            {
                "id": "base1-4",
                "name": "Charizard",
                "number": "4",
                "set": {"id": "base1", "name": "Base", "releaseDate": "1999/01/09"},
            }
        )
        self.assertEqual(slim["setId"], "base1")
        self.assertEqual(slim["setName"], "Base")
        self.assertEqual(slim["releaseDate"], "1999/01/09")
        # Still carries the slim set-card fields.
        self.assertEqual(slim["name"], "Charizard")
        self.assertNotIn("set", slim)

    def test_sorts_release_desc_then_set_then_number(self) -> None:
        # Unsorted upstream → newest set first; ties broken set A→Z, number
        # low→high (the contract the SPA renders verbatim).
        from api.routes.pokedex import _fetch_pokedex_cards

        raw = [
            {
                "id": "a",
                "name": "P",
                "number": "25",
                "set": {"id": "s1", "name": "Alpha", "releaseDate": "2020/01/01"},
            },
            {
                "id": "b",
                "name": "P",
                "number": "4",
                "set": {"id": "s1", "name": "Alpha", "releaseDate": "2020/01/01"},
            },
            {
                "id": "c",
                "name": "P",
                "number": "1",
                "set": {"id": "s2", "name": "Zephyr", "releaseDate": "2024/01/01"},
            },
            {
                "id": "d",
                "name": "P",
                "number": "1",
                "set": {"id": "s3", "name": "Beta", "releaseDate": "2020/01/01"},
            },
        ]

        def _stub(self_, query):
            del self_, query
            return raw, "HIT"

        with patch("mgz_pkmn.sources.pokemontcg.TCGClient.search_all", _stub):
            out = _fetch_pokedex_cards(25, api_key=None)

        # Newest release first (c), then the 2020 sets ordered by set name
        # Alpha (#4 before #25) then Beta.
        self.assertEqual([c["id"] for c in out], ["c", "b", "a", "d"])


if __name__ == "__main__":
    unittest.main()
