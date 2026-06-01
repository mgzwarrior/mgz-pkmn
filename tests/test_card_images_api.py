"""API-surface coverage for the Phase 2 card-image route + URL rewriter.

`GET /api/v1/cards/{id}/image/{size}` streams cached image bytes from
disk or 404s with a hint pointing at `pkmn cache warm-card-images`.

`api/routes/cards.rewrite_card_image_urls` swaps `images.{large,small}`
entries on lookup-response cards (and the `thumb` field on
`_trim_card` in `api/routes/sets.py`) to the new route whenever the
underlying file is present — cache miss leaves the upstream URL in
place so a cold deploy still serves a working `<img>`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.main import app
from api.routes.cards import rewrite_card_image_urls
from api.routes.sets import _trim_card
from mgz_pkmn import cache as disk_cache
from mgz_pkmn.card_images import LARGE_CATEGORY, SMALL_CATEGORY


class _IsolatedCacheMixin(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(disk_cache._NO_CACHE_ENV)
        self._old_automigrate = os.environ.get("MGZ_PKMN_AUTOMIGRATE")
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(disk_cache._NO_CACHE_ENV, None)
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(disk_cache._NO_CACHE_ENV, None)
        else:
            os.environ[disk_cache._NO_CACHE_ENV] = self._old_no_cache
        if self._old_automigrate is None:
            os.environ.pop("MGZ_PKMN_AUTOMIGRATE", None)
        else:
            os.environ["MGZ_PKMN_AUTOMIGRATE"] = self._old_automigrate
        self._tmp.cleanup()


# ---------------------------------------------------------------------------
# Route: GET /api/v1/cards/{id}/image/{size}
# ---------------------------------------------------------------------------


class CardImageRouteTests(_IsolatedCacheMixin):
    def test_serves_cached_large_image_with_long_cache_header(self) -> None:
        disk_cache.write_image(LARGE_CATEGORY, "sv8-1", b"fake-png-bytes", ext=".png")
        with TestClient(app) as client:
            resp = client.get("/api/v1/cards/sv8-1/image/large")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"fake-png-bytes")
        self.assertEqual(resp.headers["cache-control"], "public, max-age=2592000, immutable")
        # mimetypes guessed from the .png extension.
        self.assertIn("png", resp.headers["content-type"])

    def test_serves_cached_small_image(self) -> None:
        disk_cache.write_image(SMALL_CATEGORY, "sv8-1", b"sm", ext=".png")
        with TestClient(app) as client:
            resp = client.get("/api/v1/cards/sv8-1/image/small")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"sm")

    def test_404_on_cache_miss_with_warmer_hint(self) -> None:
        with TestClient(app) as client:
            resp = client.get("/api/v1/cards/sv8-1/image/large")
        self.assertEqual(resp.status_code, 404)
        # The detail should mention the warmer so an operator hitting
        # the endpoint directly knows what to run.
        self.assertIn("warm-card-images", resp.json()["detail"])

    def test_unknown_size_returns_422(self) -> None:
        with TestClient(app) as client:
            resp = client.get("/api/v1/cards/sv8-1/image/medium")
        # Literal["large", "small"] enforced by FastAPI → 422 unprocessable.
        self.assertEqual(resp.status_code, 422)

    def test_path_traversal_attempt_returns_422(self) -> None:
        with TestClient(app) as client:
            # `..` triggers the `_CARD_ID_PATH` regex rejection (it
            # only allows `[A-Za-z0-9_-]`).
            resp = client.get("/api/v1/cards/..%2Fevil/image/large")
        self.assertIn(resp.status_code, (404, 422))


# ---------------------------------------------------------------------------
# URL rewriter: rewrite_card_image_urls
# ---------------------------------------------------------------------------


class RewriteCardImageURLsTests(_IsolatedCacheMixin):
    def _card_with_upstream_urls(self) -> dict:
        return {
            "id": "sv8-1",
            "name": "Test",
            "images": {
                "large": "https://images.example/upstream_lg.png",
                "small": "https://images.example/upstream_sm.png",
            },
        }

    def test_cache_miss_leaves_upstream_urls_unchanged(self) -> None:
        original = self._card_with_upstream_urls()
        rewritten = rewrite_card_image_urls(dict(original))
        assert rewritten is not None
        self.assertEqual(rewritten["images"], original["images"])

    def test_cache_hit_rewrites_to_api_route(self) -> None:
        disk_cache.write_image(LARGE_CATEGORY, "sv8-1", b"lg", ext=".png")
        disk_cache.write_image(SMALL_CATEGORY, "sv8-1", b"sm", ext=".png")
        rewritten = rewrite_card_image_urls(self._card_with_upstream_urls())
        assert rewritten is not None
        self.assertEqual(rewritten["images"]["large"], "/api/v1/cards/sv8-1/image/large")
        self.assertEqual(rewritten["images"]["small"], "/api/v1/cards/sv8-1/image/small")

    def test_partial_cache_only_rewrites_present_size(self) -> None:
        # Only `small` is on disk — `large` keeps its upstream URL.
        disk_cache.write_image(SMALL_CATEGORY, "sv8-1", b"sm", ext=".png")
        rewritten = rewrite_card_image_urls(self._card_with_upstream_urls())
        assert rewritten is not None
        self.assertEqual(rewritten["images"]["small"], "/api/v1/cards/sv8-1/image/small")
        self.assertEqual(rewritten["images"]["large"], "https://images.example/upstream_lg.png")

    def test_does_not_mutate_input_card(self) -> None:
        # Regression for Copilot review on #371: _row_to_dict passes
        # `row.card` directly, and the same Row is later persisted via
        # row_to_run_row(card_json=row.card). In-place mutation would
        # leak `/api/v1/cards/.../image/...` URLs into run history.
        disk_cache.write_image(SMALL_CATEGORY, "sv8-1", b"sm", ext=".png")
        original = self._card_with_upstream_urls()
        before = {
            "id": original["id"],
            "name": original["name"],
            "images": dict(original["images"]),
        }
        result = rewrite_card_image_urls(original)
        # The input dict is untouched.
        self.assertEqual(original["images"], before["images"])
        # The returned dict has the rewritten URL.
        assert result is not None
        self.assertEqual(result["images"]["small"], "/api/v1/cards/sv8-1/image/small")
        # And it's a fresh dict — mutating it doesn't affect the input.
        result["images"]["small"] = "mutated"
        self.assertEqual(original["images"]["small"], before["images"]["small"])

    def test_none_input_returns_none(self) -> None:
        self.assertIsNone(rewrite_card_image_urls(None))

    def test_card_without_images_dict_returns_unchanged(self) -> None:
        card = {"id": "sv8-1", "name": "Test"}
        out = rewrite_card_image_urls(card)
        self.assertEqual(out, card)

    def test_card_without_id_returns_unchanged(self) -> None:
        card = {"name": "Test", "images": {"large": "https://x/upstream.png"}}
        out = rewrite_card_image_urls(card)
        self.assertEqual(out, card)


# ---------------------------------------------------------------------------
# set_cards `_trim_card` thumb rewrite
# ---------------------------------------------------------------------------


class TrimCardThumbRewriteTests(_IsolatedCacheMixin):
    def _raw_card(self) -> dict:
        return {
            "id": "sv8-1",
            "name": "Test",
            "number": "1",
            "rarity": "Common",
            "supertype": "Pokémon",
            "subtypes": ["Basic"],
            "images": {
                "small": "https://images.example/upstream_sm.png",
                "large": "https://images.example/upstream_lg.png",
            },
        }

    def test_thumb_keeps_upstream_url_when_not_cached(self) -> None:
        trimmed = _trim_card(self._raw_card())
        self.assertEqual(trimmed["thumb"], "https://images.example/upstream_sm.png")

    def test_thumb_rewrites_to_api_route_when_cached(self) -> None:
        disk_cache.write_image(SMALL_CATEGORY, "sv8-1", b"sm", ext=".png")
        trimmed = _trim_card(self._raw_card())
        self.assertEqual(trimmed["thumb"], "/api/v1/cards/sv8-1/image/small")


if __name__ == "__main__":
    unittest.main()
