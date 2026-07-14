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

_MARNIE = {
    "id": "swsh1-169",
    "name": "Marnie",
    "number": "169",
    "rarity": "Rare Ultra",
    "supertype": "Trainer",
    "subtypes": ["Supporter"],
    "thumb": None,
    "market": 40.0,
    "dexNumbers": [],
    "setId": "swsh1",
    "setName": "Sword & Shield",
    "releaseDate": "2020/02/07",
}


class ClassesRouteTests(unittest.TestCase):
    """`GET /api/v1/classes/{class_id}/cards` — every card in one class (#911)."""

    def test_returns_cards_with_set_context(self) -> None:
        with patch(
            "api.routes.classes._fetch_class_cards", return_value=([_MARNIE], "HIT")
        ) as fetch_mock:
            resp = client.get("/api/v1/classes/supporter/cards")

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["classId"], "supporter")
        self.assertEqual(len(body["cards"]), 1)
        card = body["cards"][0]
        # The per-card set context the cross-set grid renders.
        for field in ("setId", "setName", "releaseDate"):
            self.assertIn(field, card)
        self.assertEqual(card["setName"], "Sword & Shield")
        fetch_mock.assert_called_once_with("supporter", None, cache_only=False)

    def test_404_for_unknown_class(self) -> None:
        resp = client.get("/api/v1/classes/holo-bird/cards")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("holo-bird", resp.json()["detail"])

    def test_404_when_class_has_no_cards(self) -> None:
        with patch("api.routes.classes._fetch_class_cards", return_value=([], "MISS")):
            resp = client.get("/api/v1/classes/radiant/cards")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("radiant", resp.json()["detail"])

    def test_browser_cache_control_header(self) -> None:
        with patch("api.routes.classes._fetch_class_cards", return_value=([_MARNIE], "HIT")):
            resp = client.get("/api/v1/classes/supporter/cards")
        self.assertEqual(resp.status_code, 200)
        cache_control = resp.headers.get("cache-control", "")
        self.assertIn("public", cache_control)
        self.assertIn("max-age=", cache_control)

    def test_api_key_passed_through(self) -> None:
        with patch(
            "api.routes.classes._fetch_class_cards", return_value=([_MARNIE], "HIT")
        ) as fetch_mock:
            client.get("/api/v1/classes/item/cards?api_key=abc")
        fetch_mock.assert_called_once_with("item", "abc", cache_only=False)

    def test_cache_only_empty_returns_200_not_404(self) -> None:
        # `MGZ_PKMN_CACHE_ONLY` + cold cache must not 404 (or reach upstream) —
        # mirror `/sets/{id}/cards` and return an empty 200 the SPA renders as
        # an empty state, tagged `X-Cache: MISS-CACHE-ONLY` and un-browser-cached.
        with patch("api.routes.classes._fetch_class_cards", return_value=([], "MISS-CACHE-ONLY")):
            resp = client.get("/api/v1/classes/supporter/cards")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"classId": "supporter", "cards": []})
        self.assertEqual(resp.headers.get("x-cache"), "MISS-CACHE-ONLY")
        self.assertNotIn("cache-control", resp.headers)

    def test_cache_only_mode_passed_through(self) -> None:
        with (
            patch("api.routes.classes.cache_only_enabled", return_value=True),
            patch(
                "api.routes.classes._fetch_class_cards", return_value=([_MARNIE], "HIT")
            ) as fetch_mock,
        ):
            client.get("/api/v1/classes/supporter/cards")
        fetch_mock.assert_called_once_with("supporter", None, cache_only=True)


class ClassesHelperTests(unittest.TestCase):
    def test_fetch_queries_class_filter_at_max_page_size(self) -> None:
        # The Lucene query keys the disk cache; the registry values MUST stay
        # stable — see api/routes/classes.py. Item/Supporter outgrow the
        # default search_all envelope, so the fetch pages at 250.
        from api.routes.classes import _fetch_class_cards

        captured: list[tuple[str, int, int]] = []

        def _capture(self_, query, page_size=50, max_pages=12, *, cache_only=False):
            del self_, cache_only
            captured.append((query, page_size, max_pages))
            return [], "MISS"

        with patch("mgz_pkmn.sources.pokemontcg.TCGClient.search_all", _capture):
            _fetch_class_cards("supporter", api_key=None)
            _fetch_class_cards("special-energy", api_key=None)

        self.assertEqual(
            captured,
            [
                ("supertype:Trainer subtypes:Supporter", 250, 12),
                ("supertype:Energy subtypes:Special", 250, 12),
            ],
        )

    def test_groups_same_trainer_object_or_character_then_sorts_printings(self) -> None:
        # Bulbapedia's English Trainer-card index groups repeated card names
        # together; within each trainer/object/character group, keep the
        # pokedex-style newest set first, then set A→Z, collector number.
        from api.routes.classes import _fetch_class_cards

        raw = [
            {
                "id": "a",
                "name": "Marnie",
                "number": "1",
                # Alphabetically first but the older printing — a naive sort
                # that orders by set name before release date would put this
                # ahead of "b" and fail the newest-first assertion below.
                "set": {"id": "s1", "name": "Alpha Expedition", "releaseDate": "2019/01/01"},
            },
            {
                "id": "b",
                "name": "Marnie",
                "number": "1",
                "set": {"id": "s2", "name": "Zenith Zone", "releaseDate": "2024/01/01"},
            },
            {
                "id": "c",
                "name": "Iono",
                "number": "1",
                "set": {"id": "s3", "name": "Middle Set", "releaseDate": "2022/01/01"},
            },
        ]

        def _stub(self_, query, page_size=50, max_pages=12, *, cache_only=False):
            del self_, query, page_size, max_pages, cache_only
            return raw, "HIT"

        with patch("mgz_pkmn.sources.pokemontcg.TCGClient.search_all", _stub):
            out, status = _fetch_class_cards("supporter", api_key=None)

        self.assertEqual(status, "HIT")
        # Name groups alphabetically (Iono before Marnie); within Marnie the
        # newer printing ("b", Zenith Zone 2024) leads the older one ("a",
        # Alpha Expedition 2019) despite Alpha Expedition sorting first by
        # set name.
        self.assertEqual([c["id"] for c in out], ["c", "b", "a"])


if __name__ == "__main__":
    unittest.main()
