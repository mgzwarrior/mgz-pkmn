"""Tests for /parse, /lookup, /sets, and /overrides API routes.

Uses the same fastapi.TestClient pattern as test_export_api.py.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from api.main import app
from mgz_pkmn import cache

client = TestClient(app)


# ---------------------------------------------------------------------------
# /parse
# ---------------------------------------------------------------------------


class ParseRouteTests(unittest.TestCase):
    def test_valid_line_returns_query(self) -> None:
        resp = client.post("/api/v1/parse", json={"line": "Charizard | Base Set | 4/102"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNotNone(data["query"])
        self.assertEqual(data["query"]["name"], "Charizard")
        self.assertEqual(data["query"]["set_hint"], "Base Set")
        self.assertEqual(data["query"]["number"], "4/102")

    def test_blank_line_returns_null_query(self) -> None:
        resp = client.post("/api/v1/parse", json={"line": ""})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()["query"])

    def test_comment_line_returns_null_query(self) -> None:
        resp = client.post("/api/v1/parse", json={"line": "# this is a comment"})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()["query"])

    def test_bulk_top_line_parsed(self) -> None:
        resp = client.post("/api/v1/parse", json={"line": "top:5 Charizard cards"})
        self.assertEqual(resp.status_code, 200)
        q = resp.json()["query"]
        self.assertIsNotNone(q)
        self.assertEqual(q["bulk_top"], 5)
        self.assertEqual(q["name"], "Charizard")

    def test_missing_line_field_is_rejected(self) -> None:
        resp = client.post("/api/v1/parse", json={})
        self.assertEqual(resp.status_code, 422)


# ---------------------------------------------------------------------------
# /lookup
# ---------------------------------------------------------------------------


def _matched_row(name: str = "Charizard") -> dict:
    """Minimal row dict that _row_to_dict would produce for a successful match."""
    return {
        "query": {
            "raw": name,
            "name": name,
            "set_hint": None,
            "number": None,
            "variant_hint": None,
            "url_hint": None,
            "bulk_top": None,
            "bulk_all": False,
            "price_min": None,
            "price_max": None,
        },
        "card": {"id": "base1-4", "name": name},
        "pricing": {
            "market": 100.0,
            "variant": None,
            "source": None,
            "url": None,
            "currency": "USD",
        },
        "tag": "",
        "matched": True,
        "reason": "matched",
    }


class LookupRouteTests(unittest.TestCase):
    def test_blank_line_returns_empty_rows(self) -> None:
        resp = client.post("/api/v1/lookup", json={"line": ""})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["rows"], [])

    def test_comment_line_returns_empty_rows(self) -> None:
        resp = client.post("/api/v1/lookup", json={"line": "# comment"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["rows"], [])

    def test_unmatched_line_returns_row_with_reason(self) -> None:
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        placeholder_q = CardQuery(raw="Pikachu", name="Pikachu")
        unmatched_row = Row(query=placeholder_q, card=None, pricing=Pricing(), tag="")

        with patch("api.routes.lookup._do_lookup", return_value=[(unmatched_row, "no_candidates")]):
            resp = client.post("/api/v1/lookup", json={"line": "Pikachu"})

        self.assertEqual(resp.status_code, 200)
        rows = resp.json()["rows"]
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["matched"])
        self.assertEqual(rows[0]["reason"], "no_candidates")

    def test_matched_line_returns_matched_row(self) -> None:
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        card = {"id": "base1-4", "name": "Charizard"}
        q = CardQuery(raw="Charizard", name="Charizard")
        matched_row = Row(query=q, card=card, pricing=Pricing(market=100.0), tag="")

        with patch("api.routes.lookup._do_lookup", return_value=[(matched_row, "matched")]):
            resp = client.post("/api/v1/lookup", json={"line": "Charizard"})

        self.assertEqual(resp.status_code, 200)
        rows = resp.json()["rows"]
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["matched"])
        self.assertEqual(rows[0]["reason"], "matched")
        self.assertEqual(rows[0]["card"]["name"], "Charizard")


# ---------------------------------------------------------------------------
# /sets
# ---------------------------------------------------------------------------


class SetsRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_cache_path = None

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _seed_cache(self, sets: list[dict]) -> Path:
        """Write a sets JSON cache file into a temp dir and patch the path."""
        cache_path = Path(self._tmp.name) / "sets.json"
        cache_path.write_text(json.dumps(sets), encoding="utf-8")
        return cache_path

    def test_cache_hit_returns_sets(self) -> None:
        known_sets = [
            {
                "id": "base1",
                "name": "Base Set",
                "series": "Base",
                "total": 102,
                "releaseDate": "1998/01/09",
            }
        ]
        cache_path = self._seed_cache(known_sets)

        with (
            patch("api.routes.sets._SETS_CACHE_PATH", cache_path),
            patch("api.routes.sets._SETS_TTL", 999_999_999),
        ):
            resp = client.get("/api/v1/sets")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["sets"], known_sets)

    def test_cache_miss_fetches_and_returns_sets(self) -> None:
        fetched_sets = [
            {
                "id": "swsh1",
                "name": "Sword & Shield",
                "series": "Sword & Shield",
                "total": 202,
                "releaseDate": "2020/02/07",
            }
        ]

        with (
            patch("api.routes.sets._load_sets_cache", return_value=None),
            patch("api.routes.sets._fetch_sets", return_value=fetched_sets),
            patch("api.routes.sets._save_sets_cache"),
        ):
            resp = client.get("/api/v1/sets")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["sets"], fetched_sets)


# ---------------------------------------------------------------------------
# /overrides
# ---------------------------------------------------------------------------


class OverridesRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(cache._NO_CACHE_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(cache._NO_CACHE_ENV, None)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(cache._NO_CACHE_ENV, None)
        else:
            os.environ[cache._NO_CACHE_ENV] = self._old_no_cache
        self._tmp.cleanup()

    def test_create_override_returns_ok(self) -> None:
        payload = {
            "name": "Charizard",
            "set": "Base Set",
            "url": "https://www.pricecharting.com/game/pokemon-base-set/charizard-4",
        }
        resp = client.post("/api/v1/overrides", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["name"], "Charizard")
        self.assertEqual(data["set"], "Base Set")
        self.assertEqual(data["url"], payload["url"])

    def test_create_override_missing_url_rejected(self) -> None:
        resp = client.post("/api/v1/overrides", json={"name": "Charizard"})
        self.assertEqual(resp.status_code, 422)

    def test_list_overrides_empty_initially(self) -> None:
        resp = client.get("/api/v1/overrides")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["overrides"], {})

    def test_list_overrides_reflects_created_override(self) -> None:
        url = "https://www.pricecharting.com/game/pokemon-base-set/charizard-4"
        client.post("/api/v1/overrides", json={"name": "Charizard", "set": None, "url": url})

        resp = client.get("/api/v1/overrides")
        self.assertEqual(resp.status_code, 200)
        overrides = resp.json()["overrides"]
        self.assertTrue(any(url in v for v in overrides.values()))


if __name__ == "__main__":
    unittest.main()
