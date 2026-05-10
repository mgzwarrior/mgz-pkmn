# Roadmap

[![v1.0 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/1?label=v1.0)](https://github.com/mgzwarrior/mgz-pkmn/milestone/1)
[![open issues](https://img.shields.io/github/issues-raw/mgzwarrior/mgz-pkmn?label=open)](https://github.com/mgzwarrior/mgz-pkmn/issues)
[![closed issues](https://img.shields.io/github/issues-closed-raw/mgzwarrior/mgz-pkmn?label=closed)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aissue+is%3Aclosed)

A working backlog of what shipping a polished **V1** looks like, where the
project goes after that, and a parking lot of bigger speculative ideas.
Items live on GitHub as issues, labels, milestones, and projects — this
document is the navigator.

## Versioning policy

- **V1** (`1.0.0`) — **committed**. A defensible 1.0 with no obvious
  gaps. Polish, tests, docs, basic release engineering. Tracked on the
  [v1.0 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/1).
- **V2** — **committed**. Deeper development per area. Tracked per-area
  on GitHub Projects (links below).
- **V1.x / Post-V1** — **committed but later**. Items that are best done
  *after* the 1.0 cut (the announcement, the contributor-comms refresh)
  rather than blocking it.
- **V3 and beyond** — **proposed**. Big ideas (paid features, vendor
  portal, marketplace integrations) that need community input before
  any commitment. Subject to redirection.

## Project areas

The codebase splits cleanly into five areas. Each has its own GitHub
Project for tracking V1 + V2 work, plus an auto-updating open-issues
badge below.

| Area | Owns | Project | Open |
|---|---|---|---|
| **Lookup engine** | Parse user input, resolve cards across data sources, attach pricing. ([`parser.py`](../src/mgz_pkmn/parser.py), [`lookup.py`](../src/mgz_pkmn/lookup.py), [`sources/`](../src/mgz_pkmn/sources/), [`pricing.py`](../src/mgz_pkmn/pricing.py)) | [#6](https://github.com/users/mgzwarrior/projects/6) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Alookup?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Alookup) |
| **Output artifacts** | Render rows into spreadsheet / PDFs / checklist / JSON. ([`spreadsheet.py`](../src/mgz_pkmn/spreadsheet.py), [`binder.py`](../src/mgz_pkmn/binder.py), [`checklist.py`](../src/mgz_pkmn/checklist.py), [`report.py`](../src/mgz_pkmn/report.py)) | [#7](https://github.com/users/mgzwarrior/projects/7) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Aoutputs?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Aoutputs) |
| **Cache & persistence** | Disk cache for API responses + URL overrides; (V2) multi-user storage. ([`cache.py`](../src/mgz_pkmn/cache.py)) | [#8](https://github.com/users/mgzwarrior/projects/8) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Acache?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Acache) |
| **Web UI / API** | FastAPI service + React SPA. ([`api/`](../api/), [`web/`](../web/)) | [#9](https://github.com/users/mgzwarrior/projects/9) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Aweb?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Aweb) |
| **DevOps & release** | CI, deployment, packaging, distribution, security, governance. | [#10](https://github.com/users/mgzwarrior/projects/10) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Adevops?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Adevops) |

---

## V1 — committed

What needs to land before tagging `1.0.0`. Most are polish or filling
known gaps. The goal of V1 is *defensible*, not *new*.

### Lookup engine

- Apply inline price filters to single-card lookups, or warn when
  ignored.
- Distinguish `>` from `>=` (and `<` from `<=`) in the comparator
  parser.
- Currency-aware price filtering — at minimum loud documentation of
  the existing currency-blind behavior; ideally gating by currency.
- Wrap PriceCharting scrape failures in a structured `MatchResult`
  rather than letting the `requests.HTTPError` surface raw.
- Regression test covering the word-boundary post-filter so `top 4
  Mew` never re-introduces Mewtwo.

### Output artifacts

- Add `summary.sort_mode` to the JSON report so consumers know the
  ordering used.
- Document (or fix) the `--no-images` divergence between CLI exports
  and Web-UI-driven exports.
- Tighten checklist truncation tests with a long-name fixture.
- New `--print-summary-only` CLI mode for input iteration.
- `make refresh-examples` target to keep the tracked
  [`output/`](../output/) artifacts current.

### Cache & persistence

- Show cache hit rate in the CLI summary line.
- Soft-warn when the cache directory exceeds 50 MB.
- Versioned schema for `url_overrides.json` (`{schema_version: 1, …}`).
- `pkmn cache stats` subcommand printing size, oldest entry, override
  count.
- Document the `MGZ_PKMN_NO_CACHE` env var (exists in code, missing
  from docs).

### Web UI / API

- Add a `LICENSE` file at the repo root (cross-listed with DevOps —
  hard blocker for any release).
- API tests for `/parse`, `/lookup`, `/sets`, `/overrides` (currently
  only `/export` is covered).
- Vitest setup + smoke tests per web component.
- Error boundary in the SPA so a render failure shows a message
  instead of a blank page.
- "Restore defaults" button in `SettingsDrawer` (escape hatch from a
  weird state).
- Surface the `--dedupe` toggle in the UI (settings type has the
  field; no control to flip it).
- **Column filtering / sorting in the results table.** Click a column
  header to sort; per-column filter inputs to narrow.
- **Improved loading state** during a lookup so users have visible
  proof the API is working — progress count, animated rows, or a
  per-line status indicator.

### DevOps & release

- `LICENSE` file at the repo root (likely MIT given the project's
  framing). Cross-listed with Web UI / API.
- GitHub issue + PR templates under `.github/ISSUE_TEMPLATE/` (bug,
  feature, docs, plus a generic PR template).
- `CHANGELOG.md` seeded with entries for everything between `0.1.0`
  and the upcoming `1.0.0`. Going forward, every PR adds an
  `[Unreleased]` entry.
- Polish `pyproject.toml` metadata for PyPI release (`description`,
  `keywords`, `classifiers`, `urls` — current description doesn't
  even mention the PDF / checklist / web UI).
- Confirm Render + Docker recipes still work post-restructure.
- **GitHub Sponsors button.** `.github/FUNDING.yml` with a sponsor
  username so the "Sponsor" button appears on the repo. Last item
  before the V1 release goes out.
- **Logo + social preview.** A small logo for the README header and a
  1280×640 social preview image set under repo Settings → Social
  preview. Improves shareability when the repo gets linked.
- **Security policy + Dependabot.** `SECURITY.md` covering disclosure
  process, plus `.github/dependabot.yml` and the GitHub Advanced
  Security toggles (secret scanning, code scanning, dependency
  graph).
- **AI-agent scaffolding.** A top-level `AGENTS.md` (or
  `CLAUDE.md`) plus a `.cursorrules` / similar that orients AI
  assistants to the repo's conventions: dataclass-driven layouts,
  pure-function writers, single `Row` shape, signed commits, doc
  cross-link conventions, tests-first for behavior changes.

---

## V1.x — committed but post-release

Items best done *after* the 1.0 cut so they can lean on the existence
of a stable release.

### DevOps & release

- **Announce 1.0 via GitHub Discussions.** Enable Discussions, post an
  Announcement category thread describing what the project is and what
  shipped in 1.0.
- **Refresh the contributing guide and start a contributors discussion.**
  Update [`docs/contributing.md`](contributing.md) with concrete
  starter-issue patterns. Open a Discussion thread inviting community
  contributions and explicitly encouraging AI-assisted development —
  the [AGENTS.md scaffolding](#devops--release) makes that supportable.

---

## V2 — committed

Deeper development per area. The kind of work that takes more than an
afternoon, has design tradeoffs worth talking through, and benefits from
its own GitHub issue + PR thread.

### Lookup engine

- Structured query DSL (`top:N subtype:V,VMAX in "Surging Sparks"
  rarity:rare>=$50`) — replace the flavor-text fallback with real
  semantics.
- eBay sold-listings as a fourth price source (opt-in via `--ebay`).
- Cache TCGdex responses too (today only pokemontcg.io is cached).
- Surface ambiguity in the JSON report
  (`"alternatives": [{...}]`) instead of silently picking one.
- Pluggable name aliases — `top 5 ナッシー` works as well as
  `top 5 Exeggutor`.
- Public `parse_lines(text) → list[CardQuery]` for downstream tools.

### Output artifacts

- Configurable comp tiers via `--comps 70,80,90`.
- Per-section charts in xlsx (price-distribution, top-N).
- HTML output mode for sharing a wishlist by URL.
- Custom binder layouts via TOML config (user-supplied
  `BinderLayout` instance without editing Python).
- Color-coded rarity in xlsx.
- Skip-already-owned mode (filters binder + checklist against a
  user-supplied "what I own" list).
- **Expanded PDF design customization.** Per-page-size presets
  (A4, A5, custom), per-cell border/background controls, optional
  watermark, configurable card-art aspect / rotation, branded header
  bar.

### Cache & persistence

- LRU eviction with size cap (`MGZ_PKMN_CACHE_MAX_MB`, default 100).
- `pkmn cache compact` subcommand (re-encodes, drops corrupt
  entries).
- TTL per source (pokemontcg.io stable; PriceCharting volatile).
- `pkmn cache warm input/` — pre-populate the cache before a
  show with spotty Wi-Fi.
- SQLite cache option (queryable history) — opt-in; default JSON
  store stays.
- **Multi-user persistent collections.** Promote the disk cache to a
  full database (PostgreSQL or SQLite-with-Alembic) so deployed
  instances can track per-user collections, wishlists, and run
  history. Backwards-compatible: single-user CLI keeps the
  filesystem path; the API gains `/collections` endpoints.

### Web UI / API

- Persistent run history with sidebar diff/re-export.
- Drag-and-drop `.txt` upload onto the editor.
- Inline edit + re-run for unmatched rows.
- Authentication for hosted instances (API keys, per-key rate
  limits).
- Mobile-responsive layout + a11y audit (axe-core in CI).
- OpenAPI client codegen (`@mgzwarrior/mgz-pkmn-client` published
  from the FastAPI schema).

### DevOps & release

- PyPI publish on `v*` tag (Trusted Publisher).
- Docker image to GHCR on tag.
- Standalone PyInstaller binaries (macOS / Linux / Windows) on
  releases.
- Homebrew tap: `brew install mgzwarrior/tap/mgz-pkmn`.
- Conventional Commits + auto-generated release notes.
- Coverage reporting (Codecov) with a hard threshold on PRs.

---

## V3 and beyond — proposed (not committed)

Speculative directions, especially the ones that might justify a paid
or hosted offering. Filed as ideas, not commitments. Items here are
welcome to grow, shrink, or get killed entirely based on community
feedback before any of them become committed work.

### Vendor / power-user portal

A separate persona from the personal-prep tool: someone who *runs* a
booth, not just attends one.

- **Bulk card recognition.** Camera or upload-based image recognition
  to identify cards in bulk (set, number, condition hints) and
  populate inventory. Pairs with Multi-user persistent collections.
- **Booth inventory tracking.** Per-show, per-binder, per-card
  movement: what was on the table at the start of a show, what sold,
  for how much, and what came home.
- **Buy-list optimization.** Given a budget and a target inventory,
  recommend which cards to acquire (and at what price) to maximize
  margin or fill a customer's wishlist.
- **Grading advisor.** PSA / BGS / CGC price spread analysis,
  sub-grade prediction heuristics, a "is it worth grading?" decision
  tool. Conservative — no claim to professional grading.
- **Marketplace integrations.** One-click eBay / TCGPlayer listing
  generation from a binder, with pre-filled titles, prices, and
  photos drawn from the existing card art and pricing pipeline.
- **Public showcase pages.** Publish a binder as a clean URL for
  sharing — pretty rendering, optional contact form for offers, no
  login required for visitors.
- **Trade-matching.** Connect users with opposite halves of a trade
  (you have what they want, they have what you want) inside a single
  hosted instance. Zero-friction discovery; out-of-band negotiation.

### Other speculative ideas

- **Mobile app** wrapping the existing API — quick lookup + photo
  recognition on the floor of a show.
- **Browser extension** that scrapes a TCGPlayer / eBay listing into
  the same format, for cross-checking prices.
- **Discord / Slack integration.** Slash commands for `/lookup`
  inside a chat channel.
- **Predictive pricing.** Time-series modeling on cached price data
  to flag overpriced cards or anticipated price moves. Honesty
  required: this is hard and easy to mislead with.

---

## How this list becomes work

Each item under V1 / V1.x / V2 is filed (or about to be filed) as a
GitHub issue with two labels: an **area** label
(`area:lookup` / `area:outputs` / `area:cache` / `area:web` /
`area:devops`) and a **version** label
(`version:v1` / `version:v1.x` / `version:v2`). V1 issues additionally
sit on the [v1.0 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/1).

V3+ items stay in this document until/unless they get promoted to
committed work. The "proposed" tag is load-bearing: items can be
challenged, refined, or removed without anyone having to close a
GitHub issue.

New ideas land here as a draft proposal first — open a PR against
this file. After review, the agreed items get filed as issues with
the right labels and project assignment.
