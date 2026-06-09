"""Path/input expansion helpers for the lookup command."""

from __future__ import annotations

from pathlib import Path

TEXT_FILE_SUFFIXES = {".txt", ".md", ".list"}


def _expand_inputs(paths: tuple[Path, ...]) -> list[Path]:
    """Resolve each INPUT to a concrete list of files.

    Plain files pass through unchanged. Directories are scanned (non-recursive)
    for files with text-y extensions, sorted by name so the run order is
    predictable. Hidden files (leading dot) are skipped."""
    out: list[Path] = []
    seen: set[Path] = set()
    for p in paths:
        candidates: list[Path]
        if p.is_dir():
            candidates = sorted(
                child
                for child in p.iterdir()
                if child.is_file()
                and not child.name.startswith(".")
                and child.suffix.lower() in TEXT_FILE_SUFFIXES
            )
        else:
            candidates = [p]
        for c in candidates:
            resolved = c.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            out.append(c)
    return out
