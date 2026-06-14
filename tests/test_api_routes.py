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
    def _lookup_row(self):
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        row = Row(
            query=CardQuery(raw="Pikachu", name="Pikachu"),
            card=None,
            pricing=Pricing(),
            tag="",
        )
        return [(row, "no_candidates")], "MISS"

    def _restore_auth_env(self, old_auth: str | None) -> None:
        from api.auth.session import AUTH_ENABLED_ENV

        if old_auth is None:
            os.environ.pop(AUTH_ENABLED_ENV, None)
        else:
            os.environ[AUTH_ENABLED_ENV] = old_auth

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

        with patch(
            "api.routes.lookup._do_lookup",
            return_value=([(unmatched_row, "no_candidates")], "MISS"),
        ):
            resp = client.post("/api/v1/lookup", json={"line": "Pikachu"})

        self.assertEqual(resp.status_code, 200)
        rows = resp.json()["rows"]
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["matched"])
        self.assertEqual(rows[0]["reason"], "no_candidates")

    def test_lookup_route_sets_x_cache_header_on_hit_miss_stale(self) -> None:
        """`X-Cache` mirrors `_do_lookup`'s aggregated cache status (#372)."""
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        row = Row(
            query=CardQuery(raw="Pikachu", name="Pikachu"),
            card={"id": "base1-25", "name": "Pikachu"},
            pricing=Pricing(market=10.0),
            tag="",
        )
        for status in ("HIT", "STALE", "MISS"):
            with patch(
                "api.routes.lookup._do_lookup",
                return_value=([(row, "matched")], status),
            ):
                resp = client.post("/api/v1/lookup", json={"line": "Pikachu"})
            self.assertEqual(resp.status_code, 200, msg=f"status={status}")
            self.assertEqual(resp.headers["X-Cache"], status, msg=f"status={status}")

    def test_lookup_route_x_cache_is_miss_for_skippable_and_unparseable_lines(self) -> None:
        # Blank line → skipped (no rows, no L2 lookup): default to MISS.
        resp = client.post("/api/v1/lookup", json={"line": "   "})
        self.assertEqual(resp.headers["X-Cache"], "MISS")

    def test_lookup_route_uses_cache_only_for_auth_on_anonymous_user(self) -> None:
        from api.auth.session import AUTH_ENABLED_ENV

        old_auth = os.environ.get(AUTH_ENABLED_ENV)
        os.environ[AUTH_ENABLED_ENV] = "1"
        try:
            with patch("api.routes.lookup._do_lookup", return_value=self._lookup_row()) as do:
                resp = client.post("/api/v1/lookup", json={"line": "Pikachu"})
        finally:
            self._restore_auth_env(old_auth)

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(do.call_args.kwargs["cache_only"])

    def test_lookup_route_fetches_upstream_for_authenticated_user(self) -> None:
        from api.auth.session import AUTH_ENABLED_ENV, get_current_user

        old_auth = os.environ.get(AUTH_ENABLED_ENV)
        os.environ[AUTH_ENABLED_ENV] = "1"
        app.dependency_overrides[get_current_user] = lambda: object()
        try:
            with patch("api.routes.lookup._do_lookup", return_value=self._lookup_row()) as do:
                resp = client.post("/api/v1/lookup", json={"line": "Pikachu"})
        finally:
            app.dependency_overrides.pop(get_current_user, None)
            self._restore_auth_env(old_auth)

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(do.call_args.kwargs["cache_only"])

    def test_lookup_route_fetches_upstream_when_auth_is_off(self) -> None:
        from api.auth.session import AUTH_ENABLED_ENV

        old_auth = os.environ.get(AUTH_ENABLED_ENV)
        os.environ.pop(AUTH_ENABLED_ENV, None)
        try:
            with patch("api.routes.lookup._do_lookup", return_value=self._lookup_row()) as do:
                resp = client.post("/api/v1/lookup", json={"line": "Pikachu"})
        finally:
            self._restore_auth_env(old_auth)

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(do.call_args.kwargs["cache_only"])

    def test_matched_line_returns_matched_row(self) -> None:
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        card = {"id": "base1-4", "name": "Charizard"}
        q = CardQuery(raw="Charizard", name="Charizard")
        matched_row = Row(query=q, card=card, pricing=Pricing(market=100.0), tag="")

        with patch(
            "api.routes.lookup._do_lookup",
            return_value=([(matched_row, "matched")], "HIT"),
        ):
            resp = client.post("/api/v1/lookup", json={"line": "Charizard"})

        self.assertEqual(resp.status_code, 200)
        rows = resp.json()["rows"]
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["matched"])
        self.assertEqual(rows[0]["reason"], "matched")
        self.assertEqual(rows[0]["card"]["name"], "Charizard")


