"""Tests for the Keep-a-Changelog parser (`mgz_pkmn.changelog`)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.changelog import Release, Section, parse_changelog

REPO_ROOT = Path(__file__).resolve().parents[1]


class ParseChangelogTests(unittest.TestCase):
    def test_empty_input_yields_no_releases(self) -> None:
        self.assertEqual(parse_changelog(""), [])

    def test_preamble_before_first_release_is_ignored(self) -> None:
        text = (
            "# Changelog\n\nAll notable changes...\n\n"
            "## [1.0.0] - 2026-01-01\n\n### Added\n\n- First thing\n"
        )
        releases = parse_changelog(text)
        self.assertEqual(len(releases), 1)
        self.assertEqual(releases[0].version, "1.0.0")
        self.assertEqual(releases[0].date, "2026-01-01")

    def test_release_order_preserved(self) -> None:
        text = (
            "## [Unreleased]\n\n### Added\n\n- WIP\n\n"
            "## [1.1.0] - 2026-02-01\n\n### Added\n\n- Newer\n\n"
            "## [1.0.0] - 2026-01-01\n\n### Added\n\n- Older\n"
        )
        versions = [r.version for r in parse_changelog(text)]
        self.assertEqual(versions, ["Unreleased", "1.1.0", "1.0.0"])

    def test_unreleased_has_no_date_and_flag_set(self) -> None:
        releases = parse_changelog("## [Unreleased]\n\n### Added\n\n- WIP\n")
        self.assertIsNone(releases[0].date)
        self.assertTrue(releases[0].is_unreleased)

    def test_dated_release_is_not_unreleased(self) -> None:
        releases = parse_changelog("## [2.0.0] - 2026-03-03\n\n### Fixed\n\n- Bug\n")
        self.assertFalse(releases[0].is_unreleased)
        self.assertEqual(releases[0].date, "2026-03-03")

    def test_multiple_sections_preserve_order(self) -> None:
        text = (
            "## [1.0.0] - 2026-01-01\n\n"
            "### Added\n\n- A\n\n"
            "### Changed\n\n- C\n\n"
            "### Fixed\n\n- F\n"
        )
        names = [s.name for s in parse_changelog(text)[0].sections]
        self.assertEqual(names, ["Added", "Changed", "Fixed"])

    def test_wrapped_bullet_lines_are_joined(self) -> None:
        text = (
            "## [1.0.0] - 2026-01-01\n\n### Added\n\n"
            "- A bullet that wraps\n"
            "  across two lines into one entry.\n"
        )
        entries = parse_changelog(text)[0].sections[0].entries
        self.assertEqual(entries, ["A bullet that wraps across two lines into one entry."])

    def test_blank_line_separates_bullets(self) -> None:
        text = "## [1.0.0] - 2026-01-01\n\n### Added\n\n- First bullet\n\n- Second bullet\n"
        entries = parse_changelog(text)[0].sections[0].entries
        self.assertEqual(entries, ["First bullet", "Second bullet"])

    def test_markdown_in_bullets_is_preserved_raw(self) -> None:
        text = (
            "## [1.0.0] - 2026-01-01\n\n### Added\n\n"
            "- A `code` span and a [link](https://example.com).\n"
        )
        entry = parse_changelog(text)[0].sections[0].entries[0]
        self.assertIn("`code`", entry)
        self.assertIn("[link](https://example.com)", entry)

    def test_subsection_headers_do_not_break_section(self) -> None:
        # Older releases use `#### CLI`-style subsections. They shouldn't
        # start a new section or drop the bullets under them.
        text = (
            "## [0.1.0] - 2026-01-01\n\n### Added\n\n"
            "#### CLI\n- cli thing\n\n#### Web\n- web thing\n"
        )
        sections = parse_changelog(text)[0].sections
        self.assertEqual(len(sections), 1)
        self.assertEqual(sections[0].name, "Added")
        self.assertEqual(sections[0].entries, ["cli thing", "web thing"])

    def test_release_with_only_prose_has_empty_sections(self) -> None:
        text = "## [0.1.0] - 2026-01-01\n\nFoundation release. No bullets here.\n"
        releases = parse_changelog(text)
        self.assertEqual(releases[0].sections, [])

    def test_returns_dataclasses(self) -> None:
        releases = parse_changelog("## [1.0.0] - 2026-01-01\n\n### Added\n\n- A\n")
        self.assertIsInstance(releases[0], Release)
        self.assertIsInstance(releases[0].sections[0], Section)


class RealChangelogTests(unittest.TestCase):
    """Parse the project's actual CHANGELOG.md as a regression guard."""

    def setUp(self) -> None:
        self.releases = parse_changelog((REPO_ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))

    def test_first_release_is_unreleased(self) -> None:
        self.assertTrue(self.releases[0].is_unreleased)

    def test_every_dated_release_has_iso_date(self) -> None:
        for release in self.releases:
            if release.is_unreleased:
                continue
            # Loose shape check: YYYY-MM-DD.
            self.assertRegex(release.date or "", r"^\d{4}-\d{2}-\d{2}$")

    def test_shipped_releases_have_at_least_one_entry(self) -> None:
        for release in self.releases:
            if release.is_unreleased:
                continue
            total = sum(len(s.entries) for s in release.sections)
            self.assertGreater(total, 0, f"{release.version} parsed with no entries")


if __name__ == "__main__":
    unittest.main()
