# ADR 0026: Source export colors from a parity-tested tropical palette module

- **Status:** Accepted
- **Date:** 2026-06-09
- **Tags:** design, exports, branding, cli, api

## Context

The generated artifacts — the `.xlsx` workbook and the binder / condensed-binder / checklist / set-cards PDFs — were still wearing the pre-tropical zinc/blue brand. `spreadsheet.py` hardcoded slate `2C3E50` and blue `1F4E78`; the PDF writers painted a dark-slate header band (`branding.HEADER_PANEL_RGB`) and scattered raw `setFillColorRGB(0.1, 0.1, 0.1)`-style floats throughout; the packaged logo (`src/mgz_pkmn/assets/logo.png`) was the old blue mark, rasterized at the wrong aspect ratio. None of it came from the tropical design tokens that govern the web app and marketing site.

The canonical color source is `design/tokens/colors_and_type.css`. That file is CSS — not importable from Python — and the existing Tailwind `@theme` blocks in `web/` and `site/` are kept in sync with it by hand, with no automated check. So the exports had no clean way to consume the tokens, and any hand-copied hex would silently drift as the tokens evolved.

Two toolkits need color in different forms: reportlab wants 0–1 RGB float triples, openpyxl wants `"RRGGBB"` hex strings.

## Decision

Introduce `src/mgz_pkmn/palette.py` as the single Python mirror of the tokens' **light** semantic layer:

- It carries the raw palette (every `sun`/`palm`/`coconut`/`sand`/`husk`/`sky`/`ember` shade) and the semantic light tokens (`bg-*`, `fg-*`, `brand-*`, `border-*`, status colors), transcribed verbatim from `colors_and_type.css`.
- It exposes `hex(token)` and `rgb01(token)` so each writer pulls the form its toolkit needs.
- Every export writer and `branding.py` now reference palette tokens instead of literal colors. The PDF/xlsx header band is deep frond green (`palm-600`) carrying a light-wordmark logo variant; in-budget prices are `success-fg` green, over-cap states `warning`/`danger`, links `fg-link`, muted captions `fg-3`.

`tests/test_palette.py` parses `colors_and_type.css`, resolves its `var()` references, and asserts every value in `palette.py` matches. This closes the drift gap the hand-synced `@theme` blocks still have: a token edited in the CSS without a matching Python update fails CI.

The packaged logo is regenerated from the current `assets/logo.svg` preserving the real `285×88` viewBox aspect (fixing the stale `LOGO_ASPECT = 320/80`), and a `logo-dark.png` light-wordmark variant is added for the colored header band.

**Light theme only.** Dark-mode exports — and the marketing gallery switching its preview by site theme — are deferred to [#598](https://github.com/mgzwarrior/mgz-pkmn/issues/598). The print PDFs (binder / checklist / set-cards) are physical handouts where a dark, ink-heavy variant has no obvious use, so light is the right and only theme for now. `palette.py` is shaped so a dark token map and a theme selector can be added later without reshaping the writers.

## Consequences

- **One source of truth, enforced.** Export color now tracks the design tokens, and the parity test makes drift a build failure rather than a slow rot. The exports are the first surface with an automated tokens-parity guard; the `@theme` blocks could adopt the same pattern later.
- **No theme plumbing yet.** Writers read the light palette directly — no `--theme` flag, no API `theme` field, no per-call signature change. Adding dark (#598) will introduce those; callers built today won't need to change their call shape, only opt into a theme.
- **Two logo marks bundled.** `logo.png` (dark wordmark, light backgrounds) and `logo-dark.png` (light wordmark, the colored band). `branding.logo_bytes(variant)` selects between them; all current export consumers draw on the colored band and request `"on-dark"`.
- **Hex/px adherence stays reviewer-enforced.** As today, oxlint doesn't lint Python color literals; the parity test covers `palette.py`, and reviewers still guard against new raw hex creeping into the writers.
