from __future__ import annotations

import datetime as _dt
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import MagicMock

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.set_cards import (
    _draw_logo,
    _release_year,
    fetch_all_sets,
    write_set_cards_pdf,
)


def _set(
    *,
    sid: str = "sv8",
    name: str = "Surging Sparks",
    series: str | None = "Scarlet & Violet",
    total: int | None = 252,
    printed: int | None = 191,
    release: str | None = "2024/11/08",
    logo: str | None = "https://images.pokemontcg.io/sv8/logo.png",
) -> dict:
    out: dict = {
        "id": sid,
        "name": name,
        "series": series,
        "total": total,
        "printedTotal": printed,
        "releaseDate": release,
    }
    if logo is not None:
        out["images"] = {"logo": logo, "symbol": logo.replace("logo", "symbol")}
    return out


class ReleaseYearTests(unittest.TestCase):
    def test_parses_iso_like_date(self) -> None:
        self.assertEqual(_release_year("2024/11/08"), "2024")

    def test_handles_year_only(self) -> None:
        self.assertEqual(_release_year("1999"), "1999")

    def test_none_when_missing(self) -> None:
        self.assertIsNone(_release_year(None))
        self.assertIsNone(_release_year(""))


class FetchAllSetsTests(unittest.TestCase):
    def test_normalizes_pokemontcg_payload(self) -> None:
        client = MagicMock()
        response = MagicMock()
        response.json.return_value = {
            "data": [
                {
                    "id": "sv8",
                    "name": "Surging Sparks",
                    "series": "Scarlet & Violet",
                    "printedTotal": 191,
                    "total": 252,
                    "releaseDate": "2024/11/08",
                    "images": {
                        "logo": "https://images.pokemontcg.io/sv8/logo.png",
                        "symbol": "https://images.pokemontcg.io/sv8/symbol.png",
                    },
                },
                # Skipped — no id.
                {"name": "Bogus"},
            ]
        }
        client.session.get.return_value = response

        sets = fetch_all_sets(client)
        self.assertEqual(len(sets), 1)
        self.assertEqual(sets[0]["id"], "sv8")
        self.assertEqual(sets[0]["images"]["logo"], "https://images.pokemontcg.io/sv8/logo.png")


class WritePdfTests(unittest.TestCase):
    def test_renders_pdf_without_network(self) -> None:
        sets = [_set(), _set(sid="sv7", name="Stellar Crown", printed=142, total=175)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out)
            self.assertEqual(written, 2)
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)

    def test_zero_when_no_sets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            self.assertEqual(write_set_cards_pdf([], out), 0)
            self.assertFalse(out.exists())

    def test_paginates_when_more_than_nine_sets(self) -> None:
        sets = [_set(sid=f"set-{i}", name=f"Set {i}") for i in range(11)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out)
            self.assertEqual(written, 11)
            self.assertTrue(out.exists())

    def test_handles_missing_optional_fields(self) -> None:
        # Cards with no release date / total / logo still render.
        sets = [_set(release=None, total=None, printed=None, logo=None, series=None)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out)
            self.assertEqual(written, 1)
            self.assertTrue(out.exists())

    def test_today_override(self) -> None:
        # The `today` knob is mostly for snapshot tests; just verify it
        # accepts a date and doesn't blow up.
        sets = [_set()]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out, today=_dt.date(2026, 5, 10))
            self.assertEqual(written, 1)


class DrawLogoTests(unittest.TestCase):
    def test_corrupt_file_logs_and_draws_placeholder(self) -> None:
        # A path that exists but isn't a valid image used to silently fail.
        # Now it should log to stderr and render an "image error" placeholder
        # instead of leaving an invisible gap.
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "broken.png"
            bad.write_bytes(b"not a real image")
            out = Path(tmp) / "out.pdf"
            c = canvas.Canvas(str(out), pagesize=letter)

            err = io.StringIO()
            with redirect_stderr(err):
                _draw_logo(c, bad, 100, 100, 100, 50)
            c.save()

            self.assertIn("logo render failed", err.getvalue())
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
