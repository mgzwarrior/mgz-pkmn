"""Tropical design-system palette for generated exports.

Why this exists
---------------
The PDF writers (`binder`, `checklist`, `set_cards`) and the `.xlsx` writer
need brand colors in two toolkits: reportlab wants 0-1 RGB floats, openpyxl
wants `"RRGGBB"` hex. The canonical color source is
`design/tokens/colors_and_type.css`, but that's CSS — not importable from
Python. This module is the hand-transcribed Python mirror of that file's
**light** semantic tokens (and the raw palette they resolve to), so every
export sources color from one place instead of scattering raw hex.

`tests/test_palette.py` parses `colors_and_type.css` and asserts every value
here matches, so drift fails CI rather than shipping silently. When a token
changes in the CSS, update it here too and the test stays green.

Themes
------
`_SEMANTIC` mirrors the light `:root` block; `_SEMANTIC_DARK` mirrors the
`[data-theme="dark"]` overrides (tokens the dark block doesn't override fall
back to light). The active theme is a ContextVar so the writers' many
`hex()`/`rgb01()` call sites stay theme-blind — entry points (CLI, API export
routes) wrap the write in `use_theme(theme)` and everything downstream
resolves against the right map, including across FastAPI's threadpool.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

# Raw palette — named by source, transcribed verbatim from the `:root` block
# of design/tokens/colors_and_type.css. Real code should prefer the SEMANTIC
# tokens below; these are here so the palette is auditable in one place and so
# composed elements (e.g. the header band) can reach for a specific shade.
_RAW: dict[str, str] = {
    "sun-50": "FDF6D9",
    "sun-100": "FBEBA8",
    "sun-200": "F8DD78",
    "sun-300": "F5C94B",
    "sun-400": "E8B028",
    "sun-500": "C8901A",
    "sun-600": "946812",
    "sun-700": "5E420B",
    "palm-50": "EAF3E2",
    "palm-100": "C9E0B5",
    "palm-200": "97C57E",
    "palm-300": "6BAC55",
    "palm-400": "4A8B3B",
    "palm-500": "386C2C",
    "palm-600": "2D5A28",
    "palm-700": "1C3A19",
    "coconut-50": "F4ECDD",
    "coconut-100": "E4D2B0",
    "coconut-200": "C8AC7E",
    "coconut-300": "A6845A",
    "coconut-400": "80623F",
    "coconut-500": "6B4A2F",
    "coconut-600": "4D341F",
    "coconut-700": "2E1F11",
    "sand-50": "FBF6E8",
    "sand-100": "F4ECD3",
    "sand-200": "E8DDBC",
    "sand-300": "D6C99F",
    "sand-400": "B4A77C",
    "sand-500": "8C8261",
    "sand-600": "5F583F",
    "sand-700": "3A361F",
    "husk-50": "4A453B",
    "husk-100": "353128",
    "husk-200": "2A2620",
    "husk-300": "1F1B16",
    "husk-400": "15120E",
    "husk-500": "0D0B07",
    "sky-300": "8FC3DD",
    "sky-400": "6FB1D9",
    "sky-500": "4A8FB8",
    "ember-300": "E8A088",
    "ember-400": "D26B4D",
    "ember-500": "A84A2F",
    "ember-600": "7D331E",
}

# Semantic LIGHT tokens — each maps to a raw key or an inline hex literal,
# exactly as the CSS declares them (`var(--sand-50)` vs `#FFFEF8`). Resolved
# through `_RAW` by `hex()`.
_SEMANTIC: dict[str, str] = {
    # Surfaces
    "bg-app": "sand-50",
    "bg-surface": "FFFEF8",
    "bg-surface-2": "sand-100",
    "bg-sunken": "sand-200",
    # Foreground / text
    "fg-1": "husk-300",
    "fg-2": "coconut-500",
    "fg-3": "sand-600",
    "fg-on-primary": "husk-400",
    "fg-on-dark": "sand-50",
    "fg-link": "palm-500",
    # Brand
    "brand-primary": "sun-300",
    "brand-primary-hover": "sun-400",
    "brand-primary-press": "sun-500",
    "brand-secondary": "palm-400",
    "brand-tertiary": "coconut-500",
    # Borders
    "border-1": "sand-300",
    "border-2": "sand-400",
    "border-strong": "coconut-400",
    "focus-ring": "palm-400",
    # Status
    "success-bg": "palm-50",
    "success-fg": "palm-600",
    "success-border": "palm-200",
    "warning-bg": "sun-50",
    "warning-fg": "sun-600",
    "warning-border": "sun-200",
    "danger-bg": "FBE9E1",
    "danger-fg": "ember-600",
    "danger-border": "ember-300",
    "info-bg": "E4F0F7",
    "info-fg": "sky-500",
    "info-border": "sky-300",
    # Rarity accents
    "rarity-common": "coconut-400",
    "rarity-uncommon": "palm-400",
    "rarity-rare": "sun-300",
}

# Semantic DARK overrides — the `[data-theme="dark"]` block of the CSS.
# Tokens absent here (brand-*, focus-ring, rarity-*) keep their light value,
# exactly as the cascade leaves them untouched in the browser.
_SEMANTIC_DARK: dict[str, str] = {
    # Surfaces
    "bg-app": "husk-400",
    "bg-surface": "husk-200",
    "bg-surface-2": "husk-100",
    "bg-sunken": "husk-500",
    # Foreground / text
    "fg-1": "sand-50",
    "fg-2": "sand-200",
    "fg-3": "sand-400",
    "fg-on-primary": "husk-500",
    "fg-on-dark": "sand-50",
    "fg-link": "sun-300",
    # Borders
    "border-1": "husk-50",
    "border-2": "coconut-500",
    "border-strong": "coconut-400",
    # Status backgrounds — the CSS declares these as rgba() washes over the
    # page, but reportlab/openpyxl need solid ink, so each is that rgba
    # composited over the dark `bg-surface` (husk-200). `test_palette.py`
    # recomputes the composite from the CSS so these can't drift either.
    "success-bg": "2F3624",
    "success-fg": "palm-200",
    "success-border": "palm-500",
    "warning-bg": "463D26",
    "warning-fg": "sun-200",
    "warning-border": "sun-500",
    "danger-bg": "453127",
    "danger-fg": "ember-300",
    "danger-border": "ember-500",
    "info-bg": "34393A",
    "info-fg": "sky-300",
    "info-border": "sky-500",
}

#: Themes an export can render in. Light is the default everywhere — the
#: binder/checklist/set-cards PDFs are print artifacts, so dark is opt-in.
THEMES = ("light", "dark")

_ACTIVE_THEME: ContextVar[str] = ContextVar("mgz_pkmn_palette_theme", default="light")


def current_theme() -> str:
    """Return the theme `hex()`/`rgb01()` currently resolve against."""
    return _ACTIVE_THEME.get()


@contextmanager
def use_theme(theme: str) -> Iterator[None]:
    """Resolve palette tokens against `theme` for the duration of the block."""
    if theme not in THEMES:
        raise ValueError(f"theme must be one of {THEMES}, got {theme!r}")
    token = _ACTIVE_THEME.set(theme)
    try:
        yield
    finally:
        _ACTIVE_THEME.reset(token)


# Composed brand element: the export header band. The light-wordmark logo
# (logo-dark.png) and `fg-on-dark` text sit on this. Deep frond green reads as
# tropical and gives the printed page a brand anchor — the in-brand successor
# to the old dark-slate band. Pinned to a raw token so the parity test still
# covers it.
HEADER_BAND = "palm-600"


def hex(token: str) -> str:
    """Return the ``"RRGGBB"`` hex for a semantic or raw token name.

    Accepts CSS-style names (`"brand-secondary"`, `"fg-1"`, `"palm-600"`),
    resolved against the active theme (see `use_theme`). Raises KeyError on
    an unknown token so a typo fails loudly."""
    if _ACTIVE_THEME.get() == "dark" and token in _SEMANTIC_DARK:
        value = _SEMANTIC_DARK[token]
        return _RAW.get(value, value)
    if token in _SEMANTIC:
        value = _SEMANTIC[token]
        return _RAW.get(value, value)
    return _RAW[token]


def rgb01(token: str) -> tuple[float, float, float]:
    """Return a reportlab-style ``(r, g, b)`` triple in 0-1 for a token."""
    h = hex(token)
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]
