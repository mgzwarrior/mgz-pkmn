from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.export_fields import (
    BINDER_FIELDS,
    CHECKLIST_FIELDS,
    MARKET,
    NAME,
    RARITY,
    SOURCE,
    XLSX_FIELDS,
    resolve_fields,
)


class ResolveFieldsTests(unittest.TestCase):
    def test_none_resolves_to_every_supported_field(self) -> None:
        self.assertEqual(resolve_fields("xlsx", None), frozenset(XLSX_FIELDS))
        self.assertEqual(resolve_fields("pdf", None), frozenset(BINDER_FIELDS))
        self.assertEqual(resolve_fields("condensed-pdf", None), frozenset(BINDER_FIELDS))
        self.assertEqual(resolve_fields("checklist", None), frozenset(CHECKLIST_FIELDS))

    def test_subset_is_kept_as_is(self) -> None:
        self.assertEqual(resolve_fields("xlsx", [NAME, MARKET]), frozenset({NAME, MARKET}))

    def test_unsupported_field_for_format_is_dropped(self) -> None:
        # Binder doesn't render rarity or source at all — passing them
        # shouldn't raise, just silently drop.
        self.assertEqual(resolve_fields("pdf", [NAME, RARITY, SOURCE]), frozenset({NAME}))

    def test_unknown_field_key_is_dropped(self) -> None:
        self.assertEqual(resolve_fields("checklist", ["not-a-real-field", NAME]), frozenset({NAME}))

    def test_empty_list_resolves_to_nothing_enabled(self) -> None:
        # Distinct from `None` — an explicit empty selection disables every
        # configurable field, it does not fall back to "everything".
        self.assertEqual(resolve_fields("xlsx", []), frozenset())


if __name__ == "__main__":
    unittest.main()