# ---------------------------------------------------------------------------
# Client memoization (#302)
# ---------------------------------------------------------------------------


class ClientMemoizationTests(unittest.TestCase):
    """The upstream client quartet is memoized per api_key so each client's
    `requests.Session` pool + in-memory cache survive across requests."""

    def setUp(self) -> None:
        from api.routes.lookup import _clients_for

        # Other tests share the process-wide cache; clear it so these assert
        # against a known-empty starting point.
        _clients_for.cache_clear()

    def _row(self):
        from mgz_pkmn.parser import CardQuery
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        row = Row(
            query=CardQuery(raw="Pikachu", name="Pikachu"), card=None, pricing=Pricing(), tag=""
        )
        return [(row, "no_candidates")], "MISS"

    def test_make_clients_returns_the_same_instances_for_one_api_key(self) -> None:
        from api.routes.lookup import Settings, _make_clients

        first = _make_clients(Settings(api_key="k1"))
        second = _make_clients(Settings(api_key="k1"))
        # Every member of the quartet is reused, not rebuilt.
        for a, b in zip(first, second, strict=True):
            self.assertIs(a, b)

    def test_a_different_api_key_gets_a_fresh_quartet(self) -> None:
        from api.routes.lookup import Settings, _make_clients

        a = _make_clients(Settings(api_key="k1"))
        b = _make_clients(Settings(api_key="k2"))
        self.assertIsNot(a[0], b[0])

    def test_consecutive_lookups_reuse_the_same_tcgclient(self) -> None:
        seen: list[object] = []

        def _record(pkmn, *args, **kwargs):
            seen.append(pkmn)
            return self._row()

        with patch("api.routes.lookup._do_lookup", side_effect=_record):
            client.post("/api/v1/lookup", json={"line": "Pikachu"})
            client.post("/api/v1/lookup", json={"line": "Pikachu"})

        self.assertEqual(len(seen), 2)
        self.assertIs(seen[0], seen[1])


# ---------------------------------------------------------------------------
# /bulk (SSE) — stage streaming
# ---------------------------------------------------------------------------


def _parse_sse(text: str) -> list[dict]:
    """Parse a collected SSE body into a list of decoded JSON frames."""
    frames = []
    for chunk in text.strip().split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            frames.append(json.loads(chunk[len("data: ") :]))
    return frames


class TerminalStageTests(unittest.TestCase):
    """`_terminal_stage` collapses a resolved row's (matched, reason) onto
    one of the three terminal pipeline stages."""

    def test_mapping(self) -> None:
        from api.routes.lookup import _terminal_stage

        self.assertEqual(_terminal_stage(True, "matched"), "resolved")
        self.assertEqual(_terminal_stage(False, "no_candidates"), "no_match")
        self.assertEqual(_terminal_stage(False, "set_mismatch"), "no_match")
        self.assertEqual(_terminal_stage(False, "no_results"), "no_match")
        self.assertEqual(_terminal_stage(False, "price_mismatch"), "no_match")
        self.assertEqual(_terminal_stage(False, "error"), "error")
        self.assertEqual(_terminal_stage(False, "scrape_failed"), "error")
        self.assertEqual(_terminal_stage(False, "unparseable"), "error")


