from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.sorting import SORT_MODES, sort_rows
from mgz_pkmn.spreadsheet import Row


def _row(
    *,
    tag: str = "t1",
    cid: str | None = "x",
    number: str = "1",
    set_name: str = "Surging Sparks",
    name: str = "Card",
    market: float | None = None,
    override: float | None = None,
    release: str | None = "2024-11-08",
) -> Row:
    if cid is None:
        card = None
    else:
        card = {
            "id": cid,
            "name": name,
            "number": number,
            "set": {"name": set_name, "releaseDate": release},
        }
    return Row(
        query=CardQuery(raw=name, name=name),
        card=card,
        pricing=Pricing(market=market, pricing_override=override),
        tag=tag,
    )


class SortRowsTests(unittest.TestCase):
    def test_number_default_groups_by_set_then_number(self) -> None:
        rows = [
            _row(cid="a", number="5", set_name="A"),
            _row(cid="b", number="2", set_name="B"),
            _row(cid="c", number="1", set_name="A"),
            _row(cid="d", number="1", set_name="B"),
        ]
        sort_rows(rows, "number")
        # First-appearance order of sets within tag t1: A then B.
        self.assertEqual([r.card["id"] for r in rows], ["c", "a", "d", "b"])

    def test_number_desc_reverses_within_tag(self) -> None:
        rows = [
            _row(cid="a", number="1", set_name="A"),
            _row(cid="b", number="10", set_name="A"),
            _row(cid="c", number="5", set_name="A"),
        ]
        sort_rows(rows, "number-desc")
        self.assertEqual([r.card["id"] for r in rows], ["b", "c", "a"])

    def test_price_desc_pushes_unpriced_to_end(self) -> None:
        rows = [
            _row(cid="a", market=10),
            _row(cid="b", market=None),
            _row(cid="c", market=50),
            _row(cid="d", market=20),
        ]
        sort_rows(rows, "price-desc")
        self.assertEqual([r.card["id"] for r in rows], ["c", "d", "a", "b"])

    def test_price_asc_pushes_unpriced_to_end(self) -> None:
        rows = [
            _row(cid="a", market=10),
            _row(cid="b", market=None),
            _row(cid="c", market=50),
            _row(cid="d", market=20),
        ]
        sort_rows(rows, "price-asc")
        self.assertEqual([r.card["id"] for r in rows], ["a", "d", "c", "b"])

    def test_price_desc_sorts_by_override_not_raw_market(self) -> None:
        """A manual override (#266) is the sort key, not the row's raw
        market — matches what price-sorted comps/exports actually show."""
        rows = [
            _row(cid="a", market=100, override=10),
            _row(cid="b", market=50),
            _row(cid="c", market=20),
        ]
        sort_rows(rows, "price-desc")
        self.assertEqual([r.card["id"] for r in rows], ["b", "c", "a"])

    def test_price_asc_sorts_by_override_not_raw_market(self) -> None:
        rows = [
            _row(cid="a", market=100, override=10),
            _row(cid="b", market=50),
            _row(cid="c", market=20),
        ]
        sort_rows(rows, "price-asc")
        self.assertEqual([r.card["id"] for r in rows], ["a", "c", "b"])

    def test_release_chronological(self) -> None:
        rows = [
            _row(cid="a", release="2024-11-08"),
            _row(cid="b", release="2023-04-14"),
            _row(cid="c", release="2025-02-14"),
        ]
        sort_rows(rows, "release-date")
        self.assertEqual([r.card["id"] for r in rows], ["b", "a", "c"])

    def test_alpha_case_insensitive(self) -> None:
        rows = [
            _row(cid="a", name="Zacian"),
            _row(cid="b", name="charizard"),
            _row(cid="c", name="Mewtwo"),
        ]
        sort_rows(rows, "alpha")
        self.assertEqual([r.card["id"] for r in rows], ["b", "c", "a"])

    def test_tag_grouping_preserved(self) -> None:
        rows = [
            _row(tag="t2", cid="x", number="1"),
            _row(tag="t1", cid="y", number="2"),
            _row(tag="t1", cid="z", number="1"),
        ]
        sort_rows(rows, "number")
        # t2 appeared first → first; within each tag, sorted by number.
        self.assertEqual([r.tag for r in rows], ["t2", "t1", "t1"])
        self.assertEqual([r.card["id"] for r in rows], ["x", "z", "y"])

    def test_unmatched_rows_sink_within_tag(self) -> None:
        rows = [
            _row(tag="t1", cid=None),
            _row(tag="t1", cid="b", number="2"),
            _row(tag="t1", cid="a", number="1"),
        ]
        sort_rows(rows, "number")
        self.assertEqual([r.card["id"] if r.card else None for r in rows], ["a", "b", None])

    def test_unknown_mode_raises(self) -> None:
        with self.assertRaises(ValueError):
            sort_rows([], "bogus")

    def test_all_documented_modes_run(self) -> None:
        rows = [_row(cid="a"), _row(cid="b", number="2")]
        for mode in SORT_MODES:
            sort_rows(list(rows), mode)  # smoke: shouldn't raise for any documented mode


if __name__ == "__main__":
    unittest.main()
