# Roadmap

[![v1.10 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/23?label=v1.10)](https://github.com/mgzwarrior/mgz-pkmn/milestone/23)
[![v1.11 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/15?label=v1.11)](https://github.com/mgzwarrior/mgz-pkmn/milestone/15)
[![v1.12 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/16?label=v1.12)](https://github.com/mgzwarrior/mgz-pkmn/milestone/16)
[![v1.13 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/22?label=v1.13)](https://github.com/mgzwarrior/mgz-pkmn/milestone/22)
[![v1.14 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/17?label=v1.14)](https://github.com/mgzwarrior/mgz-pkmn/milestone/17)
[![v1.15 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/21?label=v1.15)](https://github.com/mgzwarrior/mgz-pkmn/milestone/21)
[![v1.16 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/19?label=v1.16)](https://github.com/mgzwarrior/mgz-pkmn/milestone/19)
[![v1.17 progress](https://img.shields.io/github/milestones/progress-percent/mgzwarrior/mgz-pkmn/18?label=v1.17)](https://github.com/mgzwarrior/mgz-pkmn/milestone/18)
[![Backlog open](https://img.shields.io/github/milestones/issues-open/mgzwarrior/mgz-pkmn/3?label=Backlog)](https://github.com/mgzwarrior/mgz-pkmn/milestone/3)
[![open issues](https://img.shields.io/github/issues-raw/mgzwarrior/mgz-pkmn?label=open)](https://github.com/mgzwarrior/mgz-pkmn/issues)

A forward-looking view of what's in flight and what's next. **Shipped
work is no longer enumerated here** — the [CHANGELOG](../CHANGELOG.md)
and the closed milestones own that record. The Versioning policy
section below gives a one-line summary per shipped version with a
link to its milestone for the full ledger; everything past V1.9 is
open work.

Items live on GitHub as issues, labels, milestones, and projects —
this document is the navigator. Every committed item below carries
its issue number for one-click navigation; speculative items don't
have issues yet.

The iOS app (`mgz-pkmn-ios`, not yet public) is a thin client over this API, so the work that unblocks it is tracked here rather than in that repo — see [V1.10](#v110--phone-parity).

For the end-user-facing project overview (features, "how it works",
live demo), see <https://mgz-pkmn.com>.

## Versioning policy

**Shipped (history; see [CHANGELOG](../CHANGELOG.md) for details):**

- **V1** (`1.0.0`) — 2026-05-15. Defensible 1.0; polish, tests, docs, release engineering. [v1.0 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/1).
- **V1.1** (`1.1.0`) — 2026-05-25. Set ID cards + web set-picker, marketing site, devex (PyPI, DCO, Codecov), a11y pass. [v1.1 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/2).
- **V1.2** (`1.2.0`) — 2026-05-31. Marketing-site polish + late v1.1-cycle web UX. [v1.2 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/4).
- **V1.3** (`1.3.0`) — 2026-06-02. Pre-Scrydex catalog-warm epic ([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)) + auth foundation ([#414](https://github.com/mgzwarrior/mgz-pkmn/pull/414)). [v1.3 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/5) · [v1.3.1 patch](https://github.com/mgzwarrior/mgz-pkmn/milestone/7).
- **V1.4** (`1.4.0`) — 2026-06-08. Tropical design system, full multi-provider hosted-demo auth (anonymous cache-only fallback), collections + wishlists as first-class surfaces, Search/Browse/Swipe discovery modes, and the CLI maintainability refactor + gate. [v1.4 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/6).
- **V1.5** (`1.5.0`) — 2026-06-10. Browse/swipe parity + pokédex-number view, refreshed Help modal, tropical-rebranded exports + published styleguide, the collections data-model foundation, and Conventional Commits + release-please. [v1.5 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/8).
- **V1.6** (`1.6.0`) — 2026-06-13. eBay sold + active comps as a fourth pricing source, collections/want-lists merged into a Binders library, smart rule-based collections, and ownership-aware discovery (hide-owned, cross-collection badges). [v1.6 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/9) · [v1.6.1 patch](https://github.com/mgzwarrior/mgz-pkmn/milestone/14).
- **V1.7** (`1.7.0`) — 2026-06-25. Collector workflow + pricing pivot: one-tap Want/Own quick actions with auto-provisioned default lists, binders as first-class inventory, collection/wishlist management tools, swipe taste-learning, and eBay/TCGplayer affiliate buy-links across the app (the pricing epics re-scoped to affiliate redirects since full API access is gated to high-volume developers). [v1.7 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/11).
- **V1.8** (`1.8.0`) — 2026-06-30. "Make it honest": the app opens on Swipe, the Tour drives the surfaces it narrates, the Help modal and end-user docs match the shipped SPA, and the welcome email moved to a reason-branched drip on Resend. [v1.8 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/12).
- **V1.9** (`1.9.0`) — 2026-07-23. Web workspace rethink: a three-column desktop split view, a mobile-first bottom-tab IA with card-based results, saved searches / wishlists / collections finally telling themselves apart, configurable comp columns with condition-aware pricing, dark-mode exports, native-app handoff for iOS sign-in, and the CLI plugin surface. [v1.9 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/13).

**In flight / planned:**

- **No committed V2 yet.** Earlier drafts of this roadmap treated a "v2.0" milestone as a staging area aggregating the structured query DSL, persistence MVP, identity sign-on, and assorted lookup / web / output epics. On 2026-06-25 that milestone was renamed to **[Backlog](https://github.com/mgzwarrior/mgz-pkmn/milestone/3)** — an explicit pool of uncommitted, externally-blocked, or deferred work, *not* a release. Under strict semver almost all of it is **additive** (new commands, endpoints, fields, UI toggles), so it ships in the v1.x cadence through a run of themed minors that carve the old v2 backlog into committed, shippable slices: [v1.10](https://github.com/mgzwarrior/mgz-pkmn/milestone/23) (phone parity), [v1.11](https://github.com/mgzwarrior/mgz-pkmn/milestone/15) (reliability & API hardening), [v1.12](https://github.com/mgzwarrior/mgz-pkmn/milestone/16) (lookup & search relevance), [v1.13](https://github.com/mgzwarrior/mgz-pkmn/milestone/22) (sealed product & grading), [v1.14](https://github.com/mgzwarrior/mgz-pkmn/milestone/17) (web quality-of-life), [v1.15](https://github.com/mgzwarrior/mgz-pkmn/milestone/21) (web architecture), [v1.16](https://github.com/mgzwarrior/mgz-pkmn/milestone/19) (cache & data platform), and [v1.17](https://github.com/mgzwarrior/mgz-pkmn/milestone/18) (CLI artifacts & distribution). Anything not yet committed — including the former v2.1 persistence-at-growth scaling work (its milestone is now closed) and the eBay / TCGPlayer pricing epics blocked on developer access — waits in the Backlog pool until it's promoted into one of those minors.
- **Milestone titles carry their theme.** Each open milestone reads `v1.13.0 — Sealed product & grading` rather than a bare version number. The sequence was re-ordered on 2026-07-22 to put the work collectors feel first: the API surface the phone is waiting on, then the hardening that a public client needs, then sealed product and grading ahead of the CLI-facing output and packaging work.
- **The real V2 cut is gated on vendor interest.** A major bump happens
  only when a genuinely breaking commitment lands — the
  [entry-point plugin surface](plugins.md) that
  [ADR-0012](adr/0012-open-core-architecture.md)
  requires for `mgz-pkmn-vendor` to register `pkmn vendor <subcommand>`
  becoming a public API, or hosted-demo identity becoming *required*
  (anonymous lookups stop working on the demo). Both are tracked under
  [`epic:vendor-vision`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Avendor-vision)
  ([#420](https://github.com/mgzwarrior/mgz-pkmn/issues/420),
  [#470](https://github.com/mgzwarrior/mgz-pkmn/issues/470),
  [#341](https://github.com/mgzwarrior/mgz-pkmn/issues/341),
  [#271](https://github.com/mgzwarrior/mgz-pkmn/issues/271)) and stay
  gated on real vendor interest rather than a date. The `version:v2`
  label now survives only on the genuine vendor-vision breaking issues
  ([#271](https://github.com/mgzwarrior/mgz-pkmn/issues/271),
  [#341](https://github.com/mgzwarrior/mgz-pkmn/issues/341)).
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

A frontend contributor browsing v1.9 work can run
`is:open milestone:v1.9 label:specialty:frontend` to find their issues.
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
| **Cache & persistence** | Disk cache for API responses + URL overrides; (planned) multi-user storage. ([`cache.py`](../src/mgz_pkmn/cache.py)) | [Cache](https://github.com/users/mgzwarrior/projects/11/views/5) | [![](https://img.shields.io/github/issues/mgzwarrior/mgz-pkmn/area%3Acache?label=)](https://github.com/mgzwarrior/mgz-pkmn/issues?q=is%3Aopen+label%3Aarea%3Acache) |
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

## The v1.10–v1.17 themed minors

The epics once staged under a single "v2.0" milestone ship as a run of themed v1.x minors. Each is a committed milestone; the slices below are the issues filed against it. (Where an issue predates a restructure its number is unchanged — only its milestone moved.)

### v1.10 — Phone parity

The API surface the iOS client is waiting on. That app is a thin client by design — it holds no lookup, pricing, or persistence logic of its own — so anything it can't do because an endpoint is missing lands here instead. Tracked on the [v1.10 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/23).

- Account deletion endpoint + cascade — App Store review requires in-app account deletion, and no endpoint exists today. ([#950](https://github.com/mgzwarrior/mgz-pkmn/issues/950))
- `GET /me/export` — per-user JSON data export; the other half of the same user right. ([#448](https://github.com/mgzwarrior/mgz-pkmn/issues/448))
- Push notification infrastructure — device-token registration, per-user preference storage, delivery. ([#946](https://github.com/mgzwarrior/mgz-pkmn/issues/946))
- Swipe: per-card un-exclude + server-side profile persistence, so phone and web share one set of preferences. ([#945](https://github.com/mgzwarrior/mgz-pkmn/issues/945))
- 30-day price-trend sparkline — the price history the comps sparkline needs on both clients. ([#269](https://github.com/mgzwarrior/mgz-pkmn/issues/269))
- Swipe mode toggle — taste vs. ownership; the web side catching up to the phone. ([#912](https://github.com/mgzwarrior/mgz-pkmn/issues/912))

### v1.11 — Trustworthy API

Fill the test gaps so the collector-facing surfaces are safe to refactor, then close the abuse surface before a public client points at the hosted API. Tracked on the [v1.11 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/15), with the hardening work under [`epic:api-auth`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aapi-auth) ([#710](https://github.com/mgzwarrior/mgz-pkmn/issues/710)).

- Test coverage: lookup sources — pokemontcg.io, TCGdex, base adapter. ([#230](https://github.com/mgzwarrior/mgz-pkmn/issues/230))
- Test coverage: lookup orchestration (`lookup.py` + `api/routes/lookup.py`). ([#231](https://github.com/mgzwarrior/mgz-pkmn/issues/231))
- Test coverage: CLI command flows. ([#232](https://github.com/mgzwarrior/mgz-pkmn/issues/232))
- Test coverage: web SPA + API client. ([#233](https://github.com/mgzwarrior/mgz-pkmn/issues/233))
- Test coverage: interactive web components. ([#234](https://github.com/mgzwarrior/mgz-pkmn/issues/234))
- Rate limit compute endpoints. ([#928](https://github.com/mgzwarrior/mgz-pkmn/issues/928))
- Cost guardrails on `/export` and `/bulk`. ([#929](https://github.com/mgzwarrior/mgz-pkmn/issues/929))
- Require sign-in for live external fetches on the remaining source-touching endpoints. ([#930](https://github.com/mgzwarrior/mgz-pkmn/issues/930))
- Posture verification tests for the auth-on production config. ([#931](https://github.com/mgzwarrior/mgz-pkmn/issues/931))
- Security headers middleware. ([#932](https://github.com/mgzwarrior/mgz-pkmn/issues/932))
- ADR + security note for the abuse hardening. ([#933](https://github.com/mgzwarrior/mgz-pkmn/issues/933))

### v1.12 — Sharper lookups

Make free-form collector queries land the right cards more often. Tracked on the [v1.12 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/16).

- Pluggable name aliases — `top 5 ナッシー` works as well as `top 5 Exeggutor`. ([#43](https://github.com/mgzwarrior/mgz-pkmn/issues/43))
- Configurable comp tiers via `--comps 70,80,90`. ([#45](https://github.com/mgzwarrior/mgz-pkmn/issues/45))
- Skip-already-owned mode — filter binder + checklist against a "what I own" list. ([#50](https://github.com/mgzwarrior/mgz-pkmn/issues/50))
- Pokémon type-aware search — route to the `types:` filter instead of the flavor-text fallback. ([#72](https://github.com/mgzwarrior/mgz-pkmn/issues/72))
- Surface ambiguity in the JSON report instead of silently picking one. ([#42](https://github.com/mgzwarrior/mgz-pkmn/issues/42))
- Surface "why this matched" on result rows. ([#179](https://github.com/mgzwarrior/mgz-pkmn/issues/179))
- Replace hardcoded "cute card" flavor logic with a concept-tag registry. ([#181](https://github.com/mgzwarrior/mgz-pkmn/issues/181))
- Canonical Pokémon type-normalization map (aliases + multi-type). ([#182](https://github.com/mgzwarrior/mgz-pkmn/issues/182))
- Confidence bands + weak-match threshold filtering. ([#184](https://github.com/mgzwarrior/mgz-pkmn/issues/184))
- Pokémon metadata enrichment pipeline (stage / ability / evolution tags). ([#189](https://github.com/mgzwarrior/mgz-pkmn/issues/189))

### v1.13 — Sealed product & grading

Bring booster packs, boxes, ETBs, tins, and bundles into the collector model as first-class items alongside singles, and add per-copy condition and professional grading to both. Landing the data model here rather than at the end of the run means both clients render it once. Tracked on the [v1.13 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/22) under [`epic:sealed-product`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Asealed-product) ([#881](https://github.com/mgzwarrior/mgz-pkmn/issues/881)).

- PriceCharting sealed-product detection, tiered by condition. ([#883](https://github.com/mgzwarrior/mgz-pkmn/issues/883))
- Sealed-item + condition/grade CRUD across collections and wishlists. ([#884](https://github.com/mgzwarrior/mgz-pkmn/issues/884))
- Add-sealed-product flow — manual entry + PriceCharting URL capture. ([#885](https://github.com/mgzwarrior/mgz-pkmn/issues/885))
- Condition & grade controls — picker UI + badges, shared across card and sealed items. ([#886](https://github.com/mgzwarrior/mgz-pkmn/issues/886))
- Sealed items + condition/grade in collection and wishlist detail views. ([#887](https://github.com/mgzwarrior/mgz-pkmn/issues/887))
- xlsx export fields for product type, condition, and grade. ([#888](https://github.com/mgzwarrior/mgz-pkmn/issues/888))

### v1.14 — Web quality-of-life

Tracked on the [v1.14 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/17).

- Drag-and-drop file upload onto the editor. ([#59](https://github.com/mgzwarrior/mgz-pkmn/issues/59))
- Inline edit + re-run for unmatched rows. ([#60](https://github.com/mgzwarrior/mgz-pkmn/issues/60))
- Card artwork modal / lightbox (accessibility-first). ([#178](https://github.com/mgzwarrior/mgz-pkmn/issues/178))
- Advanced filter drawer (type / rarity / set / price) with a mobile bottom-sheet. ([#183](https://github.com/mgzwarrior/mgz-pkmn/issues/183))
- High-res image strategy (lazy-load, srcset, modal prefetch). ([#185](https://github.com/mgzwarrior/mgz-pkmn/issues/185))
- Structured lookup telemetry (opt-in). ([#186](https://github.com/mgzwarrior/mgz-pkmn/issues/186))
- Offline mode for card shows with poor connectivity. ([#258](https://github.com/mgzwarrior/mgz-pkmn/issues/258))
- "Card show haul" mode — bulk-enter cards into a collection from the search bar. ([#509](https://github.com/mgzwarrior/mgz-pkmn/issues/509))
- Reorder / pin ResultsTable columns, persisted through saved searches. ([#942](https://github.com/mgzwarrior/mgz-pkmn/issues/942))

### v1.15 — Web architecture

Give the SPA URL-backed navigation, finish the server-state story, and keep the growing front end agent-legible. Sequenced router → server-state → maintainability; each is a large multi-PR epic paced opportunistically alongside other work. Tracked on the [v1.15 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/21).

- URL as state — router, deep links, back-button, code-splitting, under [`epic:url-as-state`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aurl-as-state). ([#861](https://github.com/mgzwarrior/mgz-pkmn/issues/861))
- Catch-all 404 page for unknown SPA routes — falls out of the router. ([#539](https://github.com/mgzwarrior/mgz-pkmn/issues/539))
- Server-state layer — adopt TanStack Query, then OpenAPI codegen, under [`epic:web-data-layer`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aweb-data-layer). ([#862](https://github.com/mgzwarrior/mgz-pkmn/issues/862))
- OpenAPI client codegen (`@mgzwarrior/mgz-pkmn-client` from the FastAPI schema). ([#63](https://github.com/mgzwarrior/mgz-pkmn/issues/63))
- Web maintainability — feature folders, component decomposition, CI gates, under [`epic:web-maintainability`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aweb-maintainability). ([#863](https://github.com/mgzwarrior/mgz-pkmn/issues/863))

### v1.16 — Cache & data platform

Tracked on the [v1.16 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/19).

- Cache TCGdex responses too (today only pokemontcg.io is cached). ([#41](https://github.com/mgzwarrior/mgz-pkmn/issues/41))
- LRU eviction with a size cap (`MGZ_PKMN_CACHE_MAX_MB`). ([#52](https://github.com/mgzwarrior/mgz-pkmn/issues/52))
- `pkmn cache compact` subcommand. ([#53](https://github.com/mgzwarrior/mgz-pkmn/issues/53))
- TTL per source. ([#54](https://github.com/mgzwarrior/mgz-pkmn/issues/54))
- `pkmn cache warm input/` — pre-populate before a show with spotty Wi-Fi. ([#55](https://github.com/mgzwarrior/mgz-pkmn/issues/55))
- SQLite cache option (queryable history), opt-in. ([#56](https://github.com/mgzwarrior/mgz-pkmn/issues/56))
- TCGdex disk persistence across CLI runs. ([#294](https://github.com/mgzwarrior/mgz-pkmn/issues/294))
- Scrydex migration cutover — swap the price-fetch path + ID mapping. ([#351](https://github.com/mgzwarrior/mgz-pkmn/issues/351))
- Scrydex webhooks for push-based cache invalidation. ([#373](https://github.com/mgzwarrior/mgz-pkmn/issues/373))

### v1.17 — CLI artifacts & distribution

Everything the command line still owes, plus the install story. Deliberately last in the run: it's the surface collectors touch least. Tracked on the [v1.17 milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/18).

- Per-section charts in xlsx (price-distribution, top-N). ([#46](https://github.com/mgzwarrior/mgz-pkmn/issues/46))
- HTML output mode for sharing a wishlist by URL. ([#47](https://github.com/mgzwarrior/mgz-pkmn/issues/47))
- Custom binder layouts via TOML config. ([#48](https://github.com/mgzwarrior/mgz-pkmn/issues/48))
- Expanded PDF design customization (page-size presets, per-cell controls, watermark, header bar). ([#51](https://github.com/mgzwarrior/mgz-pkmn/issues/51))
- Swipeable flipbook export — a digital binder for phone/tablet review. ([#259](https://github.com/mgzwarrior/mgz-pkmn/issues/259))
- Docker image to GHCR on tag. ([#65](https://github.com/mgzwarrior/mgz-pkmn/issues/65))
- Standalone PyInstaller binaries (macOS / Linux / Windows). ([#66](https://github.com/mgzwarrior/mgz-pkmn/issues/66))
- Homebrew tap: `brew install mgzwarrior/tap/mgz-pkmn`. ([#67](https://github.com/mgzwarrior/mgz-pkmn/issues/67))

---

## Backlog — uncommitted, blocked, deferred

The [Backlog milestone](https://github.com/mgzwarrior/mgz-pkmn/milestone/3)
is the renamed former "v2.0" staging milestone — a pool of work that
isn't committed to a release yet, is blocked on an external dependency,
or has been deferred. It is **not** a release. Items graduate out of it
into a themed v1.x minor once they're committed. Each epic below has a
tracking issue carrying the full child task list.

- **Flavor-text parser uplift + LLM-backed flavor→DSL translator** —
  expand keyword coverage, add a `FlavorTranslator` behind the
  `QueryMode` interface, and back it with Claude so free-text input like
  `pkmn lookup "top:10 puppy cards"` resolves. Tracked under
  [`epic:flavor-uplift`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aflavor-uplift)
  ([#455](https://github.com/mgzwarrior/mgz-pkmn/issues/455)); deferred
  out of V1.8.
- **Structured query DSL — dual-mode + smart auto-detect** —
  `top:N subtype:V,VMAX in "Surging Sparks" rarity:rare>=$50` running
  alongside flavor mode, with auto-detect on unambiguous tokens. Tracked
  under
  [`epic:query-dsl`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aquery-dsl)
  ([#418](https://github.com/mgzwarrior/mgz-pkmn/issues/418); closes
  [#39](https://github.com/mgzwarrior/mgz-pkmn/issues/39)).
- **Persistence at growth** — post-MVP scaling for collections /
  wishlists / runs: a Postgres (Hyperdrive) vs. Turso vs. Cloudflare D1
  spike, a Postgres dialect adapter, a retention policy, a "Your data"
  page, and a backup/restore runbook. Formerly its own "v2.1" milestone,
  now closed and folded here under
  [`epic:persistence-growth`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Apersistence-growth)
  ([#419](https://github.com/mgzwarrior/mgz-pkmn/issues/419)); gated on
  the persistence MVP (collections
  [#244](https://github.com/mgzwarrior/mgz-pkmn/issues/244), wishlists
  [#245](https://github.com/mgzwarrior/mgz-pkmn/issues/245)) landing
  first. `GET /me/export`
  ([#448](https://github.com/mgzwarrior/mgz-pkmn/issues/448)) graduated
  out to V1.10, where it pairs with the account-deletion endpoint.
- **TCGPlayer first-class API pricing** — a `TCGPlayerClient` adapter,
  per-user OAuth, a "Connect TCGPlayer" panel, encrypted token storage.
  **Blocked**: full API access is gated to high-volume developers, so the
  interim is the eBay/TCGplayer affiliate buy-links that shipped in V1.7;
  a no-auth TCGCSV price stopgap is queued here too. Tracked under
  [`epic:tcgplayer`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Atcgplayer)
  ([#417](https://github.com/mgzwarrior/mgz-pkmn/issues/417); TCGCSV
  stopgap [#635](https://github.com/mgzwarrior/mgz-pkmn/issues/635)).
- **eBay first-class pricing source** — a first key-gated iteration of
  sold + active comps shipped in V1.6; the broader first-class /
  high-volume version (with cassette-based sandbox tests
  [#428](https://github.com/mgzwarrior/mgz-pkmn/issues/428)) is parked
  here on the same developer-access gate. Tracked under
  [`epic:ebay`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aebay)
  ([#416](https://github.com/mgzwarrior/mgz-pkmn/issues/416)).
- **Personalization beyond swipe** — infer a taste profile from what a
  collector already owns and chases, and blend it with the explicit
  swipe signal to kill the cold-start problem.
  ([#910](https://github.com/mgzwarrior/mgz-pkmn/issues/910))
- **Governance** — evaluate converting mgz-pkmn to an organization-owned
  repo. ([#163](https://github.com/mgzwarrior/mgz-pkmn/issues/163))

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
gating land coherently. Leaving them un-numbered until they're
committed keeps the doc honest about what's open vs. just intended.

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
applicable. **Milestone** is the source of truth for *when*; the
version label is a coarse filter that tracks it. Open milestone titles
carry their theme (`v1.13.0 — Sealed product & grading`), so a rename
that only changes the theme leaves the labels alone — a *renumber* moves
both. The milestones:
[v1.0](https://github.com/mgzwarrior/mgz-pkmn/milestone/1) (shipped),
[v1.1](https://github.com/mgzwarrior/mgz-pkmn/milestone/2) (shipped),
[v1.2](https://github.com/mgzwarrior/mgz-pkmn/milestone/4) (shipped),
[v1.3](https://github.com/mgzwarrior/mgz-pkmn/milestone/5) (shipped),
[v1.4](https://github.com/mgzwarrior/mgz-pkmn/milestone/6) (shipped),
[v1.5](https://github.com/mgzwarrior/mgz-pkmn/milestone/8) (shipped),
[v1.6](https://github.com/mgzwarrior/mgz-pkmn/milestone/9) (shipped),
[v1.7](https://github.com/mgzwarrior/mgz-pkmn/milestone/11) (shipped),
[v1.8](https://github.com/mgzwarrior/mgz-pkmn/milestone/12) (shipped),
[v1.9](https://github.com/mgzwarrior/mgz-pkmn/milestone/13) (shipped),
[v1.10](https://github.com/mgzwarrior/mgz-pkmn/milestone/23),
[v1.11](https://github.com/mgzwarrior/mgz-pkmn/milestone/15),
[v1.12](https://github.com/mgzwarrior/mgz-pkmn/milestone/16),
[v1.13](https://github.com/mgzwarrior/mgz-pkmn/milestone/22),
[v1.14](https://github.com/mgzwarrior/mgz-pkmn/milestone/17),
[v1.15](https://github.com/mgzwarrior/mgz-pkmn/milestone/21),
[v1.16](https://github.com/mgzwarrior/mgz-pkmn/milestone/19), and
[v1.17](https://github.com/mgzwarrior/mgz-pkmn/milestone/18) — with the
uncommitted, blocked, and deferred pool living in
[Backlog](https://github.com/mgzwarrior/mgz-pkmn/milestone/3) (the
renamed former v2.0 staging milestone). A `version:v2.x` label gets
created when the monetization items above graduate from text-only
proposals to filed issues.

V2.x and V3+ items stay in this document as text-only proposals until
they get promoted to committed work. The "proposed" tag is
load-bearing: items can be challenged, refined, or removed without
anyone having to close a GitHub issue.

New ideas land here as a draft proposal first — open a PR against
this file. After review, the agreed items get filed as issues with
the right labels and project assignment.
