# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [1.8.0] - 2026-06-30

The "make it honest" release: the app now leads with Swipe, the Tour and Help walk the surfaces that actually shipped, the end-user docs match the live SPA, and the welcome email moved to a reason-branched drip on Resend.

### Added

- Web: **The app now opens on Swipe, the gentlest way in for a collector** ([#792](https://github.com/mgzwarrior/mgz-pkmn/issues/792), [#813](https://github.com/mgzwarrior/mgz-pkmn/issues/813), [#814](https://github.com/mgzwarrior/mgz-pkmn/issues/814)). The discovery bar reads Swipe → Browse → Search and opens on Swipe by default, Swipe picked up a card-deck icon to match the stack you flip through, and the Help modal was rebuilt around a plain-language intro and a real sample card that points newcomers to Swipe first — with an accuracy pass over Browse's By Pokédex # view, the one-tap Want / Own quick actions, and the eBay-comps / hide-owned / lookup-timer settings.
- Web: **The guided Tour drives the app through every surface instead of narrating it** ([#317](https://github.com/mgzwarrior/mgz-pkmn/issues/317), [#824](https://github.com/mgzwarrior/mgz-pkmn/issues/824)). As it advances the Tour switches discovery modes live (Swipe → Browse → Search), opens a self-contained sample card-detail modal with working ←/→ navigation and the Want / Own quick actions, and points at the Backpack's Binders, Searches, and Recent — adapting from 8 steps signed out to 10 signed in and restoring the visitor's starting mode when it closes.
- API + Site: **A reason-branched welcome drip on Resend** ([#821](https://github.com/mgzwarrior/mgz-pkmn/issues/821), [#825](https://github.com/mgzwarrior/mgz-pkmn/issues/825), [#826](https://github.com/mgzwarrior/mgz-pkmn/issues/826), [#827](https://github.com/mgzwarrior/mgz-pkmn/issues/827)). The marketing signup now asks why you're here — Collector, Show prep, or Builder — and `POST /api/v1/subscribe` creates a Resend contact and fires a New Signup event so a three-email track tailored to that reason begins, consolidating email onto the vendor that already relays magic links and retiring the paid Buttondown drip (ADR-0028 supersedes ADR-0014).

### Changed

- Docs: **The collections, wishlists, and roadmap docs were brought back in line with the shipped app** ([#793](https://github.com/mgzwarrior/mgz-pkmn/issues/793), [#802](https://github.com/mgzwarrior/mgz-pkmn/issues/802), [#818](https://github.com/mgzwarrior/mgz-pkmn/issues/818)). The collections and wishlists guides now describe the one-tap Own / Want quick actions, the Backpack's Binders tab, and the New ▾ create menus instead of the retired bookmark/heart picker, and the roadmap tracks the current v1.x cadence — the v1.10–v1.15 themed minors and the Backlog pool — with no committed v2.

### Fixed

- Site: **The Buy Me a Coffee greeting shows once per session, not on every page** ([#822](https://github.com/mgzwarrior/mgz-pkmn/issues/822), [#823](https://github.com/mgzwarrior/mgz-pkmn/issues/823)). The floating widget no longer re-opens its "thanks for stopping by" bubble on every navigation across the multi-page site; a one-time greeting gated on a session flag replaces the auto-open, and clicking it still opens the panel.

## [1.7.0] - 2026-06-25

### Added

- Web + API: **One-tap Want / Own quick actions save a card to your defaults with no setup** ([#763](https://github.com/mgzwarrior/mgz-pkmn/issues/763), [#766](https://github.com/mgzwarrior/mgz-pkmn/issues/766), [#767](https://github.com/mgzwarrior/mgz-pkmn/issues/767), [#771](https://github.com/mgzwarrior/mgz-pkmn/issues/771), [#782](https://github.com/mgzwarrior/mgz-pkmn/issues/782), [#756](https://github.com/mgzwarrior/mgz-pkmn/issues/756), closes [#759](https://github.com/mgzwarrior/mgz-pkmn/issues/759), [#760](https://github.com/mgzwarrior/mgz-pkmn/issues/760)). Every account now gets a default wishlist and a default personal collection provisioned automatically, so marking a card wanted or owned from search, browse, or swipe is a single tap. The multi-select bar switched to the same Want / Own toggles, owning a card clears its active want by default, and Browse's create entry points line up with the owned/chasing model. ADR-0027 records the direction.
- Web + API: **Binders became first-class inventory containers** ([#705](https://github.com/mgzwarrior/mgz-pkmn/issues/705), [#680](https://github.com/mgzwarrior/mgz-pkmn/issues/680), [#719](https://github.com/mgzwarrior/mgz-pkmn/issues/719), [#695](https://github.com/mgzwarrior/mgz-pkmn/issues/695), [#721](https://github.com/mgzwarrior/mgz-pkmn/issues/721), [#775](https://github.com/mgzwarrior/mgz-pkmn/issues/775), [#777](https://github.com/mgzwarrior/mgz-pkmn/issues/777)). Binders now model and present owned cards through a unified create/edit modal with physical-binder identity, a cover-color picker, set-name autocomplete with quick binder-create from Browse, a New menu that files collections into binders, smart collections backed by a shared binder-filing picker, and wishlists that file into binders too.
- Web: **Collection and wishlist detail views grew real management tools** ([#709](https://github.com/mgzwarrior/mgz-pkmn/issues/709), [#731](https://github.com/mgzwarrior/mgz-pkmn/issues/731), [#778](https://github.com/mgzwarrior/mgz-pkmn/issues/778), [#783](https://github.com/mgzwarrior/mgz-pkmn/issues/783), [#784](https://github.com/mgzwarrior/mgz-pkmn/issues/784), [#785](https://github.com/mgzwarrior/mgz-pkmn/issues/785), [#779](https://github.com/mgzwarrior/mgz-pkmn/issues/779), [#780](https://github.com/mgzwarrior/mgz-pkmn/issues/780), [#718](https://github.com/mgzwarrior/mgz-pkmn/issues/718), [#753](https://github.com/mgzwarrior/mgz-pkmn/issues/753), closes [#723](https://github.com/mgzwarrior/mgz-pkmn/issues/723), [#772](https://github.com/mgzwarrior/mgz-pkmn/issues/772)). Open a collection to view its cards in a collection-aware detail modal with save actions and ownership badges, edit owned quantity per card, add or remove a card from a specific list inline, see which collection or wishlist is the default, bring search's export options into the detail views, view a card's library locations, delete a saved search, and rely on one unified delete affordance across the library.
- Web: **Swipe learns your taste and lets you tune it** ([#717](https://github.com/mgzwarrior/mgz-pkmn/issues/717), [#715](https://github.com/mgzwarrior/mgz-pkmn/issues/715), [#716](https://github.com/mgzwarrior/mgz-pkmn/issues/716), [#752](https://github.com/mgzwarrior/mgz-pkmn/issues/752), [#678](https://github.com/mgzwarrior/mgz-pkmn/issues/678)). Swipe candidates are now weighted by a learned taste profile you can edit directly — sets, types, eras, and rarity — with favorite-set pinning suggested from your swipes and owned cards, a favorite-Pokémon picker in onboarding and the pokedex, and a wishlist nudge that moved above the card image and only appears after three saved cards.
- Web: **eBay and TCGplayer affiliate buy links across the app** ([#672](https://github.com/mgzwarrior/mgz-pkmn/issues/672), [#697](https://github.com/mgzwarrior/mgz-pkmn/issues/697), [#749](https://github.com/mgzwarrior/mgz-pkmn/issues/749)). Card surfaces gained eBay and TCGplayer buy links routed through the approved affiliate redirect, with marketplace logos and the required affiliate disclosures.
- Web: **A collection-insights dashboard surfaced in the nav** ([#751](https://github.com/mgzwarrior/mgz-pkmn/issues/751)). Collection insights now appear in the navigation alongside an expanded dashboard.
- Web: **Export moved into search mode** ([#750](https://github.com/mgzwarrior/mgz-pkmn/issues/750)). The export control now lives in search mode, where you build the result set.
- Web: **The lookup timer distinguishes a cache hit from a live fetch** ([#676](https://github.com/mgzwarrior/mgz-pkmn/issues/676)). The timer now shows whether a lookup was served from cache or fetched upstream.
- Site: **Reworked marketing header nav** ([#677](https://github.com/mgzwarrior/mgz-pkmn/issues/677)). A demo CTA, an icon-only GitHub link, and a hamburger menu on small screens.

### Changed

- API: **Bulk lookups run with bounded concurrency and cancel cleanly on disconnect** ([#674](https://github.com/mgzwarrior/mgz-pkmn/issues/674), [#675](https://github.com/mgzwarrior/mgz-pkmn/issues/675), [#673](https://github.com/mgzwarrior/mgz-pkmn/issues/673)). The `/bulk` SSE endpoint now runs lookups with bounded concurrency, cancels queued work when the client disconnects while keeping SPA progress monotonic, and memoizes the upstream session per API key to keep connections warm.

### Fixed

- Web: **Collection prices track owned quantity** ([#791](https://github.com/mgzwarrior/mgz-pkmn/issues/791)). Each row shows a per-row line total so a collection's value reflects how many copies you own.
- Web: **Clearer card-detail save actions and pickers** ([#748](https://github.com/mgzwarrior/mgz-pkmn/issues/748), [#733](https://github.com/mgzwarrior/mgz-pkmn/issues/733), closes [#732](https://github.com/mgzwarrior/mgz-pkmn/issues/732)). Card-detail save actions read more clearly, and smart collections are hidden from the save/promote pickers where they can't be written to.
- Web: **Consistent library symbols and naming** ([#619](https://github.com/mgzwarrior/mgz-pkmn/issues/619), [#706](https://github.com/mgzwarrior/mgz-pkmn/issues/706)). The library symbol system is aligned across surfaces, and the Library panel is renamed "Backpack" to match its icon.
- Web: **The tropical favicon replaces the cached purple bolt** ([#665](https://github.com/mgzwarrior/mgz-pkmn/issues/665)). The SPA favicon is cache-busted so the tropical rebrand takes effect for returning visitors.
- CLI: **Unknown root options forward to the lookup fallback** ([#658](https://github.com/mgzwarrior/mgz-pkmn/issues/658)). Unrecognized root-level options now pass through to the lookup command instead of erroring.

## [1.6.1] - 2026-06-13

### Fixed

- DevOps: **Release pipeline now tags and publishes version-bump PRs reliably** ([#652](https://github.com/mgzwarrior/mgz-pkmn/issues/652), closes [#651](https://github.com/mgzwarrior/mgz-pkmn/issues/651)). Dropped the post-publish step that attached the build to the GitHub Release — it fails under immutable releases and was blocking the milestone close and marketing-site rebuild — and the release process no longer overwrites the release-please PR body, which had stopped v1.6.0 from tagging and publishing to PyPI.

## [1.6.0] - 2026-06-13

### Added

- API + Web: **eBay joined the lineup as a fourth comps source** ([#609](https://github.com/mgzwarrior/mgz-pkmn/issues/609), [#611](https://github.com/mgzwarrior/mgz-pkmn/issues/611), [#612](https://github.com/mgzwarrior/mgz-pkmn/issues/612), [#613](https://github.com/mgzwarrior/mgz-pkmn/issues/613), [#614](https://github.com/mgzwarrior/mgz-pkmn/issues/614), [#615](https://github.com/mgzwarrior/mgz-pkmn/issues/615), [#616](https://github.com/mgzwarrior/mgz-pkmn/issues/616), [#618](https://github.com/mgzwarrior/mgz-pkmn/issues/618), closes [#422](https://github.com/mgzwarrior/mgz-pkmn/issues/422), [#423](https://github.com/mgzwarrior/mgz-pkmn/issues/423), [#424](https://github.com/mgzwarrior/mgz-pkmn/issues/424), [#425](https://github.com/mgzwarrior/mgz-pkmn/issues/425)). Card lookups now pull eBay sold and active listing comps alongside the existing sources: an OAuth client-credentials client and `EbayClient` adapter fetch them, a per-source TTL cache holds sold comps for 7 days and active for 6 hours, and the results table and card popup gained an eBay comps column with a sold-price sparkline. eBay stays gated behind configured keys with a token-rotation runbook, and ADR-0020 records eBay as the fourth source.
- Web: **Collections and want-lists merged into one Binders library** ([#639](https://github.com/mgzwarrior/mgz-pkmn/issues/639), [#504](https://github.com/mgzwarrior/mgz-pkmn/issues/504), [#507](https://github.com/mgzwarrior/mgz-pkmn/issues/507), [#575](https://github.com/mgzwarrior/mgz-pkmn/issues/575), [#647](https://github.com/mgzwarrior/mgz-pkmn/issues/647), closes [#503](https://github.com/mgzwarrior/mgz-pkmn/issues/503)). Collections and want-lists now live together under a single Binders tab: you can promote a want-list straight into a collection, an aggregate insights dashboard summarizes a binder's value and progress, each binder can print a collection ID card for its cover, and delete actions remove a binder or an individual card.
- API + Web: **Smart, rule-based collections that fill themselves from the catalog** ([#630](https://github.com/mgzwarrior/mgz-pkmn/issues/630), [#632](https://github.com/mgzwarrior/mgz-pkmn/issues/632), [#633](https://github.com/mgzwarrior/mgz-pkmn/issues/633)). Define a collection by rule and it pulls matching cards from the catalog, with a target view that toggles scope, tracks set-completion progress, and surfaces the remaining chase cards.
- Web: **Discovery learned what you already own** ([#627](https://github.com/mgzwarrior/mgz-pkmn/issues/627), [#628](https://github.com/mgzwarrior/mgz-pkmn/issues/628), [#629](https://github.com/mgzwarrior/mgz-pkmn/issues/629)). Search, browse, and swipe now show cross-collection ownership badges, search results gained a hide-owned toggle, and swipe keeps a persisted no-repeat memory while skipping cards you already own or are chasing.
- Web: **Swipe surfaces better cards** ([#626](https://github.com/mgzwarrior/mgz-pkmn/issues/626), closes [#580](https://github.com/mgzwarrior/mgz-pkmn/issues/580)). Swipe sampling now applies an age-scaled rarity floor per set and weights toward chase cards.

### Fixed

- Web: **Swipe cards reveal in place instead of sliding in** ([#625](https://github.com/mgzwarrior/mgz-pkmn/issues/625), closes [#624](https://github.com/mgzwarrior/mgz-pkmn/issues/624)). Swipe prefetches a stack of cards so the next one is ready to reveal rather than sliding in on demand.
- DevOps: **Render blueprint corrections for path filtering and preview environments** ([#637](https://github.com/mgzwarrior/mgz-pkmn/issues/637), [#641](https://github.com/mgzwarrior/mgz-pkmn/issues/641), closes [#636](https://github.com/mgzwarrior/mgz-pkmn/issues/636), [#640](https://github.com/mgzwarrior/mgz-pkmn/issues/640)). The build filter uses the correct `paths` key, and Preview Environments are enabled at the blueprint root so `previewValue` applies.

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

[1.8.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.5.0...v1.6.0
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