class BulkStageStreamTests(unittest.TestCase):
    """The /bulk SSE stream interleaves progress-only stage frames with the
    terminal resolved-row frame for each line."""

    def test_streams_parsed_then_pipeline_stages_then_resolved_row(self) -> None:
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        def fake(pkmn, tcgdex, pc, q, settings, on_stage=None, *, cache_only=False, ebay=None):
            if on_stage is not None:
                on_stage("looking_up")
                on_stage("fallback")
            card = {"id": "base1-4", "name": "Charizard"}
            return (
                [(Row(query=q, card=card, pricing=Pricing(market=100.0), tag=""), "matched")],
                "HIT",
            )

        with patch("api.routes.lookup._do_lookup", side_effect=fake):
            resp = client.post("/api/v1/bulk", json={"lines": ["Charizard"]})

        self.assertEqual(resp.status_code, 200)
        frames = _parse_sse(resp.text)

        progress = [f["stage"] for f in frames if "matched" not in f and not f.get("done")]
        self.assertEqual(progress, ["parsed", "looking_up", "fallback"])

        rows = [f for f in frames if "matched" in f]
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["matched"])
        self.assertEqual(rows[0]["stage"], "resolved")

        self.assertTrue(frames[-1].get("done"))

    def test_unmatched_row_carries_no_match_terminal_stage(self) -> None:
        from mgz_pkmn.pricing import Pricing
        from mgz_pkmn.spreadsheet import Row

        def fake(pkmn, tcgdex, pc, q, settings, on_stage=None, *, cache_only=False, ebay=None):
            if on_stage is not None:
                on_stage("looking_up")
            return [(Row(query=q, card=None, pricing=Pricing(), tag=""), "no_candidates")], "MISS"

        with patch("api.routes.lookup._do_lookup", side_effect=fake):
            resp = client.post("/api/v1/bulk", json={"lines": ["Nonsense"]})

        frames = _parse_sse(resp.text)
        rows = [f for f in frames if "matched" in f]
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["matched"])
        self.assertEqual(rows[0]["stage"], "no_match")


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
            return [], "MISS"

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


# ---------------------------------------------------------------------------
# /changelog
# ---------------------------------------------------------------------------


class ChangelogRouteTests(unittest.TestCase):
    def test_returns_releases_newest_first(self) -> None:
        resp = client.get("/api/v1/changelog")
        self.assertEqual(resp.status_code, 200)
        releases = resp.json()["releases"]
        self.assertGreater(len(releases), 0)
        # First shipped release carries a date and a version.
        self.assertIsNotNone(releases[0]["version"])
        self.assertIsNotNone(releases[0]["date"])

    def test_excludes_unreleased_by_default(self) -> None:
        versions = [r["version"] for r in client.get("/api/v1/changelog").json()["releases"]]
        self.assertNotIn("Unreleased", versions)

    def test_include_unreleased_flag_surfaces_no_placeholder(self) -> None:
        # The real changelog no longer carries an [Unreleased] placeholder, so the
        # flag is a no-op: it surfaces the same shipped releases as the default.
        default = [r["version"] for r in client.get("/api/v1/changelog").json()["releases"]]
        with_flag = [
            r["version"]
            for r in client.get("/api/v1/changelog?include_unreleased=true").json()["releases"]
        ]
        self.assertEqual(default, with_flag)
        self.assertNotIn("Unreleased", with_flag)

    def test_limit_caps_release_count(self) -> None:
        resp = client.get("/api/v1/changelog?limit=1")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["releases"]), 1)

    def test_limit_applies_after_unreleased_filter(self) -> None:
        # limit=1 without unreleased should return the most recent *shipped*
        # release, never the in-flight Unreleased section.
        release = client.get("/api/v1/changelog?limit=1").json()["releases"][0]
        self.assertNotEqual(release["version"], "Unreleased")

    def test_invalid_limit_rejected(self) -> None:
        self.assertEqual(client.get("/api/v1/changelog?limit=0").status_code, 422)
        self.assertEqual(client.get("/api/v1/changelog?limit=999").status_code, 422)

    def test_cache_control_header(self) -> None:
        resp = client.get("/api/v1/changelog")
        self.assertIn("max-age", resp.headers.get("cache-control", ""))

    def test_release_section_shape(self) -> None:
        release = client.get("/api/v1/changelog?limit=1").json()["releases"][0]
        self.assertIn("sections", release)
        for section in release["sections"]:
            self.assertIn("name", section)
            self.assertIsInstance(section["entries"], list)


# ---------------------------------------------------------------------------
# /cache/stats
# ---------------------------------------------------------------------------


