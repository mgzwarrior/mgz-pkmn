"""Tests for the configurable xlsx columns (#262)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.export_fields import COMP_80, MARKET, NAME, SET
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.spreadsheet import HEADERS, Row, write_spreadsheet


def _row(market: float | None = 12.5) -> Row:
    return Row(
        query=CardQuery(raw="Charizard", name="Charizard"),
        card={
            "id": "x",
            "name": "Charizard",
            "number": "4",
            "rarity": "Rare Holo",
            "set": {"name": "Base"},
        },
        pricing=Pricing(market=market, variant="holo", source="tcgplayer", url="https://example/x"),
        tag="list-a",
    )


def _write_and_load(fields):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "cards.xlsx"
        write_spreadsheet([_row()], out, fields=fields)
        return load_workbook(out).active


class DefaultBehaviorTests(unittest.TestCase):
    def test_fields_none_renders_every_header(self) -> None:
        ws = _write_and_load(None)
        header_row = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        self.assertEqual(header_row, HEADERS)


class FieldFilterTests(unittest.TestCase):
    def test_disabled_column_is_absent_from_header_row(self) -> None:
        ws = _write_and_load(frozenset({NAME}))
        header_row = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        self.assertNotIn("Rarity", header_row)
        self.assertNotIn("Variant", header_row)
        self.assertNotIn("Market", header_row)
        self.assertIn("Name", header_row)
        # Always-on columns stay regardless of the fields filter.
        self.assertIn("Source", header_row)
        self.assertIn("Input", header_row)

    def test_only_enabled_comp_tier_is_written(self) -> None:
        ws = _write_and_load(frozenset({MARKET, COMP_80}))
        header_row = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        self.assertIn("80%", header_row)
        self.assertNotIn("85%", header_row)
        self.assertNotIn("90%", header_row)
        self.assertNotIn("95%", header_row)

    def test_empty_fields_still_renders_always_on_columns(self) -> None:
        ws = _write_and_load(frozenset())
        header_row = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        self.assertEqual(
            header_row,
            ["Source", "Input", "Series", "Database", "eBay Sold (median)", "eBay Active (floor)"],
        )

    def test_set_and_name_values_land_in_the_right_columns(self) -> None:
        ws = _write_and_load(frozenset({NAME, SET}))
        header_row = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        name_col = header_row.index("Name") + 1
        set_col = header_row.index("Set") + 1
        self.assertEqual(ws.cell(row=2, column=name_col).value, "Charizard")
        self.assertEqual(ws.cell(row=2, column=set_col).value, "Base")


if __name__ == "__main__":
    unittest.main()
