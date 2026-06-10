# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.5.0] - 2026-06-10

### Added

- Web: **Browse and swipe cards reached parity with search result rows, and browse gained a pokédex-number view toggle across every set** ([#605](https://github.com/mgzwarrior/mgz-pkmn/issues/605), [#602](https://github.com/mgzwarrior/mgz-pkmn/issues/602)). Browse and swipe cards now surface the same details and save actions as search result rows, and browse mode can reorder any set by national pokédex number alongside the existing set-number view.
- Web: **Help modal refreshed to match the current app surfaces, with what's new folded into a top-bar version indicator** ([#600](https://github.com/mgzwarrior/mgz-pkmn/issues/600), [#601](https://github.com/mgzwarrior/mgz-pkmn/issues/601)). The what's-new callout now lives in the help modal's top bar and surfaces the running version.
- Design: **Generated exports rebranded to the tropical design system, with a refreshed output gallery** ([#599](https://github.com/mgzwarrior/mgz-pkmn/issues/599)). Exported card art and summaries now carry the tropical brand, and the sample gallery was regenerated to match.
- API: **Collections data model rework foundation** ([#574](https://github.com/mgzwarrior/mgz-pkmn/issues/574), epic [#501](https://github.com/mgzwarrior/mgz-pkmn/issues/501), follow-ups [#504](https://github.com/mgzwarrior/mgz-pkmn/issues/504), [#506](https://github.com/mgzwarrior/mgz-pkmn/issues/506), [#508](https://github.com/mgzwarrior/mgz-pkmn/issues/508), [#575](https://github.com/mgzwarrior/mgz-pkmn/issues/575), [#576](https://github.com/mgzwarrior/mgz-pkmn/issues/576), [#581](https://github.com/mgzwarrior/mgz-pkmn/issues/581), [ADR-0025](docs/adr/0025-collections-data-model-rework.md)). Collections and wishlists now carry promoted card identity, quantities, provenance, lifecycle fields, price snapshots, and collection snapshots so set-based collections, value history, ownership badges, and wishlist promotion have a durable schema.
- Design: **Styleguide published at `styleguide.mgz-pkmn.com`** ([#547](https://github.com/mgzwarrior/mgz-pkmn/issues/547), [#567](https://github.com/mgzwarrior/mgz-pkmn/issues/567)). GitHub Pages now deploys the design styleguide, tokens, and shared assets from `design/` / `assets/`, with a link-checking test and docs pointing contributors at the hosted reference.
- Auth: **Magic-link sign-in email picked up the tropical brand** ([#591](https://github.com/mgzwarrior/mgz-pkmn/issues/591), [#595](https://github.com/mgzwarrior/mgz-pkmn/issues/595)). The magic-link email now uses the current brand mark and styling.
- DevOps: **Conventional Commits enforcement and release-please version-bump PRs** ([#68](https://github.com/mgzwarrior/mgz-pkmn/issues/68), [#571](https://github.com/mgzwarrior/mgz-pkmn/issues/571), [#583](https://github.com/mgzwarrior/mgz-pkmn/issues/583), [#585](https://github.com/mgzwarrior/mgz-pkmn/issues/585), [#588](https://github.com/mgzwarrior/mgz-pkmn/issues/588), [#589](https://github.com/mgzwarrior/mgz-pkmn/issues/589)). PR commits are now checked in CI and locally with the project commit-message vocabulary; release-please opens the canonical version-bump PR while the existing tag / PyPI release chain still owns publishing. The release workflow docs now cover commit format, scope conventions, examples, the `RELEASE_PAT` scopes release-please needs, and the changelog consolidation pass that collapses the historical release notes.

### Changed

- Web: **Unified Library destination** ([#528](https://github.com/mgzwarrior/mgz-pkmn/issues/528), [#519](https://github.com/mgzwarrior/mgz-pkmn/issues/519), [#522](https://github.com/mgzwarrior/mgz-pkmn/issues/522)). Saved searches, recent searches, collections, and wishlists now live in one Library panel with tabs; desktop keeps the left-rail workflow and mobile gets a collapsed accordion above the editor. The old saved-search sidebar, recent-search panel, and collection / wishlist modals were removed in favor of per-tab components with equivalent behavior.

### Fixed

- Web: **Bookmark and heart row actions stay visible** ([#540](https://github.com/mgzwarrior/mgz-pkmn/issues/540)). Collection and wishlist buttons now render in a fixed left action cell when they are available, so horizontally overflowing result tables keep the save controls in view.

## [1.4.0] - 2026-06-08

### Added

- Design: **Tropical design system package** ([#543](https://github.com/mgzwarrior/mgz-pkmn/issues/543)). The canonical token source, integration docs, styleguide cards, design-system guidance, and `oxlint`-backed import guard now give agents and humans one shared visual reference.
- API + Web: **Hosted-demo auth grew from scaffold to full multi-provider sign-in** ([#407](https://github.com/mgzwarrior/mgz-pkmn/issues/407), [#408](https://github.com/mgzwarrior/mgz-pkmn/issues/408), [#409](https://github.com/mgzwarrior/mgz-pkmn/issues/409), [#410](https://github.com/mgzwarrior/mgz-pkmn/issues/410), [#411](https://github.com/mgzwarrior/mgz-pkmn/issues/411), [#517](https://github.com/mgzwarrior/mgz-pkmn/issues/517), [#530](https://github.com/mgzwarrior/mgz-pkmn/issues/530), [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61)). Auth can now be enabled behind the kill switch with session cookies, `/me`, logout, GitHub OAuth, Google OAuth, Discord OAuth, Apple sign-in, and Buttondown magic links. The SPA exposes the provider picker, signed-in chip, magic-link flow, sign-out action, and provider-specific chips.
- API + Web: **Collections and wishlists landed as first-class saved-card surfaces** ([#244](https://github.com/mgzwarrior/mgz-pkmn/issues/244), [#245](https://github.com/mgzwarrior/mgz-pkmn/issues/245), closes [#57](https://github.com/mgzwarrior/mgz-pkmn/issues/57)). New `/api/v1/collections` and `/api/v1/wishlists` trees support creating lists, adding cards from results, listing saved items, and rendering minimal SPA surfaces.
- Web: **Discovery modes and saved-search workflows** ([#243](https://github.com/mgzwarrior/mgz-pkmn/issues/243), closes [#58](https://github.com/mgzwarrior/mgz-pkmn/issues/58), [#340](https://github.com/mgzwarrior/mgz-pkmn/issues/340), [#482](https://github.com/mgzwarrior/mgz-pkmn/pull/482), [#483](https://github.com/mgzwarrior/mgz-pkmn/issues/483)). The main workspace now has Search / Browse / Swipe modes, a saved-searches sidebar for named runs, and a swipe discovery UI with card-at-a-time recommendations.

### Changed

- CLI + DevOps: **CLI package split and maintainability gate** ([#387](https://github.com/mgzwarrior/mgz-pkmn/issues/387)). The old monolithic `cli.py` became the `mgz_pkmn.cli` package while preserving `pkmn` help output; `make complexity` and CI now gate new high-complexity functions, with a repo-analysis skill documenting the workflow that found the hotspot.
- API + Web: **Hosted auth now gates user-owned data** ([#412](https://github.com/mgzwarrior/mgz-pkmn/issues/412), [#413](https://github.com/mgzwarrior/mgz-pkmn/issues/413), [#492](https://github.com/mgzwarrior/mgz-pkmn/issues/492)). Anonymous hosted visitors use cache-only lookups and see sign-in prompts for saved searches, collections, and wishlists, while self-host / signed-in users keep the full live-fetch and persistence paths.
- API + Web: **Auth account management unified around linked identities** ([#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491)). Provider attachment moved into `user_identities`, OAuth / magic-link providers can be linked and unlinked from the Account panel, `/me` includes linked identities, and the last-provider safeguard is visible before a user tries to disconnect it.
- Web: **What's new moved into Help** ([#481](https://github.com/mgzwarrior/mgz-pkmn/issues/481)). Release notes now load lazily inside the Help modal, with the unseen-release dot on the Help trigger instead of a dedicated header chip.
- Docs: **Roadmap, support, cache, and pricing-source planning refreshed** ([#39](https://github.com/mgzwarrior/mgz-pkmn/issues/39), [#415](https://github.com/mgzwarrior/mgz-pkmn/issues/415), [#471](https://github.com/mgzwarrior/mgz-pkmn/pull/471), [#474](https://github.com/mgzwarrior/mgz-pkmn/issues/474)). The README support section now shows the tier ladder; roadmap and contributing docs cover current milestones and project layout; cache docs distinguish TTL from warm-pass freshness; ADRs 0020-0023 capture eBay, TCGPlayer, source ensemble, and query DSL planning.

### Fixed

- API + Web: **Account-link redirects land back in the Account modal** ([#536](https://github.com/mgzwarrior/mgz-pkmn/issues/536)). Link callbacks return to `/account`, the SPA opens the Account panel on that path, and link conflicts render inline instead of marooning users on a 404.
- Deploy: **Auth production configuration fixes** ([#487](https://github.com/mgzwarrior/mgz-pkmn/issues/487), [#489](https://github.com/mgzwarrior/mgz-pkmn/issues/489)). Render declares the magic-link SMTP env vars, and uvicorn trusts proxy headers so OAuth callback URLs resolve as `https://` behind Render's proxy.
- Docs: **README sponsor assets render correctly** ([#472](https://github.com/mgzwarrior/mgz-pkmn/issues/472)). The Buy Me a Coffee button now uses a stable raw image URL.

## [1.3.1] - 2026-06-02

### Fixed

- Release: **`rebuild-site` waits for the demo API before triggering the Pages hook** ([#399](https://github.com/mgzwarrior/mgz-pkmn/issues/399)). The release workflow polls `/version` for the new tag before rebuilding the marketing site, with a warn-and-continue fallback so slow Render rollouts do not block the release.

## [1.3.0] - 2026-06-02

### Added

- API + CLI: **Split lookup cache with stale-while-revalidate pricing** ([#372](https://github.com/mgzwarrior/mgz-pkmn/issues/372), backend half of [#310](https://github.com/mgzwarrior/mgz-pkmn/issues/310), epic [#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)). Structural card data now lives in a no-TTL cache slice while pricing lives in a 24-hour stale-while-revalidate slice; legacy entries migrate lazily, stale reads coalesce background refreshes, and `/api/v1/lookup` reports `X-Cache` as `HIT`, `STALE`, or `MISS`.
- API + CLI: **Self-hosted card-image cache and warmer** ([#371](https://github.com/mgzwarrior/mgz-pkmn/issues/371)). `pkmn cache warm-card-images` downloads large / small card art into the persistent cache, `GET /api/v1/cards/{card_id}/image/{size}` serves cached images with immutable browser caching, and lookup / set-card responses rewrite image URLs when local files exist.
- Release + Site: **Marketing site rebuilds after releases and roadmap cards are milestone-driven** ([#362](https://github.com/mgzwarrior/mgz-pkmn/issues/362)). Releases can trigger the Cloudflare Pages hook after the demo API rotates, and the roadmap teaser now renders shipped / in-flight / planned cards from GitHub milestones with graceful fallback content.
- CLI / API / Web: **Catalog warm observability expanded** ([#370](https://github.com/mgzwarrior/mgz-pkmn/issues/370), [#311](https://github.com/mgzwarrior/mgz-pkmn/issues/311)). `pkmn cache warm-cards` pre-warms per-card structural entries, `/api/v1/cache/stats` exposes the CLI cache snapshot over HTTP, and the SPA Settings drawer renders the deployed instance's cache and warm-pass state.
- CLI / API / Web: **Set-warm manifest surfaced everywhere**. `sets_warm.json` and matching `sets_warm_*` stats show when the set-image cache was last warmed in the CLI, API, and SPA.

### Changed

- Deploy: **Persistent disk and runtime-only cache warming** ([#369](https://github.com/mgzwarrior/mgz-pkmn/issues/369)). Render now mounts `/var/cache`, points `XDG_CACHE_HOME` there, and warms sets at runtime behind freshness manifests instead of during Docker build.
- Deploy: **Per-card catalog warm enabled by default on Render** ([#375](https://github.com/mgzwarrior/mgz-pkmn/issues/375), [#377](https://github.com/mgzwarrior/mgz-pkmn/issues/377), [#378](https://github.com/mgzwarrior/mgz-pkmn/issues/378), [#379](https://github.com/mgzwarrior/mgz-pkmn/issues/379)). `MGZ_PKMN_WARM_CARDS_ON_STARTUP=1` joins the deployed warm flags so the expensive card pass bakes once onto the persistent disk, then serves from cache until stale.

### Fixed

- Web: **Cache Stats reads large image caches correctly** ([#390](https://github.com/mgzwarrior/mgz-pkmn/issues/390)). Byte counts now upcast through GB / TB, the override label now says URL overrides, and `docs/cache.md` documents the card-image warmer plus deployment-size planning data.
- Deploy: **Render blueprint syncs again** ([#380](https://github.com/mgzwarrior/mgz-pkmn/issues/380), [#389](https://github.com/mgzwarrior/mgz-pkmn/issues/389), [#391](https://github.com/mgzwarrior/mgz-pkmn/pull/391), [#392](https://github.com/mgzwarrior/mgz-pkmn/issues/392)). The blueprint declares a starter plan, service-level preview generation, and a 50 GB disk so persistent cache and PR-preview settings survive sync.
- Web: **Per-line timing chips persist after lookup completion** ([#376](https://github.com/mgzwarrior/mgz-pkmn/issues/376)). The processing panel now remains as "Last lookup" after an SSE run finishes, preserving stage timings for comparison and debugging.
- API: **Warm-bootstrap logs reach Render** ([#378](https://github.com/mgzwarrior/mgz-pkmn/issues/378), [#382](https://github.com/mgzwarrior/mgz-pkmn/issues/382)). App logging is configured at startup and Alembic no longer disables existing loggers during automigrate.
- API: **`MGZ_PKMN_WARM_ON_STARTUP=1` fires under the lifespan hook** ([#367](https://github.com/mgzwarrior/mgz-pkmn/issues/367)). Warm bootstraps now run from the custom lifespan generator instead of a shadowed `on_event("startup")` handler.
- Web: **Results table counts moved above the table** ([#358](https://github.com/mgzwarrior/mgz-pkmn/issues/358)). Matched / unmatched / shown counts now stay visible on long result sets.

## [1.2.0] - 2026-05-31

### Added

- Marketing: **Acquisition and launch surfaces**. The site added the v1 interest survey banner, Buttondown email signup, print-ready `/flyer` with QR code and 4-up PDF export, a hero binder grid with an asciinema demo, a "What you get" artifact gallery, and glanceable "Recently shipped" release notes sourced from the changelog.
- API: **Run history persistence** ([ADR-0013](docs/adr/0013-sqlite-persistence-for-runs-collections-wishlists.md)). Completed bulk runs are stored in SQLite via Alembic-backed `runs` / `run_rows`, with endpoints to list, load, and export prior runs; Postgres remains supported by URL for self-hosters who install a driver.
- API + Site + Web: **Changelog as the single "what's new" source**. `GET /api/v1/changelog` parses `CHANGELOG.md` into structured release notes, the marketing site uses it for the hero pill and recent releases, and the SPA added a What's new panel with last-seen state.
- CLI / API / Web: **Browse and set-card warm path**. `pkmn cache warm-set-cards`, `MGZ_PKMN_WARM_ON_STARTUP`, set-card warm stats, and `GET /api/v1/sets/{set_id}/cards` make Browse set details fast; the SPA Browse modal lets users explore sets, filter cards, and add visible / holo / rare cards to the editor.
- Web: **Search-workflow upgrades**. The SPA added recent-search history, lookup timing, color-coded per-line progress stages, and the card-detail modal with large art, identity, pricing, optional card data, and keyboard navigation.
- CLI / API: **Concept cache warming**. `pkmn cache warm-concepts`, the API startup warm flag, and `pkmn cache stats` concept rows let common concept queries resolve from cache after a warm pass.
- Outputs: **Branded exports**. PDFs and spreadsheets now carry the `mgz-pkmn` mark, project URL, generated-at metadata, page numbers, workbook properties, and a shared logo asset.

### Changed

- Repo: **Logo source of truth consolidated** ([ADR-0011](docs/adr/0011-marketing-site-stack.md#decision)). The shared light / dark SVGs now live under `assets/`, with the marketing site and SPA importing them through their build pipelines instead of carrying duplicated copies.
- Site + Web: **Tropical visual system rolled across both frontends**. The Astro site and React SPA adopted the husk / sand / sun / palm / coconut palette, paired light / dark tokens, shared logo behavior, theme persistence, and WCAG-cleared progress-stage colors.

### Fixed

- Site: **Social preview matches the tropical brand**. The Open Graph / Twitter image now uses the current palette, logo, headline, and v1.2 shipping pill.
- Repo: **README logo matches the project brand**. The canonical logo asset and README header now render the tropical mark, with a dark-mode variant selected via `<picture>`.
- Deploy: **Docker warm-set timeouts no longer fail deploys**. Transient pokemontcg.io timeouts retry with backoff, and sustained outages fall back to a cold cache instead of failing the image build.

## [1.1.1] - 2026-05-25

### Fixed

- README: the project logo now renders on the [PyPI description tab](https://pypi.org/project/mgz-pkmn/#description) by using an absolute raw GitHub URL instead of a repo-relative image path.

## [1.1.0] - 2026-05-25

### Added

- CLI: `pkmn cache clear`, `pkmn cache path`, and `pkmn cache stats --json` make the cache easier to inspect and script.
- CLI + API + Web: **Set ID card selection**. The CLI accepts repeated `pkmn set-cards --set` filters, the API accepts repeated `set_ids` for `/api/v1/set-cards.pdf`, and the SPA export dropdown opens a grouped set picker with multi-select, per-series controls, persisted selection, and cached logo thumbnails.
- CLI + API: **Set-logo image cache**. `pkmn cache warm-sets` downloads set logos and symbols into the unified image cache, `GET /api/v1/sets/{set_id}/logo` serves cached logos with immutable browser caching, and `pkmn set-cards` / `/set-cards.pdf` resolve logos from that cache.
- API: `GET /version` returns the running package version for deploy checks, monitoring, and footer display.
- Web: **Onboarding help**. The header Help modal documents the tool, query syntax, settings, exports, and keyboard shortcuts; first-time visitors see a dismissible pulse and can launch an optional guided tour.
- Web: **Example query chips** under the empty card-list input insert and run representative parser formats for first-time users.
- Dev: `make dev` builds and runs the single-image Docker artifact on `:8000` for smoke runs and demos.
- Docs: [`docs/accessibility.md`](docs/accessibility.md) records the project's accessibility commitments, enforcement points, keyboard shortcuts, and UI guidance.

### Changed

- Outputs: set-card exports now share the unified disk image cache and cached pokemontcg.io set catalog, while the CLI `--logos-dir` flag remains as an optional sidecar mirror.
- CI: Python and web tests now publish coverage artifacts to Codecov, `codecov.yml` defines informational project / patch checks and components, and `make coverage` reproduces the Python flow locally.
- Web: the header is mobile-friendly, with exports collapsed into one dropdown and Help / Settings rendered icon-only on narrow screens.
- Web: the accessibility pass closed the critical / serious axe issues across idle, modal, drawer, populated table, and expanded-filter states ([#62](https://github.com/mgzwarrior/mgz-pkmn/issues/62)).

### Fixed

- Web: export controls now always render as a single Export dropdown with the matched-row count inside the menu, keeping the header aligned after a lookup.

## [1.0.1] - 2026-05-16

### Added

- Release: GitHub Releases now publish the sdist and wheel to [PyPI](https://pypi.org/project/mgz-pkmn/) on every `v*` tag using trusted publishing, with release notes linking to the PyPI version.
- Site: the Astro 5 + Tailwind 4 marketing site landed under `site/`, including the landing page, Cloudflare Pages-ready build commands, and [ADR-0011](docs/adr/0011-marketing-site-stack.md).

## [1.0.0] - 2026-05-15

### Added

- Web: streaming bulk lookups now show per-input-line status, fading result rows, sortable and filterable result columns, export dedupe support, and a Restore defaults action in Settings.
- Project: the README and web app gained the first project logo SVG plus a 1280x640 social preview image for GitHub metadata.

## [0.1.0] - 2026-05-08

Foundation release. Establishes the full CLI pipeline, a FastAPI / React web UI, multi-source card lookup, all output formats, and release infrastructure.

### Added

#### CLI

- `pkmn lookup` parses card lists, looks up each card across open data sources, downloads images, and writes `.xlsx` reports with thumbnails, market price, and 80/85/90/95% negotiation comps.
- `pkmn set-cards` generates printable set ID cutouts without an input list.
- PDF binder exports, condensed PDF exports, printable checklist exports, JSON summary reports, dedupe, max-price filtering, sort modes, summary-only output, inline per-card price conditions, top-N / all-card lookup syntax, multi-language tokens, API response caching, cache stats, `MGZ_PKMN_NO_CACHE`, cache soft-warnings, versioned URL overrides, and the public `parse_lines()` / `CardQuery` API all shipped in the initial CLI.

#### Multi-Source Lookup

- **pokemontcg.io** is the primary English / international source with TCGPlayer and Cardmarket prices.
- **TCGdex** is the multilingual fallback for Japanese, Korean, Chinese, German, French, Spanish, Italian, Portuguese, and more, with Cardmarket prices where available.
- **PriceCharting** supports opt-in URL lookups for region-exclusive products and USD loose / new / graded prices.
- Set-overlap scoring, name-clause heuristics, and `MatchResult` error wrapping make candidate ranking and scrape failures structured.

#### Web UI

- FastAPI routes under `api/` provide `/lookup`, `/parse`, `/sets`, and `/overrides`.
- The React + Vite SPA streams results, exposes settings, wraps the root in an `ErrorBoundary`, and serves assets with `Cache-Control: no-cache` to avoid stale delivery.

#### Outputs

- `.xlsx` exports include frozen headers, widths, embedded thumbnails, currency-aware formats, and totals.
- JSON reports include `sort_mode`.
- `make refresh-examples` regenerates tracked output artifacts.

#### Infrastructure

- GitHub Actions CI, Docker image support, Render configuration, Dependabot, CodeQL, `SECURITY.md`, MIT `LICENSE`, pre-commit hooks, package metadata, and GitHub Sponsors configuration shipped with the project.

#### Documentation

- README quickstart, `docs/cli.md`, `docs/contributing.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, ADRs, roadmap, and issue / PR templates established the contributor and user docs.

### Fixed

- Parser ReDoS vulnerabilities were eliminated across multiple regex passes.
- URL substring sanitization and workflow permissions were hardened in response to CodeQL alerts.

[Unreleased]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/mgzwarrior/mgz-pkmn/releases/tag/v0.1.0
