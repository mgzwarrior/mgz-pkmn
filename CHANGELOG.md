# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Web: **Lookup timer** — a new **Show lookup timer** toggle in the
  settings drawer (off by default) surfaces wall-clock elapsed time
  during a bulk run: a live ticking clock under the **Look up** button
  while a run is in flight, a final
  `total · count · ms/card` summary after it finishes, and a
  per-input-line elapsed-ms badge in the processing queue. Timing is
  measured frontend-side from the first SSE event to the done event so
  the number reflects user-felt latency (network + SSE overhead
  included). New [docs/benchmarks.md](docs/benchmarks.md) lists
  expected ranges for the workloads users hit most often, and the bug
  report template carries an optional **Performance** section linking
  back to it.
- Web: **Card detail modal** — tapping any matched row in the results table
  opens a modal with the large card art, a two-column identity + pricing
  block (market + 80/85/90/95% comps), and a "card data" section that
  surfaces whatever optional fields the source returned (subtype, HP,
  attacks with cost/damage/text, weaknesses, resistances, retreat,
  regulation mark, artist, dex numbers, flavor text). Missing fields are
  silently skipped. Direct link out to the canonical source page
  (TCGPlayer / Cardmarket / PriceCharting / pokemontcg.io fallback). ←/→
  steps through the currently filtered + sorted result set; Esc closes.
  Clicking an inner link or button (existing external-link icon, the
  override-URL form) does not open the modal. Dialog a11y handled by
  Radix.
- CLI: `pkmn cache warm-concepts` subcommand walks every distinct name
  referenced by the curated `_CONCEPT_KEYWORDS` dictionary and primes the
  API response cache for each one, so concept lookups (`top 9 puppy`,
  `all eeveelution cards`, …) resolve from cache on subsequent runs
  instead of fanning out to N upstream calls. Accepts `--source
  pokemontcg|tcgdex|all` (default `all`: walk pokemontcg.io first and fall
  back to TCGdex on miss) and `--verbose` to print each name as it warms.
  Writes a manifest at `concept_warm.json` in the cache root with a
  timestamp + count.
- API: opt-in `MGZ_PKMN_WARM_ON_STARTUP=1` env var triggers the same warm
  pass on FastAPI startup, running on a background daemon thread so
  startup isn't blocked. Gated by the manifest's 24-hour freshness window
  so `uvicorn --reload` cycles and tight redeploys don't thrash.
- Stats: `pkmn cache stats` surfaces a new **Concepts** line — "N names ·
  warmed <age>" when a warm pass has landed, "not warmed" otherwise.

## [1.1.1] - 2026-05-25

### Fixed

