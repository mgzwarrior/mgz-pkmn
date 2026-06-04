# Roadmap

[![v1.4 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/6?label=v1.4)](https://github.com/mgzwarrior/mgz-pkmn/milestone/6)
[![v1.5 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/8?label=v1.5)](https://github.com/mgzwarrior/mgz-pkmn/milestone/8)
[![v1.6 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/9?label=v1.6)](https://github.com/mgzwarrior/mgz-pkmn/milestone/9)
[![v2.0 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/3?label=v2.0)](https://github.com/mgzwarrior/mgz-pkmn/milestone/3)
[![v2.1 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/10?label=v2.1)](https://github.com/mgzwarrior/mgz-pkmn/milestone/10)
[![open issues](https://img.shields.io/github/issues-raw/mgzwarrior/mgz-pkmn?label=open)](https://github.com/mgzwarrior/mgz-pkmn/issues)

A forward-looking view of what's in flight and what's next. **Shipped
work is no longer enumerated here** — the [CHANGELOG](../CHANGELOG.md)
and the closed milestones own that record. The Versioning policy
section below gives a one-line summary per shipped version with a
link to its milestone for the full ledger; everything past V1.4 is
open work.

Items live on GitHub as issues, labels, milestones, and projects —
this document is the navigator. Every committed item below carries
its issue number for one-click navigation; speculative items don't
have issues yet.

For the end-user-facing project overview (features, "how it works",
live demo), see <https://mgz-pkmn.com>.

## Versioning policy

**Shipped (history; see [CHANGELOG](../CHANGELOG.md) for details):**

- **V1** (`1.0.0`) — 2026-05-15. Defensible 1.0; polish, tests, docs, release engineering. [v1.0 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/1).
- **V1.1** (`1.1.0`) — 2026-05-25. Set ID cards + web set-picker, marketing site, devex (PyPI, DCO, Codecov), a11y pass. [v1.1 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/2).
- **V1.2** — Marketing-site polish + late v1.1-cycle web UX. [v1.2 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/4).
- **V1.3** — Pre-Scrydex catalog-warm epic ([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)) + auth foundation ([#414](https://github.com/mgzwarrior/mgz-pkmn/pull/414)). [v1.3 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/5) · [v1.3.1 patch](https://github.com/mgzwarrior/mgz-pkmn/milestone/7).

**In flight / planned:**

- **V1.4** — **committed**. Hosted-demo auth UX (provider sign-in,
  Save-Search nudge, anonymous cache-only mode), CLI maintainability
  refactor, marketing polish. Tracked on the
  [v1.4 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/6).
- **V1.5** — **committed**. **eBay integration epic** — additive sold +
  active listings as a fourth pricing source via OAuth. Tracked on the
  [v1.5 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/8)
  under [`epic:ebay`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aebay).
- **V1.6** — **committed**. **TCGPlayer integration epic** —
  first-class TCGPlayer API replacing the embedded `tcgplayer` block
  from pokemontcg.io. Tracked on the
  [v1.6 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/9)
  under [`epic:tcgplayer`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Atcgplayer).
- **V2** — **committed (currently staging area)**. The v2.0 milestone
  on GitHub today aggregates structured query DSL, persistence MVP,
  identity sign-on, and assorted lookup/web/output improvements. Under
  strict semver — the trigger we've settled on — most of these are
  **additive** (new commands, new endpoints, new fields, new UI
  toggles) and could ship in the v1.x cadence without breaking
  existing users. The real **v2 cut trigger** is one of:
  1. **The plugin contract goes live** — the entry-point surface that
     [ADR-0012](adr/0012-open-core-architecture.md) requires for
     `mgz-pkmn-vendor` to register `pkmn vendor <subcommand>` becomes
     a public API. Adding it doesn't break existing users; promising
     compat on it does.
  2. **Hosted-demo identity becomes required** — anonymous lookups stop
     working on the demo. Doesn't affect the CLI, but materially
     changes the demo's product shape.

  The current [v2.0 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/3)
  serves as the staging area for the breakpoint-adjacent epics. Some
  of its items will likely ship earlier as v1.7/v1.8 minor releases
  once the cut criterion is firmer.
- **V2.1** — **committed**. **Persistence-at-growth epic** — post-MVP
  collections/wishlists scaling (Postgres / D1 / Turso spike, retention,
  per-user export, ops runbooks). Tracked on the
  [v2.1 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/10)
  under [`epic:persistence-growth`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Apersistence-growth).
- **V2.x / Post-V2** — **committed but later**. Currently themed around
  the **free / paid separation and monetization work** — once V2 is
  shipped, the project is mature enough to consider sustainable funding
  models. Free features stay free forever; paid features expand the
  vendor / power-user surface. See [ADR-0012](adr/0012-open-core-architecture.md)
  for the open-core split.
- **V3 and beyond** — **proposed**. Big ideas (vendor portal,
  marketplace integrations, multi-TCG expansion) that need community
  input before any commitment. The **vendor card-scanner** (see
  `epic:vendor-vision` placeholder) lives in this band, in the private
  `mgz-pkmn-vendor` repo per ADR-0012. Subject to redirection.

## How to read this roadmap

Every committed item below is filed as a GitHub issue, and every
issue carries the labels that let you filter the board to exactly what
you're looking for:

- **`area:*`** — which part of the codebase. One of `area:lookup`,
  `area:web`, `area:cache`, `area:outputs`, `area:site`, `area:devops`.
- **`type:*`** — what kind of change. One of `type:feature`,
  `type:bug`, `type:docs`, `type:chore`, `type:test`.
- **`version:*`** + **milestone** — when. The milestone is the source
  of truth; the label exists as a coarse filter that survives milestone
  renames.
- **`epic:*`** — which epic an issue belongs to, when it's part of one
  of the umbrella tracks (e.g. `epic:ebay`, `epic:query-dsl`,
  `epic:persistence-growth`). Each epic has a tracking issue with the
  full task list.
- **`specialty:*`** — what skill is most useful for picking it up. One
  of `specialty:frontend`, `specialty:backend`, `specialty:devops`,
  `specialty:security`, `specialty:data`, `specialty:design`. Pick
  whichever matches your background and filter the board to it.

A frontend contributor browsing v1.5 work can run
`is:open milestone:v1.5 label:specialty:frontend` to find their issues.
A security-minded contributor can pull `label:specialty:security` across
all open milestones. The combinations are meant to make self-serve
contribution easy without anyone having to triage by hand.

## Project areas

The codebase splits along the `area:*` labels. All work tracks on the
unified [`mgz-pkmn`](https://github.com/users/mgzwarrior/projects/11)
project, with a saved board view per area filtered by the matching
label. Each row below links to that area's view (or, when a saved view
isn't set up yet, to the project filtered by the label), plus an
auto-updating open-issues badge. See
[ADR-0010](adr/0010-unified-project-with-area-views.md) for the
rationale behind the single-project structure.

| Area | Owns | View | Open |
|---|---|---|---|
| **Lookup engine** | Parse user input, resolve cards across data sources, attach pricing. ([`parser.py`](../src/mgz_pkmn/parser.py), [`lookup.py`](../src/mgz_pkmn/lookup.py), [`sources/`](../src/mgz_pkmn/sources/), [`pricing.py`](../src/mgz_pkmn/pricing.py)) | [Lookup](https://github.com/users/mgzwarrior/projects/11/views/3) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Alookup?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Alookup) |
| **Output artifacts** | Render rows into spreadsheet / PDFs / checklist / JSON. ([`spreadsheet.py`](../src/mgz_pkmn/spreadsheet.py), [`binder.py`](../src/mgz_pkmn/binder.py), [`checklist.py`](../src/mgz_pkmn/checklist.py), [`report.py`](../src/mgz_pkmn/report.py)) | [Outputs](https://github.com/users/mgzwarrior/projects/11/views/4) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Aoutputs?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Aoutputs) |
| **Cache & persistence** | Disk cache for API responses + URL overrides; (V2) multi-user storage. ([`cache.py`](../src/mgz_pkmn/cache.py)) | [Cache](https://github.com/users/mgzwarrior/projects/11/views/5) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Acache?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Acache) |
| **Web UI / API** | FastAPI service + React SPA. ([`api/`](../api/), [`web/`](../web/)) | [Web / API](https://github.com/users/mgzwarrior/projects/11/views/6) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Aweb?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Aweb) |
| **Marketing site** | Astro static site deployed to Cloudflare Pages — landing page, copy, visuals. ([`site/`](../site/)) | [Site](https://github.com/users/mgzwarrior/projects/11?filterQuery=label%3A%22area%3Asite%22) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Asite?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Asite) |
| **DevOps & release** | CI, deployment, packaging, distribution, security, governance. | [DevOps](https://github.com/users/mgzwarrior/projects/11/views/7) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Adevops?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Adevops) |

## New contributors

If you're looking to make a first contribution, the
[Curated starter issues](contributing.md#curated-starter-issues)
section of the contributing guide maintains a hand-picked set of small,
well-scoped issues alongside the live
[`good first issue`](https://github.com/mgzwarrior/mgz-pkmn/labels/good%20first%20issue)
and
[`help wanted`](https://github.com/mgzwarrior/mgz-pkmn/labels/help%20wanted)
label filters. AI-assisted PRs welcome — see
[AGENTS.md](../AGENTS.md).

---

## V1.5 — committed (epic: eBay integration)

Adds eBay as a fourth pricing source alongside pokemontcg.io / Scrydex
/ PriceCharting. Slots into the existing source-plugin pattern; the
existing CLI / API contracts don't change, hence a v1.x rather than v2
milestone. See [ADR-0020](adr/0020-ebay-pricing-source.md) for the
acceptance contract and the
[`epic:ebay`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aebay)
tracking issue for the live task list.

The epic spans every project area:

- **Lookup engine** — `EbayClient` adapter implementing the existing
  source contract; `Pricing.source` enum gains `"ebay_sold"` and
  `"ebay_active"`.
- **Cache & persistence** — per-source TTL policy (sold listings get a
  longer freshness window than active listings).
- **Web UI / API** — results-table column / drawer for eBay comps + a
  last-N sold sparkline.
- **DevOps & release** — eBay Developer OAuth client, secret rotation
  runbook, Render env-var wiring.
- **Security** — token storage, scope minimization, rate-limit
  back-pressure.
- **Tests** — cassette-based integration tests against eBay sandbox.

---

## V1.6 — committed (epic: TCGPlayer integration)

Upgrades the embedded `tcgplayer` price block (today delivered nested
inside pokemontcg.io responses) to live data from TCGPlayer's API,
falling through to the embedded block when no credentials are present.
See [ADR-0021](adr/0021-tcgplayer-first-class-pricing.md) and the
[`epic:tcgplayer`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Atcgplayer)
tracking issue.

Pairs with the V2 persistence epic: per-user OAuth tokens land in the
new persistence schema.

- **Lookup engine** — `TCGPlayerClient` adapter; pricing upgrade path.
- **Cache & persistence** — SWR window for TCGPlayer market price.
- **Web UI / API** — "Connect TCGPlayer" settings panel with status.
- **DevOps & release** — per-user token storage migration.
- **Security** — OAuth `app/authorizeApplication` flow, refresh-token
  handling.
- **Tests** — sandbox / canned-response coverage.

---

## V2 — committed

Deeper development per area. The kind of work that takes more than an
afternoon, has design tradeoffs worth talking through, and benefits from
its own GitHub issue + PR thread.

### Lookup engine

- **Structured query DSL — dual-mode + smart auto-detect.**
  `top:N subtype:V,VMAX in "Surging Sparks" rarity:rare>=$50` runs in
  DSL mode alongside the existing flavor-text mode. A frontend toggle
  picks the default; smart auto-detect picks the right mode when input
  is unambiguous (`key:value` or `>=$` tokens are always DSL even if
  the toggle says flavor). Tracked under the `epic:query-dsl` umbrella;
  closes [#39](https://github.com/mgzwarrior/mgz-pkmn/issues/39) when
  the dual-mode contract ships.
- eBay sold-listings — has graduated to its own epic in V1.5; see the
  `epic:ebay` tracking issue and [v1.5 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/8). The
  original opt-in framing in
  [#40](https://github.com/mgzwarrior/mgz-pkmn/issues/40) is now a
  child issue under that epic.
- Cache TCGdex responses too (today only pokemontcg.io is cached).
  ([#41](https://github.com/mgzwarrior/mgz-pkmn/issues/41))
- Surface ambiguity in the JSON report
  (`"alternatives": [{...}]`) instead of silently picking one.
  ([#42](https://github.com/mgzwarrior/mgz-pkmn/issues/42))
- Pluggable name aliases — `top 5 ナッシー` works as well as
  `top 5 Exeggutor`.
  ([#43](https://github.com/mgzwarrior/mgz-pkmn/issues/43))
- **Pokemon type-aware search.** First-class support for the actual
  type system (Fire, Water, Grass, Lightning, Psychic, Fighting,
  Darkness, Metal, Fairy, Dragon, Colorless). `top 5 Fire type
  cards`, `top 10 Dragon cards in Surging Sparks`, name + type
  combos. Routes to pokemontcg.io's `types:` filter rather than the
  current flavor-text fallback.
  ([#72](https://github.com/mgzwarrior/mgz-pkmn/issues/72))
- Public `parse_lines(text) → list[CardQuery]` for downstream tools.
  ([#44](https://github.com/mgzwarrior/mgz-pkmn/issues/44))

### Output artifacts

- Configurable comp tiers via `--comps 70,80,90`.
  ([#45](https://github.com/mgzwarrior/mgz-pkmn/issues/45))
- Per-section charts in xlsx (price-distribution, top-N).
  ([#46](https://github.com/mgzwarrior/mgz-pkmn/issues/46))
- HTML output mode for sharing a wishlist by URL.
  ([#47](https://github.com/mgzwarrior/mgz-pkmn/issues/47))
- Custom binder layouts via TOML config (user-supplied
  `BinderLayout` instance without editing Python).
  ([#48](https://github.com/mgzwarrior/mgz-pkmn/issues/48))
- Color-coded rarity in xlsx.
  ([#49](https://github.com/mgzwarrior/mgz-pkmn/issues/49))
- Skip-already-owned mode (filters binder + checklist against a
  user-supplied "what I own" list).
  ([#50](https://github.com/mgzwarrior/mgz-pkmn/issues/50))
- **Expanded PDF design customization.** Per-page-size presets
  (A4, A5, custom), per-cell border/background controls, optional
  watermark, configurable card-art aspect / rotation, branded header
  bar. ([#51](https://github.com/mgzwarrior/mgz-pkmn/issues/51))

### Cache & persistence

- LRU eviction with size cap (`MGZ_PKMN_CACHE_MAX_MB`, default 100).
  ([#52](https://github.com/mgzwarrior/mgz-pkmn/issues/52))
- `pkmn cache compact` subcommand (re-encodes, drops corrupt
  entries). ([#53](https://github.com/mgzwarrior/mgz-pkmn/issues/53))
- TTL per source (pokemontcg.io stable; PriceCharting volatile).
  ([#54](https://github.com/mgzwarrior/mgz-pkmn/issues/54))
- `pkmn cache warm input/` — pre-populate the cache before a
  show with spotty Wi-Fi.
  ([#55](https://github.com/mgzwarrior/mgz-pkmn/issues/55))
- SQLite cache option (queryable history) — opt-in; default JSON
  store stays. ([#56](https://github.com/mgzwarrior/mgz-pkmn/issues/56))
- **Multi-user persistent collections.** Promote the disk cache to a
  full database (PostgreSQL or SQLite-with-Alembic) so deployed
  instances can track per-user collections, wishlists, and run
  history. Backwards-compatible: single-user CLI keeps the
  filesystem path; the API gains `/collections` endpoints.
  ([#57](https://github.com/mgzwarrior/mgz-pkmn/issues/57))

### Web UI / API

- Persistent run history with sidebar diff/re-export.
  ([#58](https://github.com/mgzwarrior/mgz-pkmn/issues/58))
- Drag-and-drop `.txt` upload onto the editor.
  ([#59](https://github.com/mgzwarrior/mgz-pkmn/issues/59))
- Inline edit + re-run for unmatched rows.
  ([#60](https://github.com/mgzwarrior/mgz-pkmn/issues/60))
- Authentication for hosted instances (API keys, per-key rate
  limits). ([#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61))
- Mobile-responsive layout + a11y audit (axe-core in CI).
  ([#62](https://github.com/mgzwarrior/mgz-pkmn/issues/62))
- OpenAPI client codegen (`@mgzwarrior/mgz-pkmn-client` published
  from the FastAPI schema).
  ([#63](https://github.com/mgzwarrior/mgz-pkmn/issues/63))

### DevOps & release

- PyPI publish on `v*` tag (Trusted Publisher).
  ([#64](https://github.com/mgzwarrior/mgz-pkmn/issues/64))
- Docker image to GHCR on tag.
  ([#65](https://github.com/mgzwarrior/mgz-pkmn/issues/65))
- Standalone PyInstaller binaries (macOS / Linux / Windows) on
  releases. ([#66](https://github.com/mgzwarrior/mgz-pkmn/issues/66))
- Homebrew tap: `brew install mgzwarrior/tap/mgz-pkmn`.
  ([#67](https://github.com/mgzwarrior/mgz-pkmn/issues/67))
- Conventional Commits + auto-generated release notes.
  ([#68](https://github.com/mgzwarrior/mgz-pkmn/issues/68))
- Coverage reporting (Codecov) with a hard threshold on PRs.
  ([#69](https://github.com/mgzwarrior/mgz-pkmn/issues/69))

---

## V2.1 — committed (epic: persistence at growth)

V2 ships the persistence MVP (collections #244, wishlists #245, runs).
V2.1 is the layer below — what we do when the single-tenant SQLite
shape outgrows the hosted demo. Tracked under
[`epic:persistence-growth`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Apersistence-growth);
depends on the V2 persistence MVP landing first.

- **Cache & persistence** — Postgres (via Hyperdrive) vs. Turso vs.
  Cloudflare D1 spike (captured as a follow-up ADR); migration story
  keeps Alembic and adds a Postgres dialect adapter.
- **Web UI / API** — per-user data export (`GET /me/export` → JSON
  dump); "Your data" page listing runs, collections, wishlists with
  delete + export controls.
- **DevOps & release** — backup + restore runbook for the hosted demo
  DB.
- **Security** — retention policy for `runs` / `run_rows` (90 days
  anonymous, indefinite signed-in).
- **Tests** — SQLite ↔ Postgres migration round-trip coverage.

---

## V2.x — committed but post-V2

Themed around **monetization**. The premise: *every end-user-facing
feature stays free forever* — collection prep, binders, checklists,
all of it. A separate **vendor / power-user track** charges based on
the additional volume and complexity those personas need. A small
number of **opt-in power features** also live behind a fair price for
end users who want them, so the project can monetize its largest
audience without breaking the free-forever promise on core flows.

V2.x items track on the unified
[`mgz-pkmn`](https://github.com/users/mgzwarrior/projects/11) project
alongside the rest of the roadmap; once issues are filed they get the
`version:v2.x` label so the policy work, infra changes, and feature
gating land coherently. Leaving them un-numbered until V1 ships keeps
the doc honest about what's open vs. just intended.

### Monetization

- **Free / paid separation policy doc.** A `docs/monetization.md`
  laying out the rules: which categories of feature are free forever,
  which are paid power-user (still affordable), which are paid vendor
  (volume- or complexity-driven). Public from day one — transparency
  is the trust foundation.
- **Feature-flag scaffolding.** A small system in the API + SPA for
  gating paid features behind plan tiers without forking the codebase.
  Should support: free, paid power-user (hosted instance), paid
  vendor (hosted instance + SLA).
- **Hosted billing integration.** Stripe (or similar) wired into the
  hosted instance only — the OSS distribution stays unencumbered.
  Free users never see the billing surface.
- **Power-user feature inventory.** Audit V2 features to identify
  candidates for paid tier (e.g., persistent run history could be
  paid; column filtering should stay free). Single-PR exercise per
  feature, low risk.

---

## V3 and beyond — proposed (not committed)

Speculative directions, especially the ones that might justify a paid
or hosted offering. Filed as ideas, not commitments. Items here are
welcome to grow, shrink, or get killed entirely based on community
feedback before any of them become committed work. No issues filed
yet — items here graduate to issues only after community discussion.

### Vendor / power-user portal

A separate persona from the personal-prep tool: someone who *runs* a
booth, not just attends one. Per
[ADR-0012](adr/0012-open-core-architecture.md), the implementation
lives in the private `mgz-pkmn-vendor` repo and is the first paid
surface. The OSS repo carries an
[`epic:vendor-vision`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Avendor-vision)
placeholder issue for visibility; substantive work happens in the
vendor repo.

- **Bulk card recognition (vendor scanner).** Camera or upload-based
  image recognition to identify cards in bulk (set, number, condition
  hints) and populate inventory. Extends the
  [breakwater-tcg-scanner](https://github.com/mgzwarrior/breakwater-tcg-scanner)
  prototype. Lives in `mgz-pkmn-vendor`. Pairs with Multi-user
  persistent collections.
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

### Multi-TCG expansion

The current scope is Pokemon-only. Expanding to other TCGs is a
significant lift — each game has its own data sources, pricing
conventions, set vocabularies, and edge cases — but the underlying
shape (parse → look up → emit artifacts) generalizes cleanly.

- **One Piece TCG.** Bandai's growing TCG with a healthy secondary
  market. Likely sources: TCGPlayer, OnePieceTopDecks-style aggregators.
- **Disney Lorcana.** Newer game with strong collector demand and
  active set rotation.
- **Magic: The Gathering.** The veteran. Scryfall is the canonical
  free API, with vastly more comprehensive coverage than
  pokemontcg.io. Different scoring concerns (Standard vs. Modern vs.
  Commander legality, foil pricing tiers).
- **Yu-Gi-Oh!**, **Flesh and Blood**, **Star Wars: Unlimited**, and
  others as community demand surfaces.

Open question: separate projects per TCG (`mgz-pokemon`, `mgz-mtg`)
or a single `mgz-tcg` with pluggable backends? The latter shares
infrastructure but pulls scope; the former lets each TCG move at its
own pace. Worth its own ADR and discussion thread before any code
lands.

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

Each committed item below is filed as a GitHub issue with the labels
listed in [How to read this roadmap](#how-to-read-this-roadmap) —
`area:*`, `type:*`, `version:*`, plus `epic:*` and `specialty:*` where
applicable. **Milestone** is the source of truth for *when* (the
version label exists as a coarse filter that survives milestone
renames). All v1.x minor releases share `version:v1.x`; the milestones
split them apart:
[v1.0](https://github.com/mgzwarrior/mgz-pkmn/milestone/1) (shipped),
[v1.1](https://github.com/mgzwarrior/mgz-pkmn/milestone/2) (shipped),
[v1.2](https://github.com/mgzwarrior/mgz-pkmn/milestone/4) (shipped),
[v1.3](https://github.com/mgzwarrior/mgz-pkmn/milestone/5) (shipped),
[v1.4](https://github.com/mgzwarrior/mgz-pkmn/milestone/6),
[v1.5](https://github.com/mgzwarrior/mgz-pkmn/milestone/8),
[v1.6](https://github.com/mgzwarrior/mgz-pkmn/milestone/9),
[v2.0](https://github.com/mgzwarrior/mgz-pkmn/milestone/3), and
[v2.1](https://github.com/mgzwarrior/mgz-pkmn/milestone/10). A
`version:v2.x` label gets created when the monetization items above
graduate from text-only proposals to filed issues.

V2.x and V3+ items stay in this document as text-only proposals until
they get promoted to committed work. The "proposed" tag is
load-bearing: items can be challenged, refined, or removed without
anyone having to close a GitHub issue.

New ideas land here as a draft proposal first — open a PR against
this file. After review, the agreed items get filed as issues with
the right labels and project assignment.
