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


SAMPLE_SETS = [
    {
        "id": "sv8",
        "name": "Surging Sparks",
        "series": "Scarlet & Violet",
        "total": 252,
        "printedTotal": 191,
        "releaseDate": "2024/11/08",
        "images": {},  # no logo URL → no network call from set_cards renderer
    },
    {
        "id": "sv7",
        "name": "Stellar Crown",
        "series": "Scarlet & Violet",
        "total": 175,
        "printedTotal": 142,
        "releaseDate": "2024/09/13",
        "images": {},
    },
]


class SetCardsEndpointTests(unittest.TestCase):
    def test_returns_pdf(self) -> None:
        with patch("api.routes.set_cards.fetch_all_sets", return_value=SAMPLE_SETS):
            resp = client.get("/api/v1/set-cards.pdf")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "application/pdf")
        self.assertIn("attachment", resp.headers["content-disposition"])
        self.assertTrue(resp.content.startswith(b"%PDF"))

    def test_502_when_upstream_returns_empty(self) -> None:
        with patch("api.routes.set_cards.fetch_all_sets", return_value=[]):
            resp = client.get("/api/v1/set-cards.pdf")
        self.assertEqual(resp.status_code, 502)

    def test_no_images_flag_skips_write_set_cards_pdf_session(self) -> None:
        # `no_images=true` must wire `logos_dir=None`/`session=None` through
        # to write_set_cards_pdf — otherwise every API hit would re-download
        # the full set logo catalog.
        captured: dict = {}

        def _fake_writer(sets, out_path, *, logos_dir=None, session=None, today=None):
            captured["logos_dir"] = logos_dir
            captured["session"] = session
            out_path.write_bytes(b"%PDF-1.4\n%fake\n")
            return len(sets)

        with (
            patch("api.routes.set_cards.fetch_all_sets", return_value=SAMPLE_SETS),
            patch("api.routes.set_cards.write_set_cards_pdf", side_effect=_fake_writer),
        ):
            resp = client.get("/api/v1/set-cards.pdf?no_images=true")
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(captured["logos_dir"])
        self.assertIsNone(captured["session"])

    def test_default_passes_session_for_unified_image_cache(self) -> None:
        # Logo storage now flows through the unified disk image cache
        # (cache/images/sets/), so the route no longer needs to thread a
        # custom `logos_dir`. It just passes `session` and lets the cache
        # resolve the on-disk path internally — this is the contract that
        # makes the cache survive across requests without a sidecar dir.
        captured: dict = {}

        def _fake_writer(sets, out_path, *, logos_dir=None, session=None, today=None):
            captured["logos_dir"] = logos_dir
            captured["session"] = session
            out_path.write_bytes(b"%PDF-1.4\n%fake\n")
            return len(sets)

        with (
            patch("api.routes.set_cards.fetch_all_sets", return_value=SAMPLE_SETS),
            patch("api.routes.set_cards.write_set_cards_pdf", side_effect=_fake_writer),
        ):
            resp = client.get("/api/v1/set-cards.pdf")
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(captured["logos_dir"])
        self.assertIsNotNone(captured["session"])


if __name__ == "__main__":
    unittest.main()
