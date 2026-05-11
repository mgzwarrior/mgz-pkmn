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


if __name__ == "__main__":
    unittest.main()
