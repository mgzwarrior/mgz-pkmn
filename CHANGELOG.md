# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- CLI: `pkmn cache stats --json` now emits the cache health snapshot
  with snake_case keys for scripts and monitoring.
- Web: onboarding help surface. A new **Help** button in the header
  opens a modal covering what the tool does, how to write queries
  (with copyable examples), each setting, each export format, and
  keyboard shortcuts. First-time visitors see a subtle pulse on the
  button, dismissed once the modal is opened. The modal also offers
  an optional interactive **tour** that walks through the five main
  UI sections (card list, look-up button, settings, results, exports)
  with a glowing ring on each step's target.
- Web: empty-state under the card-list input now shows a row of
  example query chips covering the parser's main formats (explicit
  set + number, name + set, bulk `top:N`, `All …` bulk, variant
  hint, price bounds, etc.). Clicking a chip inserts the example
  and runs the lookup so first-time users get an immediate
  on-ramp.
- New `make dev` target rebuilds the single-image Docker artifact
  (API + built SPA) and runs it on `:8000`. One terminal, one
  Ctrl+C, no two-window juggling — at the cost of no hot reload,
  so it's intended for smoke runs and demos rather than the inner
  edit/reload loop. `make dev-api` and `make dev-web` continue to
  cover active development.
- [`docs/accessibility.md`](docs/accessibility.md) — single home for
  what the project commits to (no critical/serious axe violations,
  WCAG AA contrast, full keyboard reach), how it's enforced
  (vitest-axe in CI + a live-browser scan snippet), the keyboard
  shortcut table, and how to add new UI without regressing.

### Changed

- Web: header is now mobile-friendly. On screens below `sm` (640 px)
  the five export buttons collapse into a single **Export** dropdown,
  and the **Help** / **Settings** buttons render as icon-only. The
  settings drawer takes the full viewport width on mobile so the
  sort-order select and helper text no longer truncate. Desktop
  layout is unchanged.
- Web: accessibility pass against axe-core. Closes the a11y half of
  #62 — zero critical or serious violations across the idle page,
  open Help modal, open Settings drawer, populated results table,
  and expanded filter row. Bumped muted text from `text-zinc-500` /
  `text-zinc-600` to `text-zinc-400` so helper copy, section
  headings, and the footer meet WCAG AA contrast. Added an `<h1>`
  inside the header so the page has a top-level heading. Gave the
  Settings drawer close button an `aria-label`, every empty
  results-table header cell `sr-only` labels (column header row +
  filter row, including the four comp-tier columns), and the
  card-list textarea an `aria-label`. Made the Help modal's
  scrollable body keyboard-focusable so users can scroll without
  first tabbing through every dialog control.

## [1.0.1] - 2026-05-16

### Added