- README: the project logo now renders on the
  [PyPI description tab](https://pypi.org/project/mgz-pkmn/#description).
  The prior `<img src="assets/logo.svg">` relative path 404'd on PyPI
  (the README is rendered standalone, with no repo-relative context);
  switched to an absolute `raw.githubusercontent.com` URL.

## [1.1.0] - 2026-05-25

### Added

- CLI: `pkmn cache clear` subcommand wipes the API response cache
  without forcing you to run a lookup. URL overrides and the
  indefinite-TTL image cache are preserved (they take real effort to
  populate); the on-disk wipe is the same one `pkmn lookup --clear-cache`
  performs. Honoured even when `MGZ_PKMN_NO_CACHE=1` is set — explicit
  wipe wins over implicit skip.
- Web: **Set picker modal** for the Set ID cards export. Clicking
  **Set ID cards…** in the Export dropdown now opens a picker that
  groups every set by series **newest → oldest** (modern blocks like
  Scarlet & Violet sit at the top; the original Base set is at the bottom),
  shows each set's cached logo + name + year + total, and lets the
  user multi-select with **Select all / Select none / Expand all /
  Collapse all / Select series** buttons. Each series is a collapsible
  section so the 173-entry catalog stays scannable; the header shows a
  per-series selection count (`(2/18)`) once anything in it is picked.
  Selection persists across reloads (Zustand). Submitting the modal
  downloads a PDF containing only the chosen sets — exactly the same
  path the new CLI flag uses on the backend. Logo thumbnails come from
  the new `GET /api/v1/sets/{set_id}/logo` endpoint, which streams
  images out of the unified disk cache populated by `pkmn cache warm-sets`.
- API: new `GET /api/v1/sets/{set_id}/logo` endpoint serves cached set
  logos with a 30-day immutable browser cache. 404 with a "run
  `pkmn cache warm-sets`" hint when the set hasn't been warmed yet, so
  the SPA can fall back gracefully and tell the user how to fix it.
- API: `GET /api/v1/set-cards.pdf` accepts a repeatable `set_ids` query
  param to restrict the output to specific sets. Unknown ids return
  404 instead of an empty PDF so the SPA surfaces a clear error.
- CLI: new `pkmn set-cards --set <id>` flag (repeatable, also `-s`) —
  the same picker filter is reachable from the terminal. Unknown ids
  fail loudly as a `ClickException` rather than producing an empty
  PDF.
- CLI: new `pkmn cache warm-sets` subcommand walks every Pokémon TCG set
  and pre-downloads each set's logo + symbol into the unified disk image
  cache. Cold warm is a single up-front cost (~30 s on a fresh install,
  173 sets / 346 images / ~19 MB); subsequent `pkmn set-cards` runs and
  every `/api/v1/set-cards.pdf` request serve images from cache instead of
  the network. Second warm pass is 0.2 s — already-cached entries
  short-circuit.
- Cache: new indefinite-TTL image slice under `cache/images/<category>/`
  (today: `sets/logo`, `sets/symbol`; tomorrow: card art). Survives
  `clear_api_cache()` so wiping stale API payloads no longer re-downloads
  tens of megabytes of stable artwork. `pkmn cache stats` surfaces the
  slice on its own line so the on-disk cost is always visible.
- API: new `GET /version` endpoint returns
  `{"version": "<current __version__>"}` for deploy verification,
  monitoring, and SPA footer version display.
- CLI: `pkmn cache path` prints the cache root as a bare path for shell
  composition.
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

- Outputs: `pkmn set-cards` and `/api/v1/set-cards.pdf` now resolve set
  logo images through the unified disk image cache instead of a bespoke
  per-output `logos_dir`. The CLI's `--logos-dir` flag still works as a
  sidecar mirror for users who want a writable directory alongside the
  PDF, but the cache itself (under `cache/images/sets/`) is now the
  source of truth. The API route's hard-coded `~/.cache/mgz-pkmn/set-logos`
  path is gone — both surfaces share the same cache.
- Outputs: `fetch_all_sets()` now routes the pokemontcg.io set catalog
  through the existing API disk cache, so repeated `pkmn set-cards`
  invocations within a week reuse the cached catalog (~61 KB) instead of
  re-fetching the full list.
- CI: the `api` job now runs tests under `coverage` (via `pytest`,
  which discovers the existing `unittest.TestCase` suites unchanged)
  and uploads both `coverage.xml` and `junit.xml` to
  [Codecov](https://codecov.io/gh/mgzwarrior/mgz-pkmn) once per run
  (gated on the 3.13 matrix entry) — coverage via `codecov-action@v5`,
  test results via `test-results-action@v1` for failure analytics and
  flake detection. New `make coverage` target reproduces the same flow
  locally with terminal + HTML reports (`htmlcov/index.html`). Codecov
  badge added to the README header.
- CI: the `web` job now runs vitest with `@vitest/coverage-v8` and
  uploads `coverage/lcov.info` + `junit.xml` to Codecov under the
  `web` flag, mirroring the `api` job. The dashboard now tracks both
  suites separately.
- CI: Codecov config landed at [`codecov.yml`](codecov.yml). PRs now
  get a richer comment (project + patch coverage, flag and component
  breakdowns) and `codecov/project` + `codecov/patch` status checks,
  all set to `informational: true` — they post coverage deltas on
  every PR but never block merging. Six components are tracked
  individually (lookup, outputs, CLI, cache, API routes, web SPA) so
  the dashboard surfaces where coverage shifts are happening. Hard
  thresholds intentionally deferred until baseline stabilizes.
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

### Fixed

- Web: the export controls now always render as a single "Export"
  dropdown, with the matched-row count shown at the bottom of the
  menu. Previously the row count appeared beneath a row of buttons
  after a successful run, which pushed the Export controls out of
  alignment with the other header buttons.

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

[Unreleased]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/mgzwarrior/mgz-pkmn/releases/tag/v0.1.0
