# ADR 0005: ReportLab + `BinderLayout` dataclass for PDF presets

- **Status:** Accepted
- **Date:** 2026-05-09
- **Tags:** pdf, output, layout

## Context

The binder PDF is the most layout-sensitive output the tool produces.
Cells need consistent geometry across pages and language banners, the
caption block has eight lines that all need to be readable at print
sizes, and CJK names have to render as glyphs (not tofu blocks) when
they appear. The same drawing logic now serves two presets:

- **Standard** — 3×3 grid, 9 cards per page, sized so cells print and
  slip into 9-pocket binder pages as physical placeholders.
- **Condensed** — 6×4 grid, 24 cards per page, same caption block,
  packed denser for visual scanning.

Future presets are likely (4×4 for cards-with-larger-art, A4 paper, a
"contact sheet" mode for inventorying, …), so the layout has to be
parameterizable without forking the drawing code.

## Decision

- **Renderer:** [ReportLab](https://www.reportlab.com/opensource/) for
  the canvas, image embedding, CID font registration, and shape
  primitives. The CJK fonts (`HeiseiKakuGo-W5`, `STSong-Light`,
  `HYSMyeongJo-Medium`) ship as built-in CID font metadata — no font
  files need to be vendored, and ReportLab handles glyph substitution
  via the PDF reader.
- **Layout shape:** a frozen `BinderLayout` dataclass holds every knob
  that varies between presets (margins, header band, cols, rows,
  gutter, image scale, caption leading + font sizes, language banner
  sizing, image target / quality). Two preset instances live in
  [`src/mgz_pkmn/binder.py`](../../src/mgz_pkmn/binder.py):
  `STANDARD_LAYOUT` and `CONDENSED_LAYOUT`.
- All drawing functions take a `layout: BinderLayout` argument and read
  every constant from it. Module-level constants are limited to truly
  invariant values (US Letter page size, the 2.5/3.5 card aspect
  ratio, the eight comp / caption lines, the language-label table).

Adding a new preset is a single `BinderLayout(...)` call — no changes
to drawing code.

## Consequences

- Two visually-distinct PDFs share one set of drawing functions. Bugs
  fixed in one preset are fixed in both automatically.
- The dataclass is `frozen=True`, so a preset is immutable once
  declared — no accidental mutation across pages.
- Adding a preset requires picking ~17 numbers (margin, gutter, image
  scale, …). The two existing presets are reasonable starting points.
- ReportLab's API is imperative (saveState / setFont / drawString) and
  not particularly cheerful. The drawing layer stays in
  [`binder.py`](../../src/mgz_pkmn/binder.py) so callers don't have to
  see it.
- CJK glyphs render correctly in both presets because the font picker
  consults the *script of the actual name* (not the language tag),
  which can sometimes be mistakenly `en` for cards carrying katakana.

## Alternatives considered

- **WeasyPrint / wkhtmltopdf.** HTML-driven PDF rendering. Better for
  flowing layouts (text-heavy reports), worse for the precise geometric
  control a 3×3 binder needs. Image embedding is also fussier.
- **fpdf2.** Lighter dependency than ReportLab, but no CID Asian font
  shipping — we'd have to vendor a CJK font file (~3 MB), inflate the
  install footprint, and handle script detection ourselves.
- **A single layout with conditionals.** What we replaced. Worked for
  one preset; adding the second would have meant `if condensed: ...`
  branches scattered through every drawing function. The dataclass
  shape pulls all that variability into one place.
