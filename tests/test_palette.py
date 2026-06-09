"""Parity guard: `mgz_pkmn.palette` must match the design tokens.

The export palette is hand-transcribed from
`design/tokens/colors_and_type.css`. This test parses that CSS, resolves its
`var()` references, and asserts every value declared in `palette.py` matches —
so a token edited in the CSS without a matching Python update fails CI instead
of shipping a stale brand color.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from mgz_pkmn import palette

_TOKENS_CSS = Path(__file__).resolve().parents[1] / "design" / "tokens" / "colors_and_type.css"

_DECL_RE = re.compile(r"--([a-z0-9-]+)\s*:\s*([^;]+);")
_VAR_RE = re.compile(r"var\(--([a-z0-9-]+)\)")
_HEX_RE = re.compile(r"#([0-9a-fA-F]{6})")


def _light_root_block(css: str) -> str:
    """Return the body of the first (light, default) `:root { ... }` block.

    The dark overrides live in a later `[data-theme="dark"]` block, which we
    deliberately exclude — this module mirrors the light theme only."""
    start = css.index(":root")
    brace = css.index("{", start)
    depth = 0
    for i in range(brace, len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return css[brace + 1 : i]
    raise AssertionError("unterminated :root block in colors_and_type.css")


def _resolve(name: str, decls: dict[str, str]) -> str | None:
    """Resolve a token name to an uppercase `RRGGBB` hex, or None if it's not
    a plain color (rgba/gradient/px/font values are skipped)."""
    value = decls.get(name)
    if value is None:
        return None
    value = value.strip()
    if m := _HEX_RE.fullmatch(value):
        return m.group(1).upper()
    if m := _VAR_RE.fullmatch(value):
        return _resolve(m.group(1), decls)
    return None


class PaletteParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        css = _TOKENS_CSS.read_text(encoding="utf-8")
        body = _light_root_block(css)
        cls.decls = {m.group(1): m.group(2) for m in _DECL_RE.finditer(body)}

    def test_raw_palette_matches_css(self) -> None:
        for name, expected_hex in palette._RAW.items():
            with self.subTest(token=name):
                self.assertEqual(
                    self._css_hex(name),
                    expected_hex.upper(),
                    f"palette._RAW['{name}'] drifted from colors_and_type.css",
                )

    def test_semantic_tokens_match_css(self) -> None:
        for name in palette._SEMANTIC:
            with self.subTest(token=name):
                self.assertEqual(
                    self._css_hex(name),
                    palette.hex(name).upper(),
                    f"palette semantic '{name}' drifted from colors_and_type.css",
                )

    def test_header_band_is_a_real_token(self) -> None:
        # Composed element pinned to a raw shade — guard the pin resolves.
        self.assertEqual(palette.hex(palette.HEADER_BAND), self._css_hex(palette.HEADER_BAND))

    def test_rgb01_round_trips(self) -> None:
        self.assertEqual(palette.rgb01("sand-50"), (0xFB / 255, 0xF6 / 255, 0xE8 / 255))

    def _css_hex(self, name: str) -> str:
        resolved = _resolve(name, self.decls)
        self.assertIsNotNone(resolved, f"token --{name} not found / not a color in CSS")
        return resolved  # type: ignore[return-value]


if __name__ == "__main__":
    unittest.main()
