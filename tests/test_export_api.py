from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def _row_payload(
    *,
    cid: str = "sv8-1",
    number: str = "1",
    name: str = "Pikachu",
    set_name: str = "Surging Sparks",
    market: float | None = 12.5,
    tag: str = "test",
) -> dict:
    return {
        "query": {"raw": name, "name": name},
        "card": {
            "id": cid,
            "name": name,
            "number": number,
            "set": {"id": "sv8", "name": set_name, "printedTotal": 191, "total": 252},
            "_database": "pokemontcg.io",
            "language": "en",
        },
        "pricing": {"market": market, "currency": "USD"},
        "tag": tag,
    }


class ExportApiTests(unittest.TestCase):
    def test_xlsx_export(self) -> None:
        resp = client.post(
            "/api/v1/export",
            json={"rows": [_row_payload()], "format": "xlsx"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.headers["content-type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertGreater(len(resp.content), 0)

    def test_standard_pdf_export(self) -> None:
        resp = client.post(
            "/api/v1/export",
            json={"rows": [_row_payload()], "format": "pdf"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "application/pdf")
        self.assertIn("binder.pdf", resp.headers["content-disposition"])

    def test_condensed_pdf_export(self) -> None:
        resp = client.post(
            "/api/v1/export",
            json={"rows": [_row_payload()], "format": "condensed-pdf"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "application/pdf")
        self.assertIn("binder-condensed.pdf", resp.headers["content-disposition"])

    def test_checklist_export(self) -> None:
        resp = client.post(
            "/api/v1/export",
            json={"rows": [_row_payload()], "format": "checklist"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "application/pdf")
        self.assertIn("checklist.pdf", resp.headers["content-disposition"])

    def test_checklist_with_no_matches_rejected(self) -> None:
        unmatched = {
            "query": {"raw": "Foo", "name": "Foo"},
            "card": None,
            "pricing": {"market": None, "currency": "USD"},
            "tag": "t",
        }
        resp = client.post(
            "/api/v1/export",
            json={"rows": [unmatched], "format": "checklist"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_unknown_format_rejected(self) -> None:
        resp = client.post(
            "/api/v1/export",
            json={"rows": [_row_payload()], "format": "bogus"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_unknown_sort_rejected(self) -> None:
        resp = client.post(
            "/api/v1/export",
            json={"rows": [_row_payload()], "format": "xlsx", "sort": "bogus"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_sort_accepts_documented_modes(self) -> None:
        for mode in ("number", "number-desc", "price-asc", "price-desc", "release-date", "alpha"):
            resp = client.post(
                "/api/v1/export",
                json={"rows": [_row_payload()], "format": "xlsx", "sort": mode},
            )
            self.assertEqual(resp.status_code, 200, f"sort={mode} failed: {resp.text}")


if __name__ == "__main__":
    unittest.main()
