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
from mgz_pkmn import __version__, cache

client = TestClient(app)


# ---------------------------------------------------------------------------
# /version
# ---------------------------------------------------------------------------


class VersionRouteTests(unittest.TestCase):
    def test_version_returns_current_version(self) -> None:
        resp = client.get("/version")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("version", data)
        self.assertEqual(data["version"], __version__)


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
            patch("api.routes.sets._sets_cache_path", return_value=cache_path),
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

    def test_browser_cache_control_header(self) -> None:
        # The /sets response needs a short-TTL Cache-Control plus
        # stale-while-revalidate so the browser serves cached content
        # immediately while it revalidates in the background. Pairs
        # with the SPA-side baked catalog (`web/src/data/sets.json`)
        # which covers the very-first-visit case where there's no
        # browser cache to serve from.
        with (
            patch("api.routes.sets._load_sets_cache", return_value=[]),
        ):
            resp = client.get("/api/v1/sets")

        self.assertEqual(resp.status_code, 200)
        cache_control = resp.headers.get("cache-control", "")
        self.assertIn("public", cache_control)
        self.assertIn("max-age=", cache_control)
        self.assertIn("stale-while-revalidate=", cache_control)


class SetCardsRouteTests(unittest.TestCase):
    """`GET /api/v1/sets/{set_id}/cards` returns a trimmed card list."""

    def test_trims_card_payload(self) -> None:
        # Synthetic upstream response with the fields we care about plus
        # a bunch of noise to confirm the trim drops them.
        raw_cards = [
            {
                "id": "sv8-1",
                "name": "Pikachu",
                "number": "1",
                "rarity": "Common",
                "supertype": "Pokémon",
                "subtypes": ["Basic"],
                "images": {
                    "small": "https://images.example/sv8-1-small.png",
                    "large": "https://images.example/sv8-1-large.png",
                },
                "tcgplayer": {
                    "prices": {"normal": {"market": 1.23}},
                    "url": "https://tcgplayer.example/sv8-1",
                },
                # Noise we expect the trim to drop.
                "attacks": [{"name": "Thundershock"}],
                "weaknesses": [{"type": "Fighting"}],
                "legalities": {"standard": "Legal"},
            }
        ]

        with patch(
            "api.routes.sets._fetch_set_cards",
            return_value=[
                # _fetch_set_cards is the trimmer entry point; bypass it and
                # verify the route hands the slim shape straight through.
                {
                    "id": "sv8-1",
                    "name": "Pikachu",
                    "number": "1",
                    "rarity": "Common",
                    "supertype": "Pokémon",
                    "subtypes": ["Basic"],
                    "thumb": "https://images.example/sv8-1-small.png",
                    "market": 1.23,
                }
            ],
        ) as fetch_mock:
            resp = client.get("/api/v1/sets/sv8/cards")

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["set_id"], "sv8")
        self.assertEqual(len(body["cards"]), 1)

        card = body["cards"][0]
        # Required fields are all present.
        for field in ("id", "name", "number", "rarity", "supertype", "subtypes", "thumb", "market"):
            self.assertIn(field, card)
        # And the noise fields are absent.
        for noise in ("attacks", "weaknesses", "legalities", "tcgplayer", "images"):
            self.assertNotIn(noise, card)
        # And the fetch helper actually got the set_id we passed.
        fetch_mock.assert_called_once()
        args, _ = fetch_mock.call_args
        self.assertEqual(args[0], "sv8")
        # Silence unused-variable lint — raw_cards documents the upstream
        # shape the trim is reducing.
        self.assertEqual(raw_cards[0]["id"], "sv8-1")

    def test_trim_card_helper_projects_fields(self) -> None:
        # Direct test of the trim helper so we don't have to mock the
        # HTTP client to assert the projection contract.
        from api.routes.sets import _trim_card

        raw = {
            "id": "sv8-99",
            "name": "Charizard",
            "number": "99",
            "rarity": "Rare Holo",
            "supertype": "Pokémon",
            "subtypes": ["Stage 2"],
            "images": {"small": "https://example/c.png", "large": "x"},
            "tcgplayer": {"prices": {"holofoil": {"market": 42.5}}},
            "attacks": [{"name": "Fire Spin"}],
        }
        slim = _trim_card(raw)
        self.assertEqual(slim["id"], "sv8-99")
        self.assertEqual(slim["name"], "Charizard")
        self.assertEqual(slim["number"], "99")
        self.assertEqual(slim["rarity"], "Rare Holo")
        self.assertEqual(slim["supertype"], "Pokémon")
        self.assertEqual(slim["subtypes"], ["Stage 2"])
        self.assertEqual(slim["thumb"], "https://example/c.png")
        self.assertEqual(slim["market"], 42.5)
        self.assertNotIn("attacks", slim)
        self.assertNotIn("images", slim)
        self.assertNotIn("tcgplayer", slim)

    def test_trim_card_missing_pricing_returns_null_market(self) -> None:
        # A card without tcgplayer / cardmarket pricing — happens for very
        # new releases or promo cards. The shape should still be valid
        # with `market: None` so the SPA can render a `—` placeholder.
        from api.routes.sets import _trim_card

        slim = _trim_card({"id": "x", "name": "n", "number": "1"})
        self.assertIsNone(slim["market"])
        self.assertIsNone(slim["thumb"])
        self.assertEqual(slim["subtypes"], [])

    def test_404_when_set_has_no_cards(self) -> None:
        with patch("api.routes.sets._fetch_set_cards", return_value=[]):
            resp = client.get("/api/v1/sets/bogus/cards")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("bogus", resp.json()["detail"])

    def test_browser_cache_control_header(self) -> None:
        with patch(
            "api.routes.sets._fetch_set_cards",
            return_value=[
                {
                    "id": "sv8-1",
                    "name": "Pikachu",
                    "number": "1",
                    "rarity": "Common",
                    "supertype": "Pokémon",
                    "subtypes": [],
                    "thumb": None,
                    "market": None,
                }
            ],
        ):
            resp = client.get("/api/v1/sets/sv8/cards")
        self.assertEqual(resp.status_code, 200)
        cache_control = resp.headers.get("cache-control", "")
        self.assertIn("public", cache_control)
        self.assertIn("max-age=", cache_control)

    def test_rejects_malformed_set_ids(self) -> None:
        # Mirrors the logo route's defence — the same `_SET_ID_PATH`
        # validator gates both endpoints, so a regression in one would
        # likely catch the other. Subset of inputs is enough to verify
        # the validator is wired up here too.
        for bad in ("sv8;rm", "x" * 200, "sv8&foo"):
            with self.subTest(set_id=bad):
                resp = client.get(f"/api/v1/sets/{bad}/cards")
                self.assertEqual(resp.status_code, 422)

    def test_fetch_set_cards_queries_set_id_filter(self) -> None:
        # Patch TCGClient.search_all to capture the Lucene query the
        # helper issues. The cache-hit-rate of the underlying disk cache
        # depends on the query string being a stable shape, so a silent
        # change here would silently bust everyone's cache. The query
        # MUST be `set.id:"<id>"` (quoted, single key) — see
        # api/routes/sets.py:_fetch_set_cards.
        from api.routes.sets import _fetch_set_cards

        captured: list[str] = []

        def _capture(self_, query):
            del self_  # bound-method shape; we only care about the query string
            captured.append(query)
            return []

        with patch("mgz_pkmn.sources.pokemontcg.TCGClient.search_all", _capture):
            _fetch_set_cards("sv8", api_key=None)

        self.assertEqual(captured, ['set.id:"sv8"'])

    def test_set_id_passed_through_to_fetch(self) -> None:
        # Confirms the route hands the path parameter straight through
        # to `_fetch_set_cards` — i.e. no rewriting / normalisation /
        # case-folding between the URL and the helper. Important
        # because the upstream catalog ids are case-sensitive.
        with patch(
            "api.routes.sets._fetch_set_cards",
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
                }
            ],
        ) as fetch_mock:
            client.get("/api/v1/sets/MixedCaseId-9/cards?api_key=abc")
        fetch_mock.assert_called_once_with("MixedCaseId-9", "abc")


