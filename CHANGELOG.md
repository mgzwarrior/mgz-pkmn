# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- CLI / API / web: **`pkmn cache warm-cards`** — pre-warms the
  per-card structural cache for the entire English Pokémon TCG catalog
  ([#370](https://github.com/mgzwarrior/mgz-pkmn/issues/370), Phase 1
  of [epic #368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)).
  Walks every set, then fan-out-writes a per-card cache entry for
  every card in the set's payload using a synthesized
  `/v2/cards/{card_id}` URL key — reuses the data each set's search
  already returns, so zero extra HTTP calls vs `warm-set-cards`. Flags
  for `--set` (repeatable), `--max-cards` (incremental warming),
  `--skip-existing/--no-skip-existing` (re-run is cheap by default),
  `--throttle-ms` (polite pacing against pokemontcg.io's rate limit),
  and `-v`. Writes a new `card_warm.json` manifest (1-week stale
  window) so subsequent runs and the runtime startup bootstrap can
  skip a recent pass. New `card_warm_*` fields on `CacheStats`
  surfaced on `pkmn cache stats`, `/api/v1/cache/stats`, and the SPA
  Cache Stats panel.
- API: new **`MGZ_PKMN_WARM_CARDS_ON_STARTUP`** env var enables the
  per-card warm in the lifespan bootstrap. Independent of
  `MGZ_PKMN_WARM_ON_STARTUP` because the per-card pass is heavyweight
  (~18,000 cache entries on a fresh disk) and should be opted into
  explicitly.
- API: **`GET /api/v1/cache/stats`** returns the same JSON shape as
  `pkmn cache stats --json` so operators can introspect a deployed
  instance's cache state without shelling onto the host
  ([#311](https://github.com/mgzwarrior/mgz-pkmn/issues/311)). Answers
  the "did `MGZ_PKMN_WARM_ON_STARTUP` actually land?" question on demand
  rather than from log-grep, with no auth required (entry counts and
  timestamps aren't sensitive) and `Cache-Control: no-store` so the
  reading reflects current on-disk state. Falls back to a zeroed
  snapshot on `OSError` (read-only / misconfigured filesystem) so the
  diagnostics endpoint never 500s on the surface meant to diagnose
  failures. Wired into
  [`docs/deployment.md`](docs/deployment.md#inspecting-deployed-cache-state)
  as the canonical inspection surface.
- Web: **Cache-stats panel in the Settings drawer** — surfaces the
  same `/api/v1/cache/stats` snapshot inline in the SPA so contributors
  and operators can see the deployed instance's API / image / override
  counts and warm-pass freshness without leaving the app. Reads on
  drawer open with a refresh button for re-reads, and renders "not
  warmed" in amber for the concept and set-cards slices when the
  manifests are missing.

### Changed

- Deploy: **Persistent disk + runtime-only cache warming** — the Render
  deployment now provisions a 10 GB persistent disk mounted at
  `/var/cache` and points `XDG_CACHE_HOME` at it
  ([#369](https://github.com/mgzwarrior/mgz-pkmn/issues/369)). The
  cache root resolves to `/var/cache/mgz-pkmn`, so every slice
  (API responses, set images, card images, URL overrides, the
  run-history SQLite file, all three warm-pass manifests) now survives
  redeploys instead of being thrown away on every push to `main`. The
  Dockerfile's build-time `pkmn cache warm-sets` step is retired in
  favor of a runtime lifespan bootstrap (`_warm_sets_in_background`)
  gated by a new `sets_warm.json` freshness manifest (1-week TTL).
  Image is ~20 MB smaller and builds ~30s faster as a result; a single
  warm pass after the first deploy now serves every subsequent deploy
  until the manifest expires. Foundation for the
  [pre-Scrydex catalog-warm epic #368](https://github.com/mgzwarrior/mgz-pkmn/issues/368).

### Added

- CLI / API / web: **`sets_warm.json` manifest + new `sets_warm_*`
  fields** on `CacheStats`. Surfaced as a new line on
  [`pkmn cache stats`](src/mgz_pkmn/cli.py) ("Sets: 173 sets · warmed
  Xh ago" or "not warmed"), a new row on the SPA's Cache Stats panel
  ([`web/src/components/SettingsDrawer.tsx`](web/src/components/SettingsDrawer.tsx)),
  and two new fields on `GET /api/v1/cache/stats`. Operators now have
  the same freshness signal for the set-image slice that the concept
  and set-cards slices already had.

### Fixed

- API: **`MGZ_PKMN_WARM_ON_STARTUP=1` actually fires again** — the
  warm bootstrap was wired via `@app.on_event("startup")`, but
  Starlette silently drops `on_event` handlers when a custom `lifespan`
  is provided (the one added for Alembic auto-migrate). The deployed
  instance was reporting `concept_warm_timestamp` and
  `set_cards_warm_timestamp` as `null` on `/api/v1/cache/stats` despite
  the env var being set ([#367](https://github.com/mgzwarrior/mgz-pkmn/issues/367)).
  Folded the warm bootstrap into the existing lifespan async generator
  and pinned the behavior with `tests/test_warm_on_startup.py` so the
  next person to add a startup hook can't silently shadow it again.
- Web: **results table counts now live above the table** — the
  `N matched · N unmatched · N shown` summary moved from below the
  results to the right side of the table toolbar so it's visible
  without scrolling on long result sets ([#358](https://github.com/mgzwarrior/mgz-pkmn/issues/358)).

## [1.2.0] - 2026-05-31

### Changed

- Repo: **single source of truth for the brand logo** — the
  tropical card-and-palm SVGs (light + dark) live once at
  [`assets/logo.svg`](assets/logo.svg) and
  [`assets/logo-dark.svg`](assets/logo-dark.svg). The marketing
  site (`Header.astro`, `Footer.astro`) and the demo SPA
  ([`App.tsx`](web/src/App.tsx)) pull them in via relative Vite
  imports — Astro uses `?url` because its asset pipeline
  otherwise picks SVGs up as components; the SPA's bare import
  returns the URL string directly. Each surface's bundler still
  emits a hashed asset URL. Both Vite configs opt the dev
  server's `fs.allow` to include `../assets` so the import
  resolves at dev time, and the Dockerfile's web-builder stage
  copies `assets/` so the import resolves at production build
  time too. Drops the five prior duplicates
  (`assets/logo-tropical.svg`,
  `site/public/logo-tropical{,-dark}.svg`,
  `web/src/assets/logo-tropical{,-dark}.svg`); a logo change is
  now one file edit instead of a six-file sweep. See
  [ADR-0011](docs/adr/0011-marketing-site-stack.md#decision) for
  the updated rationale.
- Web: **Tropical palette across the SPA + theme toggle** — the React
  demo SPA now ships the same husk/sand/sun/palm/coconut design
  system the marketing site uses, with a header **Light/dark toggle**
  that mirrors the site's behavior (persists in `localStorage`,
  follows OS `prefers-color-scheme` on first visit, no flash thanks
  to a pre-paint script in `index.html`). Light is the default to
  match the marketing site. Every component moves onto paired
  light/dark tokens — including the easter-egg modal, announcement
  banner, processing-queue stage chips, modals/drawers, results
  table, and over-cap / error / success accents (sun / ember / palm).
  Brand chrome uses the same tropical logo (`sand-50` wordmark) in
  dark mode. SPA functionality is unchanged.
- Web: **Per-stage colors moved to the design system** — the bulk
  lookup progress chips and the `Loader2` spinner now use paired
  light/dark tokens (`sky-500/sky-300` for `looking_up`,
  `palm-600/palm-200` for `resolved`, `sun-600/sun-300` for `no_match`,
  `ember-500/ember-300` for `error`, etc.) instead of single
  Tailwind `*-400` stock colors. Each pairing clears WCAG 2.1 AA
  contrast (≥ 4.5:1) against both surfaces; the legend layout is
  unchanged. See [`docs/accessibility.md`](docs/accessibility.md).
- Site: **Dark mode now on the tropical palette** — the Astro marketing
  site's dark theme no longer leans on the leftover zinc/blue Tailwind
  stock palette. Surfaces use the husk coffee-charcoal tokens, body text
  warm sand, links and CTAs the same sun-yellow that defines light mode,
  and badge accents map onto palm/sun/ember instead of generic
  emerald/blue/rose. The header theme toggle behavior is unchanged.
  Light mode is unchanged. SPA migration follows in a separate PR.
- Site: **Tropical theme as a light mode** — the Astro marketing site
  now ships both themes: the original zinc/blue palette stays the default
  **dark** mode, and the warm cream + sun + palm + coconut Exeggutor
  direction is available as an opt-in **light** mode. A header toggle
  switches between them and the choice persists; on first visit the site
  follows the OS `prefers-color-scheme`, falling back to dark. Light mode
  uses display type **Bricolage Grotesque**, body **DM Sans**, and warm
  coconut-alpha shadows; dark mode keeps the prior contrast-by-border
  surfaces. SPA migration lands in a follow-up PR.

### Added

- Marketing: **v1 interest survey + announcement banner** — a slim
  dismissible top banner on the marketing site (above the Header) and
  the demo SPA (above the existing top bar) points visitors at a short
  Tally-hosted survey. ~6 questions covering pain points, useful
  features, return triggers, audience self-ID, favorite Pokémon, and
  optional contact email. Source of truth for the question list lives
  at `docs/marketing/surveys/v1-interest-survey.md`; bump the survey
  URL and the `survey-v1` dismissal-key suffix in both banner
  components together when shipping a future survey.
- Site: **print-ready show flyer** — new `/flyer` page on the marketing
  site renders a double-sided quarter-letter (4.25 × 5.5 in) handout for
  in-person card shows. Front: logo, tagline, and a high error-correction
  QR code pointing at the live demo. Back: four feature bullets and a
  contact block. A **Download PDF (4-up)** button generates a 2-page US
  Letter PDF with four flyers per sheet via `jspdf` + `html2canvas`,
  bypassing the browser print dialog so the saved file is always the
  right shape regardless of printer driver quirks. The `@page` print
  stylesheet remains as a fallback for power users.
- Site: **email signup section** — a new "Get the next release in your
  inbox" section on the marketing landing page collects subscribers via
  the [Buttondown](https://buttondown.com) public embed endpoint. Sits
  right under "What you actually walk out with" so visitors who've already
  seen the value prop have an easy on-ramp. Honors the tropical palette in
  both light and dark mode. Submits inline via `fetch` with a
  success state ("Thanks — check your inbox") when JS is enabled, falling
  back to Buttondown's hosted popup when JS is off. No new runtime
  dependencies; no API key in the client.
- Site: **"Recently shipped" stays glanceable** — the release-notes
  section on the landing page now caps each Added/Changed/Fixed bucket
  to the first three bullets and clamps each bullet to two lines of
  prose. A "+N more in the changelog →" link appears when a bucket has
  been truncated, so the long-form notes are always one click away. Keeps
  the section a fixed-height palate-cleanser instead of a wall of text
  on releases that ship a dozen entries in one category.
- API: persistence layer for run history backed by SQLite + Alembic
  (see [ADR-0013](docs/adr/0013-sqlite-persistence-for-runs-collections-wishlists.md)).
  `POST /api/v1/bulk` now writes a `runs` + `run_rows` record on
  successful stream completion. New endpoints `GET /api/v1/runs`,
  `GET /api/v1/runs/{id}`, and `POST /api/v1/runs/{id}/export` let
  clients list, load, and re-export prior runs without re-fetching from
  pokemontcg.io. Database lives at `$XDG_CACHE_HOME/mgz-pkmn/mgz-pkmn.db`
  by default; override with `MGZ_PKMN_DATABASE_URL`. Postgres is supported
  via a `postgresql+psycopg://…` URL, but no Postgres driver ships in the
  `api` extra yet — install one yourself (`pip install psycopg`) first. The
  API runs `alembic upgrade head` on startup under a cross-worker lock; set
  `MGZ_PKMN_AUTOMIGRATE=0` to skip and run `make migrate` as a prestart step
  instead.
- Web: **color-coded search progress** — while a bulk lookup runs, each
  input line's chip in the progress panel now reflects the exact pipeline
  stage it's in (parsed → looking up → fallback / URL hint → pricing →
  resolved / no match / error) instead of a single blue spinner. The
  `/api/v1/bulk` SSE stream carries a `stage` on every frame, including
  intermediate progress-only frames streamed live as a line moves through
  the sources. Hovering a chip shows how long the line has spent in its
  current stage, and a **Legend** toggle in the panel header maps the
  colors to their meanings. All stage colors clear WCAG AA contrast —
  see [docs/accessibility.md](docs/accessibility.md#color-coded-progress-stages).
- Web: **"What's new" panel** — a new header button (with an unobtrusive
  dot when a release newer than you've seen has shipped) opens a panel of
  recent release notes, pulled at runtime from `GET /api/v1/changelog` —
  the same source the marketing site reads. Opening the panel marks the
  latest version seen, clearing the dot; a first-time visitor is caught
  up silently so it never competes with the Help button's first-visit
  hint. Bullets render inline Markdown (links, `code`, **bold**). The
  last-seen version persists via the existing Zustand store.
- API: new `GET /api/v1/changelog` endpoint returns structured release
  notes parsed from `CHANGELOG.md` — the single source of truth for
  "what's new" surfaces, shared by the marketing site and (later) the
  demo SPA. Supports `?limit=N` (newest first) and
  `?include_unreleased=true`; the in-flight Unreleased section is
  omitted by default. Parsing lives in `mgz_pkmn.changelog` so it's
  unit-testable independent of the route.
- Site: **"Recently shipped" release notes** — a new section on the
  marketing landing page renders the last three releases (version,
  date, and bullets grouped by Added / Changed / Fixed) pulled at
  build time from `GET /api/v1/changelog`. The hero's "Now shipping
  X.Y.Z" pill is now derived from the same source instead of being
  hand-edited every release, so it can't drift. Both degrade
  gracefully (section omitted, pill shows just "Now shipping") if the
  API is unreachable at build time.
- Site: **Hero binder grid + asciinema cast** — the marketing landing
  page now opens on a tilted 3×3 binder page of real Pokémon TCG cards
  (replacing the abstract brand-color radial glow) and an embedded
  [asciinema](https://asciinema.org/) cast of an actual `pkmn lookup`
  run against `sample_cards.txt` (replacing the hand-curated static
  code block). Cards live under `site/public/cards/` as ~40 KB WebP
  thumbnails; the cast is captured by
  [`site/scripts/record-cast.sh`](site/scripts/record-cast.sh). Player
  CSS/JS are vendored into `site/public/vendor/` so the page has no
  third-party iframe and works offline once cached. Falls back to a
  `<noscript>` code block for visitors with JS disabled.
- Site: **"What you get" gallery** — a new section between the
  features grid and "How it works" shows three side-by-side previews
  of the actual deliverables (`cards.xlsx`, `binder.pdf`,
  `checklist.pdf`) rendered from the tracked `output/` samples.
  Regenerated end-to-end by
  [`site/scripts/refresh-screenshots.sh`](site/scripts/refresh-screenshots.sh):
  `pdftoppm` for the PDF previews, plus a custom
  [`render_xlsx_preview.py`](site/scripts/render_xlsx_preview.py)
  that composes a faithful spreadsheet-style preview from
  `output/summary.json` + thumbnails in `output/images/` (LibreOffice
  headless can't render the xlsx writer's embedded image references).
- CLI: `pkmn cache warm-set-cards` subcommand walks every Pokémon TCG set
  and pre-primes the API response cache for each one's card list, so the
  web SPA's Browse → set-detail path is a cache hit on first request
  instead of a multi-second upstream round trip. Issues the exact same
  `set.id:"<id>"` Lucene query the `GET /api/v1/sets/{set_id}/cards`
  endpoint issues, so cache keys line up. Accepts `--set <id>`
  (repeatable) to warm only specific sets — handy for staging a new
  release without re-walking the whole catalog — and `--verbose` to
  print each set id as it warms. Writes `set_cards_warm.json` in the
  cache root with a timestamp + warmed-count so `pkmn cache stats` can
  report freshness and the FastAPI startup hook gates itself to run at
  most once per week.
- API: `MGZ_PKMN_WARM_ON_STARTUP=1` now kicks off a set-cards warm pass
  on a separate daemon thread alongside the existing concept warm, so
  the first Browse → set-detail request served by a fresh process is a
  cache hit. Each warmer has its own freshness manifest (24 h for
  concepts, 1 week for set cards) so the heavier set-cards walk doesn't
  thrash on every `uvicorn --reload` cycle.
- Stats: `pkmn cache stats` surfaces a new **Set cards** line — "N sets ·
  warmed <age>" when a warm pass has landed, "not warmed · run …"
  otherwise. JSON output (`--json`) gains matching `set_cards_warm_timestamp`
  and `set_cards_warm_count` fields for monitoring.
- Web: **Browse sets** — a new **Browse** button in the header opens a
  modal that explores the Pokémon TCG catalog without typing a card
  list. The set list groups every set by series, newest-first, with
  the cached logo + release year + card count per row (reuses the
  image cache populated by `pkmn cache warm-sets`). Picking a set
  opens a responsive grid of every card with thumb / name / number /
  rarity / market price, plus search-within-set, rarity-bucket filter
  chips (All / Rares / Holos / Ultra+), and sort by number / name /
  price ↓. Each card has an **Add to list** button; bulk actions push
  every visible card, every holo, or every rare into the editor in
  one click. Lines pushed into the editor follow the parser's
  canonical `Name | Set | Number` shape and dedupe against existing
  input — clicking the same card twice doesn't double-stamp it.
- API: new `GET /api/v1/sets/{set_id}/cards` endpoint returns a
  **trimmed** card list for one set — just the fields Browse renders
  (id, name, number, rarity, supertype, subtypes, thumb URL, market
  price). A 250-card set ships ~46 KB on the wire vs hundreds of KB
  for the raw pokemontcg.io shape. Flows through the existing on-disk
  API cache, so once any user warms a set every subsequent open is a
  disk-cache hit. Browser-cacheable for a day via
  `Cache-Control: public, max-age=86400`; 404s when the set is
  unknown / empty. Malformed set ids rejected at the route boundary
  (422) by the same validator that gates the logo endpoint.
- Outputs: **Branded exports** — every artifact now carries the
  `mgz-pkmn` mark, project URL, and file-properties metadata. PDFs
  (binder, condensed, checklist, set-cards) gain a single muted
  footer line on every page (mark left, generated-at + URL centered,
  page number right) and a small wordmark above the header on page 1.
  The .xlsx workbook properties name mgz-pkmn as the author, and the
  summary footer carries a clickable `mgz-pkmn` link back to the
  project site. Logo asset lives once at `src/mgz_pkmn/assets/logo.png`
  and is shared across every writer.
- Web: **Recent searches history** — a collapsible **Recent searches**
  panel below the input editor keeps the last 10 bulk-lookup
  submissions (timestamp, line count, preview like `Charizard,
  Pikachu, +3 more`). Click an entry to restore the lines into the
  editor and rerun automatically; hover an entry for a `×` to delete
  it individually, or use **Clear all** in the panel header to wipe
  the history. Persisted via Zustand so it survives a page reload;
  consecutive duplicate submissions collapse by refreshing the
  existing entry's timestamp rather than stacking copies.
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

### Fixed

- Site: **social preview now matches the tropical look** — the
  Open Graph / Twitter card image (`/social-preview-tropical.png`)
  was still rendering the old dark zinc background and blue card
  outline from the pre-tropical era; it's been redrawn on the cream
  + sun + palm + coconut palette with the new card-and-palm logo,
  the current "Walk in with a plan, not a hope." headline, and the
  v1.2 shipping pill. Regenerable from
  [`site/scripts/social-preview.svg`](site/scripts/social-preview.svg)
  via `rsvg-convert -w 1280 -h 640 site/scripts/social-preview.svg
  -o site/public/social-preview-tropical.png`.
- Repo: **README logo now matches the rest of the brand** —
  [`assets/logo.svg`](assets/logo.svg) is replaced with the tropical
  card-and-palm logo (previously only the marketing site + SPA
  surfaced it). Every reference that uses the canonical
  `raw.githubusercontent.com/.../assets/logo.svg` URL — the README
  header, the GitHub Discussion posts that open with the inline
  logo, the welcome-email drafts — picks up the new mark on cache
  refresh; no link changes needed. The viewBox is trimmed to
  `0 0 285 88` (was `0 0 360 88` with ~80px of empty right padding),
  and a new [`assets/logo-dark.svg`](assets/logo-dark.svg) swaps
  the wordmark fill to sand-50 for dark surfaces. The README header
  uses a `<picture>` element so the right variant is picked from
  the viewer's OS dark-mode preference.
- Deploy: a transient `pokemontcg.io` timeout during the Docker build's
  `pkmn cache warm-sets` step no longer fails the whole deploy. The set
  catalog fetch now retries transient timeouts with backoff (matching the
  card-lookup path), and the build's warm step falls back to a cold cache
  on a sustained outage instead of exiting non-zero.

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

[Unreleased]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/mgzwarrior/mgz-pkmn/releases/tag/v0.1.0
