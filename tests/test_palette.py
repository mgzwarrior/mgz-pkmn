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
_RGBA_RE = re.compile(r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0?\.\d+|\d+)\s*\)")


def _block_body(css: str, selector: str) -> str:
    """Return the body of the first `{ ... }` block following `selector`."""
    start = css.index(selector)
    brace = css.index("{", start)
    depth = 0
    for i in range(brace, len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return css[brace + 1 : i]
    raise AssertionError(f"unterminated {selector} block in colors_and_type.css")


def _light_root_block(css: str) -> str:
    """Return the body of the first (light, default) `:root { ... }` block."""
    return _block_body(css, ":root")


def _dark_block(css: str) -> str:
    """Return the body of the `[data-theme="dark"]` override block."""
    return _block_body(css, '[data-theme="dark"]')


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


class DarkPaletteParityTests(unittest.TestCase):
    """`palette._SEMANTIC_DARK` must match the `[data-theme="dark"]` block.

    The dark block's status backgrounds are rgba() washes; the Python map
    carries them as solid hex composited over the dark `bg-surface`, so this
    test recomputes that composite from the CSS instead of comparing raw
    values."""

    @classmethod
    def setUpClass(cls) -> None:
        css = _TOKENS_CSS.read_text(encoding="utf-8")
        light = {m.group(1): m.group(2) for m in _DECL_RE.finditer(_light_root_block(css))}
        dark_overrides = {m.group(1): m.group(2) for m in _DECL_RE.finditer(_dark_block(css))}
        # Dark values reference raw palette vars declared in :root — layer the
        # overrides on top of the light declarations for var() resolution.
        cls.decls = {**light, **dark_overrides}
        cls.dark_overrides = dark_overrides

    def test_dark_semantic_tokens_match_css(self) -> None:
        surface = _resolve("bg-surface", self.decls)
        assert surface is not None
        for name in palette._SEMANTIC_DARK:
            with self.subTest(token=name):
                expected = self._expected_hex(name, surface)
                with palette.use_theme("dark"):
                    self.assertEqual(
                        expected,
                        palette.hex(name).upper(),
                        f"palette dark semantic '{name}' drifted from colors_and_type.css",
                    )

    def test_dark_map_covers_every_dark_color_override(self) -> None:
        # Every color token the dark CSS block overrides must appear in the
        # Python dark map — a token added to the CSS without a Python update
        # would otherwise silently keep rendering its light value.
        # Only tokens the light map mirrors matter — bg-overlay/shadows are
        # browser-only and never reach the writers.
        for name in self.dark_overrides:
            if name in palette._SEMANTIC:
                with self.subTest(token=name):
                    self.assertIn(
                        name,
                        palette._SEMANTIC_DARK,
                        f"dark CSS overrides --{name} but palette._SEMANTIC_DARK omits it",
                    )

    def test_non_overridden_tokens_fall_back_to_light(self) -> None:
        # brand-* / rarity-* aren't in the dark block; hex() must keep
        # resolving them from the light map under the dark theme.
        with palette.use_theme("dark"):
            self.assertEqual(palette.hex("brand-primary"), palette._RAW["sun-300"])
            self.assertEqual(palette.hex("rarity-rare"), palette._RAW["sun-300"])

    def test_theme_resets_after_context(self) -> None:
        light_fg = palette.hex("fg-1")
        with palette.use_theme("dark"):
            self.assertNotEqual(palette.hex("fg-1"), light_fg)
        self.assertEqual(palette.hex("fg-1"), light_fg)
        self.assertEqual(palette.current_theme(), "light")

    def test_unknown_theme_rejected(self) -> None:
        with self.assertRaises(ValueError), palette.use_theme("sepia"):
            pass

    def _expected_hex(self, name: str, surface_hex: str) -> str:
        value = self.dark_overrides.get(name, "").strip()
        if m := _RGBA_RE.fullmatch(value):
            r, g, b = (int(m.group(i)) for i in (1, 2, 3))
            a = float(m.group(4))
            bg = tuple(int(surface_hex[i : i + 2], 16) for i in (0, 2, 4))
            return "".join(
                f"{round(a * f + (1 - a) * c):02X}" for f, c in zip((r, g, b), bg, strict=True)
            )
        resolved = _resolve(name, self.decls)
        self.assertIsNotNone(resolved, f"token --{name} not found / not a color in dark CSS")
        return resolved  # type: ignore[return-value]


if __name__ == "__main__":
    unittest.main()