class SetLogoRouteTests(unittest.TestCase):
    """`GET /api/v1/sets/{set_id}/logo` serves cached images, 404s on miss."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        os.environ["XDG_CACHE_HOME"] = self._tmp.name

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        self._tmp.cleanup()

    def test_serves_cached_logo(self) -> None:
        # A real PNG header so FileResponse's content-type guess is sensible.
        png_bytes = b"\x89PNG\r\n\x1a\n" + b"fakeimagedata" * 8
        cache.write_image("sets/logo", "base1", png_bytes, ext=".png")

        resp = client.get("/api/v1/sets/base1/logo")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, png_bytes)
        self.assertEqual(resp.headers["content-type"], "image/png")
        # 30-day immutable cache so the SPA can keep the asset as long as
        # the set id is stable.
        self.assertIn("immutable", resp.headers.get("cache-control", ""))
        self.assertIn("max-age=2592000", resp.headers.get("cache-control", ""))

    def test_404_when_not_in_cache_suggests_warm_sets(self) -> None:
        resp = client.get("/api/v1/sets/zzz-not-warmed/logo")
        self.assertEqual(resp.status_code, 404)
        # The error body should point the user at the warm-sets command.
        detail = resp.json()["detail"]
        self.assertIn("zzz-not-warmed", detail)
        self.assertIn("warm-sets", detail)

    def test_rejects_malformed_set_ids_at_route_boundary(self) -> None:
        # Defense-in-depth: the route's `Path(pattern=...)` validator
        # rejects anything outside `[A-Za-z0-9_-]` with a 422 before
        # `read_image` runs. The cache module's `_safe_image_key` also
        # sanitises (slashes collapse to underscores), but stopping the
        # value at the HTTP boundary keeps the CodeQL taint tracer happy
        # and makes the contract explicit.
        #
        # Path-traversal-style inputs like `../etc/passwd` and
        # `sv8/../x` never reach this handler at all — the ASGI URL
        # normaliser rewrites them before routing — so we only assert
        # 422 against bad characters that *do* survive routing.
        for bad in (
            "sv8;rm",
            "sv8%20with%20space",  # decodes to a literal space
            "x" * 200,  # over max_length=64
            "sv8&foo",
            "sv8*",
        ):
            with self.subTest(set_id=bad):
                resp = client.get(f"/api/v1/sets/{bad}/logo")
                self.assertEqual(
                    resp.status_code,
                    422,
                    f"expected 422 for malformed set_id={bad!r}, got {resp.status_code}",
                )

    def test_path_traversal_attempts_dont_resolve_to_this_route(self) -> None:
        # ASGI URL normalisation collapses `..` segments before routing,
        # so `/api/v1/sets/../etc/passwd/logo` becomes
        # `/api/v1/etc/passwd/logo` — a route that doesn't exist (404).
        # This is the first line of defense; the regex validator catches
        # whatever survives.
        for bad in ("..", "../etc/passwd", "sets/../etc"):
            with self.subTest(set_id=bad):
                resp = client.get(f"/api/v1/sets/{bad}/logo")
                self.assertEqual(resp.status_code, 404)


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
