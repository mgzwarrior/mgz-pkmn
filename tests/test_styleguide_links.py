"""Static-link check for the in-repo design styleguide.

The cards under [`design/styleguide/`](../design/styleguide/) are plain HTML
that the Pages workflow ([.github/workflows/pages.yml](../.github/workflows/pages.yml))
publishes verbatim — every local `href` / `src` must resolve relative to the
file that declares it, or the published page will 404 a stylesheet, a token,
or an SVG before a reviewer notices.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[1]
STYLEGUIDE = REPO_ROOT / "design" / "styleguide"

_ATTR_RE = re.compile(r"""(?:href|src)\s*=\s*"([^"]+)\"""")


def _local_refs(html: str) -> list[str]:
    refs: list[str] = []
    for raw in _ATTR_RE.findall(html):
        parts = urlsplit(raw)
        if parts.scheme or parts.netloc:
            continue
        target = parts.path
        if not target or target.startswith("#"):
            continue
        refs.append(target)
    return refs


class StyleguideLinkTests(unittest.TestCase):
    def test_every_local_ref_resolves(self) -> None:
        html_files = sorted(STYLEGUIDE.glob("*.html"))
        self.assertGreater(len(html_files), 0, "no styleguide html files found")
        missing: list[str] = []
        for html_path in html_files:
            for ref in _local_refs(html_path.read_text(encoding="utf-8")):
                resolved = (html_path.parent / ref).resolve()
                if not resolved.exists():
                    missing.append(f"{html_path.name} → {ref}")
        self.assertEqual(missing, [], "broken styleguide refs:\n  " + "\n  ".join(missing))


if __name__ == "__main__":
    unittest.main()