- Release workflow now publishes the built sdist + wheel to
  [PyPI](https://pypi.org/project/mgz-pkmn/) on every `v*` tag using
  trusted publishing (OIDC, no stored token). The GitHub Release notes
  link to the newly published PyPI version. Trusted-publisher wiring
  documented in [docs/contributing.md](docs/contributing.md#pypi-trusted-publisher-wiring).
- Marketing site under `site/`: Astro 5 + Tailwind 4, single landing
  page (hero, features, how-it-works, roadmap teaser, footer),
  designed to deploy to Cloudflare Pages on a custom domain. New
  `make install-site` / `make dev-site` / `make build-site` targets;
  CI `site` job verifies the build on every PR. Rationale in
  [ADR-0011](docs/adr/0011-marketing-site-stack.md).

## [1.0.0] - 2026-05-15

### Added

- Web: per-input-line status panel during bulk lookups — each card line
  starts as pending (blue spinner), then transitions to resolved (green
  check) or error (amber alert) as its first lookup event arrives.
  New result rows fade in to make streaming visible.
- Web: "Restore defaults" button in the settings drawer footer that resets
  all settings (API key, tag, sort, max price, dedupe, hide images) to
  their initial values.
- Web: exports now honor the **Deduplicate by card ID** setting — toggling
  it before clicking an export button drops matched rows that share a card
  ID with an earlier row, matching the CLI's `--dedupe` behavior.
- Web: click any sortable column header (Name, Set, Rarity, Market,
  Source) in the results table to cycle through ascending → descending
  → off. A new **Filter** toggle reveals per-column inputs: substring
  match for text columns and min/max range for Market. View-only —
  exports continue to honor the sort mode in Settings.
- Project logo SVG and 1280×640 social preview (rendered PNG checked in
  for upload to GitHub repo settings). Logo appears at the top of the
  README and in the web app header.

## [0.1.0] - 2026-05-08

Foundation release. Establishes the full CLI pipeline, a FastAPI/React web
UI, multi-source card lookup, all output formats, and release infrastructure.

### Added

#### CLI
- `pkmn lookup` command: parses a card list, looks up each card across open
  data sources, downloads images, and writes an `.xlsx` with embedded
  thumbnails, market price, and 80/85/90/95% negotiation comps.
- `pkmn set-cards` command: generates printable set ID cutouts (no input
  list needed).
- `--pdf` / `--condensed-pdf` flags for standard 3×3 and condensed 6×4
  PDF binder layouts.
- `--checklist` flag for a printable per-tag checklist PDF.
- `--report-json` flag for a structured JSON report (summary, per-tag
  aggregates, highlights, full row data).
- `--dedupe` flag to collapse duplicate input lines before lookup.
- `--max-price` filter with per-currency awareness and amber highlight for
  above-cap rows in the spreadsheet.
- `--sort` flag with multiple sort modes applied before any output is written.
- `--print-summary-only` mode to emit the run summary without writing output
  files.
- Inline per-card price conditions on bulk lookups (`>=`, `<=`, `>`, `<`).
- Bulk / "top-N" lookup syntax: `top:5 Charizard cards`,
  `all Pikachu prints`.
- Multi-language card support via language tokens (`japanese`, `korean`, etc.)
  in input lines.
- Disk cache (`DiskCache`) for API responses; `pkmn cache stats` subcommand.
- `MGZ_PKMN_NO_CACHE` env var to bypass cache for a run.
- Cache soft-warn when on-disk size exceeds 50 MB; hit-rate shown in
  CLI summary.
- Versioned schema for `url_overrides.json`.
- Public `parse_lines()` API and `CardQuery` export from the package.

#### Multi-source lookup
- **pokemontcg.io** (primary): English/international cards with TCGPlayer
  (USD) and Cardmarket (EUR) prices.
- **TCGdex** (multilingual fallback): `en`, `ja`, `ko`, `zh-tw`, `zh-cn`,
  `de`, `fr`, `es`, `it`, `pt`, and more; includes Cardmarket prices.
- **PriceCharting** (opt-in via URL): region-exclusive products; returns USD
  loose/new/graded prices.
- Set-overlap scoring and name-clause heuristics for candidate ranking.
- `MatchResult` wraps scrape failures so callers get structured error info
  rather than bare exceptions.

#### Web UI
- FastAPI backend (`api/`) with `/lookup`, `/parse`, `/sets`, and
  `/overrides` routes; full test coverage for all routes.
- React + Vite frontend (`web/`) with streaming results, settings drawer,
  one-click export, and an `ErrorBoundary` around the SPA root.
- SPA served with `Cache-Control: no-cache` to prevent stale asset delivery.

#### Outputs
- `.xlsx` with frozen header row, per-column widths, embedded card thumbnails,
  currency-aware number formatting, and a totals footer row.
- Summary `sort_mode` field included in the JSON report.
- `make refresh-examples` target to regenerate tracked output artifacts.

#### Infrastructure
- GitHub Actions CI: lint + format check + full test suite on Python 3.11,
  3.12, and 3.13; ESLint + TypeScript build for `web/`; ruff lint for `api/`.
- Docker image with README copied into the build context.
- Render auto-deploy configuration (`render.yaml`).
- Dependabot config for Python, JS, and GitHub Actions dependencies.
- `SECURITY.md` and CodeQL scanning.
- MIT `LICENSE`.
- Pre-commit hooks: `ruff check --fix` + `ruff format` on every staged file.
- `pyproject.toml` metadata polished for future PyPI publish.
- GitHub Sponsors `FUNDING.yml`.

#### Documentation
- `README.md` with install, quickstart, API key setup, and feature overview.
- `docs/cli.md` with full CLI reference and worked examples.
- `docs/contributing.md` with project layout, branch naming, PR process,
  and CI/release notes.
- `AGENTS.md` with code conventions and invariants for AI coding agents.
- `CLAUDE.md` with contributor workflow guidance for Claude Code.
- `SECURITY.md` with vulnerability disclosure policy.
- ADR index under `docs/adr/` capturing key architectural decisions.
- Roadmap in `docs/roadmap.md` linked to GitHub issues.
- Issue and PR templates.

### Fixed
- ReDoS vulnerabilities in parser regexes (polynomial backtracking on
  adversarial input eliminated across multiple passes).
- Incomplete URL substring sanitization (CodeQL alerts).
- Workflow permissions hardening (CodeQL alerts).

[Unreleased]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/mgzwarrior/mgz-pkmn/releases/tag/v0.1.0
