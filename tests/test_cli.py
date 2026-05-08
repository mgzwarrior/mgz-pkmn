from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.cli import _build_json_report, _dedupe_rows
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.spreadsheet import Row


def _row(card_id: str | None, market: float | None = None) -> Row:
    card = {"id": card_id, "name": "Card"} if card_id else None
    return Row(
        query=CardQuery(raw="x", name="x"),
        card=card,
        pricing=Pricing(market=market),
        tag="t1",
    )


class CliHelpersTests(unittest.TestCase):
    def test_dedupe_rows_removes_duplicate_card_ids(self) -> None:
        rows = [_row("a", 10), _row("a", 12), _row("b", 8), _row(None, None)]
        deduped, removed = _dedupe_rows(rows)
        self.assertEqual(removed, 1)
        self.assertEqual(len(deduped), 3)
        self.assertEqual((deduped[0].card or {}).get("id"), "a")
        self.assertEqual((deduped[1].card or {}).get("id"), "b")
        self.assertIsNone(deduped[2].card)

    def test_json_report_includes_rows_deduped(self) -> None:
        rows = [_row("a", 10)]
        payload = _build_json_report(
            rows=rows,
            counters={"bulk": 3},
            input_lines=2,
            elapsed=1.2,
            deduped_rows=4,
        )
        self.assertEqual(payload["summary"]["rows_deduped"], 4)
        self.assertEqual(payload["summary"]["rows_total"], 1)
        self.assertEqual(payload["summary"]["rows_bulk_expanded"], 3)


if __name__ == "__main__":
    unittest.main()
