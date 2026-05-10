from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.checklist import _build_sections, _format_mp, write_checklist_pdf
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.spreadsheet import Row


def _make_row(
    *,
    tag: str,
    card: dict | None,
    market: float | None = None,
    currency: str = "USD",
    raw: str = "Charizard",
) -> Row:
    return Row(
        query=CardQuery(raw=raw, name=raw),
        card=card,
        pricing=Pricing(market=market, currency=currency),
        image_path=None,
        tag=tag,
    )


def _card(*, cid: str, number: str, name: str = "Pikachu") -> dict:
    return {
        "id": cid,
        "name": name,
        "number": number,
        "set": {"id": "sv8", "name": "Surging Sparks", "printedTotal": 191, "total": 252},
        "_database": "pokemontcg.io",
    }


class FormatMpTests(unittest.TestCase):
    def test_usd(self) -> None:
        self.assertEqual(_format_mp(Pricing(market=12.5, currency="USD")), "$12.50")

    def test_eur(self) -> None:
        self.assertEqual(_format_mp(Pricing(market=12.5, currency="EUR")), "€12.50")

    def test_no_price(self) -> None:
        self.assertEqual(_format_mp(Pricing(market=None)), "")


class BuildSectionsTests(unittest.TestCase):
    def test_one_section_per_tag_preserves_input_order(self) -> None:
        # Order from caller is preserved — checklist no longer re-sorts.
        rows = [
            _make_row(tag="a", card=_card(cid="a1", number="5")),
            _make_row(tag="a", card=_card(cid="a2", number="1")),
            _make_row(tag="b", card=_card(cid="b1", number="2")),
        ]
        sections = _build_sections(rows)
        self.assertEqual([s["tag"] for s in sections], ["a", "b"])
        self.assertEqual([r.card["id"] for r in sections[0]["rows"]], ["a1", "a2"])

    def test_skips_tag_with_only_unmatched_rows(self) -> None:
        rows = [
            _make_row(tag="ghost", card=None),
            _make_row(tag="real", card=_card(cid="r1", number="1")),
        ]
        sections = _build_sections(rows)
        self.assertEqual([s["tag"] for s in sections], ["real"])

    def test_empty_input_returns_no_sections(self) -> None:
        self.assertEqual(_build_sections([]), [])


class WritePdfTests(unittest.TestCase):
    def test_writes_pdf_when_sections_exist(self) -> None:
        rows = [
            _make_row(tag="surging-sparks", card=_card(cid="sv8-1", number="1"), market=10.5),
            _make_row(tag="surging-sparks", card=_card(cid="sv8-2", number="2"), market=None),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "checklist.pdf"
            written = write_checklist_pdf(rows, out)
            self.assertEqual(written, 1)
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)

    def test_returns_zero_and_writes_nothing_when_no_matches(self) -> None:
        rows = [_make_row(tag="t", card=None)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "checklist.pdf"
            written = write_checklist_pdf(rows, out)
            self.assertEqual(written, 0)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
