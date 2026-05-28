"""Parse the project CHANGELOG (Keep a Changelog format) into structured data.

The marketing site and the demo SPA both want to surface "what's new" from
the same source of truth — `CHANGELOG.md` — rather than duplicating release
prose by hand. This module is that single parser; the API exposes it at
`GET /api/v1/changelog` (see `api/routes/changelog.py`) and both web surfaces
consume the endpoint.

The parser is intentionally tolerant: it understands the subset of
[Keep a Changelog](https://keepachangelog.com/) the project actually uses
(`## [version] - date` release headers, `### Section` groups, `- ` bullets
with wrapped continuation lines) and quietly ignores anything else — free
prose between a release header and its first section, `#### subsection`
headers in older releases, blank lines. Bullet text is returned as raw
Markdown so the rendering layer can decide how much to format.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# `## [1.1.0] - 2026-05-25` or `## [Unreleased]`. The date is optional so the
# in-flight Unreleased section parses with `date=None`.
_RELEASE_RE = re.compile(r"^##\s+\[(?P<version>[^\]]+)\](?:\s+-\s+(?P<date>.+))?\s*$")
# `### Added`, `### Changed`, `### Fixed`, …
_SECTION_RE = re.compile(r"^###\s+(?P<name>.+?)\s*$")
# A top-level bullet: `- some text`. Continuation lines are indented and
# don't start with `- `, so they're matched separately.
_BULLET_RE = re.compile(r"^-\s+(?P<text>.*)$")


@dataclass(frozen=True)
class Section:
    """One `### Group` within a release — e.g. Added / Changed / Fixed."""

    name: str
    entries: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Release:
    """One `## [version]` block.

    `date` is None for the in-flight `[Unreleased]` section (and any release
    header that omits the trailing date). `is_unreleased` is a convenience
    for callers that want to filter the in-flight section out of a public
    "what's new" view."""

    version: str
    date: str | None
    sections: list[Section] = field(default_factory=list)

    @property
    def is_unreleased(self) -> bool:
        return self.version.strip().lower() == "unreleased"


def parse_changelog(text: str) -> list[Release]:
    """Parse Keep-a-Changelog Markdown into an ordered list of releases.

    Releases are returned in document order (newest first, matching the
    file's convention). Within each release, sections preserve their
    document order; within each section, bullets preserve order with
    wrapped continuation lines joined into a single space-separated string.

    Releases with no bullet content (e.g. a header followed only by prose)
    still appear, with an empty `sections` list — callers decide whether to
    skip them."""
    releases: list[Release] = []
    current_release: dict | None = None
    current_section: Section | None = None
    # The bullet currently being accumulated, so wrapped continuation lines
    # fold back into one entry.
    pending_bullet: list[str] = []

    def flush_bullet() -> None:
        nonlocal pending_bullet
        if pending_bullet and current_section is not None:
            joined = " ".join(part.strip() for part in pending_bullet).strip()
            if joined:
                current_section.entries.append(joined)
        pending_bullet = []

    def flush_section() -> None:
        nonlocal current_section
        flush_bullet()
        if current_section is not None and current_release is not None:
            current_release["sections"].append(current_section)
        current_section = None

    def flush_release() -> None:
        nonlocal current_release
        flush_section()
        if current_release is not None:
            releases.append(
                Release(
                    version=current_release["version"],
                    date=current_release["date"],
                    sections=current_release["sections"],
                )
            )
        current_release = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()

        release_match = _RELEASE_RE.match(line)
        if release_match:
            flush_release()
            date = release_match.group("date")
            current_release = {
                "version": release_match.group("version").strip(),
                "date": date.strip() if date else None,
                "sections": [],
            }
            continue

        # Ignore anything before the first release header (the file preamble).
        if current_release is None:
            continue

        section_match = _SECTION_RE.match(line)
        if section_match:
            flush_section()
            current_section = Section(name=section_match.group("name").strip())
            continue

        bullet_match = _BULLET_RE.match(raw_line)
        if bullet_match and current_section is not None:
            flush_bullet()
            pending_bullet = [bullet_match.group("text")]
            continue

        # Continuation line: indented, non-empty, while a bullet is open.
        if pending_bullet and raw_line.strip() and raw_line[:1] in (" ", "\t"):
            pending_bullet.append(raw_line)
            continue

        # Blank line or `#### subsection` header inside a section ends the
        # current bullet but keeps the section open so following bullets
        # still land under it.
        flush_bullet()

    flush_release()
    return releases
