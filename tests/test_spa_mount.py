"""Tests for the SPA mount's caching behavior.

The mount must serve ``index.html`` with ``Cache-Control: no-cache`` so a fresh
deploy is visible after a normal refresh. Hashed assets in ``assets/`` must
keep their default caching behavior so they remain long-cacheable.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.main import SPAStaticFiles


class SPAStaticFilesTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        dist = Path(self._tmp.name)
        (dist / "index.html").write_text("<!doctype html><html></html>")
        (dist / "assets").mkdir()
        (dist / "assets" / "index-abc123.js").write_text("console.log(1);")

        app = FastAPI()
        app.mount("/", SPAStaticFiles(directory=dist, html=True), name="web")
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_index_html_has_no_cache(self) -> None:
        resp = self.client.get("/index.html")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("cache-control"), "no-cache")

    def test_root_serves_index_with_no_cache(self) -> None:
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("cache-control"), "no-cache")

    def test_hashed_asset_is_not_marked_no_cache(self) -> None:
        resp = self.client.get("/assets/index-abc123.js")
        self.assertEqual(resp.status_code, 200)
        # The hashed asset must not inherit the index.html override; whatever
        # default Starlette sets (none today) is fine, but it must not be
        # "no-cache".
        self.assertNotEqual(resp.headers.get("cache-control"), "no-cache")

    def test_client_side_route_falls_back_to_index(self) -> None:
        # Deep links like /account (post-link OAuth redirect target) must
        # serve the SPA shell so React Router can hydrate, instead of 404-ing
        # at the static mount (see #536).
        resp = self.client.get("/account")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("<!doctype html>", resp.text)
        self.assertEqual(resp.headers.get("cache-control"), "no-cache")

    def test_nested_client_side_route_falls_back_to_index(self) -> None:
        # Multi-segment routes (e.g. future /wishlists/abc123) also resolve.
        resp = self.client.get("/wishlists/abc123")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("<!doctype html>", resp.text)

    def test_missing_asset_keeps_404(self) -> None:
        # Anything that looks like a file (has a dot in the last segment)
        # must keep its real 404 — a missing hashed bundle is a deploy bug,
        # and silently degrading to the SPA shell would mask it.
        resp = self.client.get("/assets/missing-deadbeef.js")
        self.assertEqual(resp.status_code, 404)

    def test_unknown_api_path_keeps_404(self) -> None:
        # An unknown `/api/*` URL is an API miss, not an SPA route — must
        # keep its 404 so JSON callers don't get an HTML page back. (Real
        # API misses are caught at the router before they reach the mount;
        # this guards the path-traversal-normalised case where `..` segments
        # collapse a `/api/v1/...` URL onto an unmatched route that then
        # falls through to the static mount.)
        resp = self.client.get("/api/v1/nope/whatever")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
