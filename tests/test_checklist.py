from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from reportlab.pdfgen import canvas

from mgz_pkmn.checklist import (
    _build_sections,
    _format_mp,
    _row_label,
    _truncate_to_width,
    write_checklist_pdf,
)
from mgz_pkmn.export_fields import CHECKLIST_FIELDS
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.spreadsheet import Row

# Names long enough to exercise the condensed checklist's truncation boundary.
LONG_NAMES = [
    "Special Illustration Rare V-UNION",
    "Iron Valiant ex (Special Illustration Rare)",
    "Charizard ex — Obsidian Flames Ultra Premium Collection",
]


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

    def test_long_names_across_pages_keep_all_rows(self) -> None:
        # Long names must not drop rows — every matched row survives into the
        # section, even when the section spills onto multiple pages.
        rows = [
            _make_row(
                tag="long-names",
                card=_card(
                    cid=f"sv8-{i}",
                    number=str(i),
                    name=LONG_NAMES[i % len(LONG_NAMES)],
                ),
                market=1234.56,
            )
            for i in range(200)
        ]
        sections = _build_sections(rows)
        self.assertEqual(len(sections[0]["rows"]), 200)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "checklist.pdf"
            written = write_checklist_pdf(rows, out)
            self.assertEqual(written, 1)
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)


class RowLabelTests(unittest.TestCase):
    """#262 — name plus optional rarity / set segments."""

    def _card(self) -> dict:
        return _card(cid="sv8-1", number="1", name="Pikachu") | {"rarity": "Rare Holo"}

    def test_name_only_by_default_fields(self) -> None:
        self.assertEqual(_row_label(self._card(), frozenset({"name"})), "Pikachu")

    def test_rarity_and_set_appended_when_enabled(self) -> None:
        self.assertEqual(
            _row_label(self._card(), frozenset(CHECKLIST_FIELDS)),
            "Pikachu · Rare Holo · Surging Sparks",
        )

    def test_name_disabled_omits_name_but_keeps_other_segments(self) -> None:
        self.assertEqual(_row_label(self._card(), frozenset({"rarity"})), "Rare Holo")

    def test_missing_rarity_is_skipped_even_when_enabled(self) -> None:
        card = _card(cid="sv8-2", number="2", name="Eevee")
        self.assertEqual(_row_label(card, frozenset({"name", "rarity"})), "Eevee")


class WriteChecklistFieldsTests(unittest.TestCase):
    def test_field_subset_writes_a_pdf(self) -> None:
        rows = [_make_row(tag="t", card=_card(cid="a", number="1"), market=10.0)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "checklist.pdf"
            written = write_checklist_pdf(rows, out, fields=frozenset({"name"}))
            self.assertEqual(written, 1)
            self.assertTrue(out.exists())

    def test_empty_fields_still_writes_a_pdf(self) -> None:
        rows = [_make_row(tag="t", card=_card(cid="a", number="1"), market=10.0)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "checklist.pdf"
            written = write_checklist_pdf(rows, out, fields=frozenset())
            self.assertEqual(written, 1)
            self.assertTrue(out.exists())


class TruncateToWidthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.c = canvas.Canvas(io.BytesIO())

    def test_long_name_truncated_within_max_width(self) -> None:
        # No horizontal overflow: the truncated string fits the column budget.
        max_w = 80.0
        for name in LONG_NAMES:
            result = _truncate_to_width(self.c, name, "Helvetica", 8, max_w)
            self.assertLessEqual(self.c.stringWidth(result, "Helvetica", 8), max_w)
            self.assertTrue(result.endswith("…"))

    def test_short_name_returned_unchanged(self) -> None:
        result = _truncate_to_width(self.c, "Pikachu", "Helvetica", 8, 200.0)
        self.assertEqual(result, "Pikachu")

    def test_nonpositive_max_width_returns_empty(self) -> None:
        self.assertEqual(_truncate_to_width(self.c, "Charizard", "Helvetica", 8, 0.0), "")
        self.assertEqual(_truncate_to_width(self.c, "Charizard", "Helvetica", 8, -5.0), "")

    def test_tiny_max_width_stops_at_floor(self) -> None:
        # The loop guard keeps len(text) > 3, so even a sliver column yields a
        # short stub rather than looping forever or returning nothing.
        result = _truncate_to_width(self.c, LONG_NAMES[0], "Helvetica", 8, 1.0)
        self.assertGreaterEqual(len(result), 3)


if __name__ == "__main__":
    unittest.main()