class CacheStatsRouteTests(unittest.TestCase):
    """Pinning the JSON shape so it stays interchangeable with `pkmn cache stats --json`.

    Both setUp/tearDown follow the OverridesRouteTests pattern: redirect
    XDG_CACHE_HOME at a tempdir and clear MGZ_PKMN_NO_CACHE so writes
    actually land. Tests that don't write any cache entries get the
    "fresh install" shape; the warmed test seeds the two warm manifests
    directly via `cache.write_*_warm` so we don't need a real upstream.
    """

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

    def test_empty_cache_returns_zeroed_shape(self) -> None:
        resp = client.get("/api/v1/cache/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertTrue(data["root"].startswith(self._tmp.name))
        self.assertEqual(data["api_entry_count"], 0)
        self.assertEqual(data["api_bytes"], 0)
        self.assertIsNone(data["api_oldest_mtime"])
        self.assertEqual(data["override_count"], 0)
        self.assertEqual(data["override_bytes"], 0)
        self.assertEqual(data["image_entry_count"], 0)
        self.assertEqual(data["image_bytes"], 0)
        self.assertIsNone(data["concept_warm_timestamp"])
        self.assertEqual(data["concept_warm_names"], 0)
        self.assertIsNone(data["set_cards_warm_timestamp"])
        self.assertEqual(data["set_cards_warm_count"], 0)
        self.assertIsNone(data["sets_warm_timestamp"])
        self.assertEqual(data["sets_warm_count"], 0)
        self.assertIsNone(data["card_warm_timestamp"])
        self.assertEqual(data["card_warm_count"], 0)
        self.assertEqual(data["card_warm_failed_count"], 0)

    def test_warmed_cache_surfaces_manifest_counts(self) -> None:
        cache.write_concept_warm(names_warmed=47, names_failed=[], source="test")
        cache.write_set_cards_warm(sets_warmed=12, sets_failed=[])
        cache.write_sets_warm(sets_warmed=173, logos_cached=173, symbols_cached=170, failures=3)
        cache.write_card_warm(
            cards_warmed=18_500, cards_failed=12, sets_attempted=173, sets_failed=[]
        )

        data = client.get("/api/v1/cache/stats").json()
        self.assertEqual(data["concept_warm_names"], 47)
        self.assertIsInstance(data["concept_warm_timestamp"], float)
        self.assertEqual(data["set_cards_warm_count"], 12)
        self.assertIsInstance(data["set_cards_warm_timestamp"], float)
        self.assertEqual(data["sets_warm_count"], 173)
        self.assertIsInstance(data["sets_warm_timestamp"], float)
        self.assertEqual(data["card_warm_count"], 18_500)
        self.assertEqual(data["card_warm_failed_count"], 12)
        self.assertIsInstance(data["card_warm_timestamp"], float)

    def test_response_is_not_browser_cached(self) -> None:
        resp = client.get("/api/v1/cache/stats")
        self.assertEqual(resp.headers.get("cache-control"), "no-store")

    def test_oserror_from_stats_falls_back_to_zero_snapshot(self) -> None:
        """A read-only / misconfigured filesystem shouldn't 500 a diagnostics endpoint."""
        with patch.object(cache, "stats", side_effect=OSError("read-only fs")):
            resp = client.get("/api/v1/cache/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # Same schema, just zeros + nulls.
        self.assertEqual(data["api_entry_count"], 0)
        self.assertEqual(data["api_bytes"], 0)
        self.assertIsNone(data["api_oldest_mtime"])
        self.assertIsNone(data["concept_warm_timestamp"])
        self.assertIsNone(data["set_cards_warm_timestamp"])
        self.assertIsNone(data["sets_warm_timestamp"])
        self.assertIsNone(data["card_warm_timestamp"])
        self.assertIsInstance(data["root"], str)

    def test_field_names_match_cli_json_shape(self) -> None:
        """Acceptance check: same field names as `pkmn cache stats --json`.

        Drift here would silently break operators piping between the two
        surfaces. Compares against `asdict(CacheStats)` directly rather than
        spelling the field set out twice.
        """
        from dataclasses import fields

        api_keys = set(client.get("/api/v1/cache/stats").json().keys())
        cli_keys = {f.name for f in fields(cache.CacheStats)}
        self.assertEqual(api_keys, cli_keys)


if __name__ == "__main__":
    unittest.main()
