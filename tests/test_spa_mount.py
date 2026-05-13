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


if __name__ == "__main__":
    unittest.main()
