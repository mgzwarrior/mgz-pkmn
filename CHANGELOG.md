# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
  README.

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

[Unreleased]: https://github.com/mgzwarrior/mgz-pkmn/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mgzwarrior/mgz-pkmn/releases/tag/v0.1.0
