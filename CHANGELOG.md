# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [1.6.0](https://github.com/mgzwarrior/mgz-pkmn/compare/v1.5.0...v1.6.0) (2026-06-10)


### Added

* add FastAPI backend and React+Vite frontend for mgz-pkmn web UI ([0d836a6](https://github.com/mgzwarrior/mgz-pkmn/commit/0d836a6f8fa5384119b136bfc343b723d821d9a1))
* add FastAPI backend and React+Vite frontend for mgz-pkmn web UI ([4eb903e](https://github.com/mgzwarrior/mgz-pkmn/commit/4eb903e6f2212b9ec48eb4bb561af42e1a92b687))
* **api,web:** collections — schema, /collections endpoints, minimal SPA surface ([#484](https://github.com/mgzwarrior/mgz-pkmn/issues/484)) ([5ec1d8b](https://github.com/mgzwarrior/mgz-pkmn/commit/5ec1d8b9d3015d74b1fa7fe893d696447d967b34))
* **api,web:** gate collections/wishlists on a signed-in user ([#493](https://github.com/mgzwarrior/mgz-pkmn/issues/493)) ([6e4c76a](https://github.com/mgzwarrior/mgz-pkmn/commit/6e4c76a7fdc9bd213870ff9445a0812407b2a2bd))
* **api,web:** wishlists — schema, /wishlists endpoints, minimal SPA surface ([#485](https://github.com/mgzwarrior/mgz-pkmn/issues/485)) ([6759f6d](https://github.com/mgzwarrior/mgz-pkmn/commit/6759f6d3bd6014895797ec2bb576c1c7c4d241f2))
* **api:** add auth identity link endpoints ([#497](https://github.com/mgzwarrior/mgz-pkmn/issues/497)) ([4c6a04f](https://github.com/mgzwarrior/mgz-pkmn/commit/4c6a04f2e2f347bf3270a93a59324074cee31a41))
* **api:** auth foundation — signed-cookie sessions, /me, env kill switch ([#414](https://github.com/mgzwarrior/mgz-pkmn/issues/414)) ([199124b](https://github.com/mgzwarrior/mgz-pkmn/commit/199124b3160439e71922af17d7e1b845a3665a3d))
* **api:** expose GET /api/v1/cache/stats for deployed cache introspection ([#364](https://github.com/mgzwarrior/mgz-pkmn/issues/364)) ([262b579](https://github.com/mgzwarrior/mgz-pkmn/commit/262b579fc11f1de9cfe3d91bd1e955d59feb0c74))
* **api:** GitHub OAuth sign-in ([#408](https://github.com/mgzwarrior/mgz-pkmn/issues/408)) ([#464](https://github.com/mgzwarrior/mgz-pkmn/issues/464)) ([5c8d109](https://github.com/mgzwarrior/mgz-pkmn/commit/5c8d10971700fe5c736b16a48a9852f5ba66ee2a))
* **api:** Google OAuth sign-in ([#410](https://github.com/mgzwarrior/mgz-pkmn/issues/410)) ([#479](https://github.com/mgzwarrior/mgz-pkmn/issues/479)) ([7aa308c](https://github.com/mgzwarrior/mgz-pkmn/commit/7aa308cab93a2a6a92e7003b2053ea85cac7ddf3))
* **api:** magic-link sign-in via SMTP ([#409](https://github.com/mgzwarrior/mgz-pkmn/issues/409)) ([#465](https://github.com/mgzwarrior/mgz-pkmn/issues/465)) ([7956a4c](https://github.com/mgzwarrior/mgz-pkmn/commit/7956a4c4a4fef1c7bd18ddff0f724424b57249c9))
* **api:** persistence layer — SQLite + Alembic + /runs endpoints ([#246](https://github.com/mgzwarrior/mgz-pkmn/issues/246)) ([f1f0eab](https://github.com/mgzwarrior/mgz-pkmn/commit/f1f0eabfb42a43b228b395dea153811fefd6e3d4))
* **api:** pkmn cache warm-card-images + self-hosted SPA image serving ([#385](https://github.com/mgzwarrior/mgz-pkmn/issues/385)) ([4de0da6](https://github.com/mgzwarrior/mgz-pkmn/commit/4de0da6fd661d69aad17bfca5adff95f857c2b3e))
* **api:** user_identities table + identity-first provider lookup ([#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491) slice 1) ([#494](https://github.com/mgzwarrior/mgz-pkmn/issues/494)) ([4d7730a](https://github.com/mgzwarrior/mgz-pkmn/commit/4d7730ac5de51e35a37c48de6d87d01d13eda802))
* **auth:** brand magic-link email ([#591](https://github.com/mgzwarrior/mgz-pkmn/issues/591)) ([e0d58be](https://github.com/mgzwarrior/mgz-pkmn/commit/e0d58bede3582310431d3c4c1728aa89a2355bab))
* **cache:** pre-warm _CONCEPT_KEYWORDS catalog so concept lookups are cache-hit-only ([#293](https://github.com/mgzwarrior/mgz-pkmn/issues/293)) ([c6e1812](https://github.com/mgzwarrior/mgz-pkmn/commit/c6e1812be3ede4866c2b83052b0b8ad253d76af9))
* **cache:** unified indefinite-TTL image cache + pkmn cache warm-sets ([#273](https://github.com/mgzwarrior/mgz-pkmn/issues/273)) ([d759c0c](https://github.com/mgzwarrior/mgz-pkmn/commit/d759c0c6e7fb7ff0d698b4e3bff5b46c45495dba))
* **cache:** warm-set-cards — pre-prime per-set card lists ([#309](https://github.com/mgzwarrior/mgz-pkmn/issues/309)) ([3967ba7](https://github.com/mgzwarrior/mgz-pkmn/commit/3967ba7dca46f48dc810f2b4886a76c3fe544851))
* **cli:** add `pkmn cache clear` subcommand ([#275](https://github.com/mgzwarrior/mgz-pkmn/issues/275)) ([7f55d0e](https://github.com/mgzwarrior/mgz-pkmn/commit/7f55d0eb2e608af5c3ebff0f674e8435b3e8c287)), closes [#206](https://github.com/mgzwarrior/mgz-pkmn/issues/206)
* **lookup:** split cache into structural + volatile slices, SWR on pricing ([#395](https://github.com/mgzwarrior/mgz-pkmn/issues/395)) ([28b1556](https://github.com/mgzwarrior/mgz-pkmn/commit/28b15567b9953c0bf12860991d01531e6d5e050c))
* **marketing:** v1 interest survey + announcement banner ([#337](https://github.com/mgzwarrior/mgz-pkmn/issues/337)) ([e864a83](https://github.com/mgzwarrior/mgz-pkmn/commit/e864a83bcd697993ed5674e5f9a221f97506f957))
* **outputs:** brand every export with mgz-pkmn (logo, footer, link) ([#299](https://github.com/mgzwarrior/mgz-pkmn/issues/299)) ([1ac1cba](https://github.com/mgzwarrior/mgz-pkmn/commit/1ac1cbab790d68982864d05d36ad63b971e973ad))
* rebrand generated exports to the tropical design system + refresh gallery ([#599](https://github.com/mgzwarrior/mgz-pkmn/issues/599)) ([7075f7c](https://github.com/mgzwarrior/mgz-pkmn/commit/7075f7c7a64b43f80f833dde14179d89a798f4c2))
* **release+site:** auto-rebuild Pages on release; milestone-driven roadmap teaser ([#396](https://github.com/mgzwarrior/mgz-pkmn/issues/396)) ([ea8805f](https://github.com/mgzwarrior/mgz-pkmn/commit/ea8805f2a43220be3d77b98cabdcc6e5585bc2d7))
* **site:** add 'Built in the open' contributor section to homepage ([#289](https://github.com/mgzwarrior/mgz-pkmn/issues/289)) ([fe536ff](https://github.com/mgzwarrior/mgz-pkmn/commit/fe536ffb1e03a83e744d5321dea4881b9c8c365e)), closes [#284](https://github.com/mgzwarrior/mgz-pkmn/issues/284)
* **site:** add Contribute link to header nav ([#290](https://github.com/mgzwarrior/mgz-pkmn/issues/290)) ([bfd12e6](https://github.com/mgzwarrior/mgz-pkmn/commit/bfd12e66abe4ff5bca5b246dd051ca1d8f89c9b1)), closes [#283](https://github.com/mgzwarrior/mgz-pkmn/issues/283)
* **site:** add dedicated /contribute page ([#291](https://github.com/mgzwarrior/mgz-pkmn/issues/291)) ([d131201](https://github.com/mgzwarrior/mgz-pkmn/commit/d1312017921bb9e7f41be443698ef86a910b6c7a))
* **site:** email signup + homepage reorder + compact release notes ([#332](https://github.com/mgzwarrior/mgz-pkmn/issues/332)) ([2877b33](https://github.com/mgzwarrior/mgz-pkmn/commit/2877b338c7861868fac87536dd6fc9d5d8698041))
* **site:** print-ready show flyer at /flyer ([#331](https://github.com/mgzwarrior/mgz-pkmn/issues/331)) ([769aa7b](https://github.com/mgzwarrior/mgz-pkmn/commit/769aa7beabd4d2c4634fc07ced3044446dd940be))
* **site:** real visuals in hero (binder grid + cast) + output gallery ([#314](https://github.com/mgzwarrior/mgz-pkmn/issues/314)) ([0ec5b35](https://github.com/mgzwarrior/mgz-pkmn/commit/0ec5b3526dde120e68a3a7e48fcb41297c4bf06e))
* **site:** roll out the tropical design system ([#301](https://github.com/mgzwarrior/mgz-pkmn/issues/301)) ([80d116f](https://github.com/mgzwarrior/mgz-pkmn/commit/80d116f027a0f1a569d39ec4685e120bcd6e38e0))
* **site:** surface live OSS signals on /contribute via GitHub API at build time ([#295](https://github.com/mgzwarrior/mgz-pkmn/issues/295)) ([cd325f5](https://github.com/mgzwarrior/mgz-pkmn/commit/cd325f55a69984a99bcccde0fc025ddada8b31ef)), closes [#287](https://github.com/mgzwarrior/mgz-pkmn/issues/287)
* **site:** surface release notes from CHANGELOG via a shared API endpoint ([#318](https://github.com/mgzwarrior/mgz-pkmn/issues/318)) ([4350a39](https://github.com/mgzwarrior/mgz-pkmn/commit/4350a39be0462490bdea175a09a1b9767ffb636b))
* **site:** sweep dark mode onto the husk/sand/sun palette ([#343](https://github.com/mgzwarrior/mgz-pkmn/issues/343)) ([c12c4b7](https://github.com/mgzwarrior/mgz-pkmn/commit/c12c4b7b48edee612d3b7f1d27d5d0e30401f162))
* **web:** "What's new" panel in the SPA, sourced from /api/v1/changelog ([#320](https://github.com/mgzwarrior/mgz-pkmn/issues/320)) ([24aea8c](https://github.com/mgzwarrior/mgz-pkmn/commit/24aea8c68eeda155b2077321fbccf424182530f3))
* **web:** account panel for linked sign-in providers ([#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491) slice 3) ([#498](https://github.com/mgzwarrior/mgz-pkmn/issues/498)) ([498dbee](https://github.com/mgzwarrior/mgz-pkmn/commit/498dbeea1d1b37da5aa7cbbac5a5b00039370ac0))
* **web:** browse + swipe cards reach parity with search result rows ([#605](https://github.com/mgzwarrior/mgz-pkmn/issues/605)) ([a649e2c](https://github.com/mgzwarrior/mgz-pkmn/commit/a649e2c63c25fb9b1ffb8367800978ae10545e41))
* **web:** browse pokedex-# view toggle across all sets ([#602](https://github.com/mgzwarrior/mgz-pkmn/issues/602)) ([c925c73](https://github.com/mgzwarrior/mgz-pkmn/commit/c925c73594080effae3dfbd1f359128bec80cbff))
* **web:** browse sets — explore cards by set without typing a list ([#304](https://github.com/mgzwarrior/mgz-pkmn/issues/304)) ([46954a3](https://github.com/mgzwarrior/mgz-pkmn/commit/46954a3357780627ff936facc728d13bc8554b2a))
* **web:** card detail modal — tap a results row for full card + keyboard nav ([#296](https://github.com/mgzwarrior/mgz-pkmn/issues/296)) ([7af7205](https://github.com/mgzwarrior/mgz-pkmn/commit/7af7205a00436b4233fbf8639e5048da1cdec3f1))
* **web:** collapse what's new into a help-modal top bar with version indicator ([#600](https://github.com/mgzwarrior/mgz-pkmn/issues/600)) ([1b97f94](https://github.com/mgzwarrior/mgz-pkmn/commit/1b97f94b685c289763f5acfdde007347809581d5))
* **web:** discovery mode switcher — Search / Browse / Swipe ([#340](https://github.com/mgzwarrior/mgz-pkmn/issues/340)) ([#482](https://github.com/mgzwarrior/mgz-pkmn/issues/482)) ([7666707](https://github.com/mgzwarrior/mgz-pkmn/commit/7666707f9f0cb0c3106323744c9d1dd14ca5b04e))
* **web:** expose lookup timer in the UI + publish benchmarks ([#297](https://github.com/mgzwarrior/mgz-pkmn/issues/297)) ([f5ddf81](https://github.com/mgzwarrior/mgz-pkmn/commit/f5ddf81d3a69f6e33f068bade9cbba26364fed2a))
* **web:** instant set-list — bake catalog into SPA + stale-while-revalidate ([#306](https://github.com/mgzwarrior/mgz-pkmn/issues/306)) ([bec3868](https://github.com/mgzwarrior/mgz-pkmn/commit/bec386862b2cba895a4ca7aa3826c3682d161840))
* **web:** recent searches history — one-click rerun of prior lookups ([#298](https://github.com/mgzwarrior/mgz-pkmn/issues/298)) ([5f6d466](https://github.com/mgzwarrior/mgz-pkmn/commit/5f6d466b49a0ce92ffa92f58218410b119b0bada))
* **web:** refresh help modal to match current app surfaces ([#601](https://github.com/mgzwarrior/mgz-pkmn/issues/601)) ([c6f20a2](https://github.com/mgzwarrior/mgz-pkmn/commit/c6f20a2de8468f3d46a9c300a3e326da8b82dc74))
* **web:** run-history sidebar + click-to-load + re-export ([#403](https://github.com/mgzwarrior/mgz-pkmn/issues/403)) ([e37a773](https://github.com/mgzwarrior/mgz-pkmn/commit/e37a773bcbb3bb7e32520b08331499f58c251bfd))
* **web:** set picker modal for Set ID cards export ([#274](https://github.com/mgzwarrior/mgz-pkmn/issues/274)) ([9b0a54b](https://github.com/mgzwarrior/mgz-pkmn/commit/9b0a54bb1d964a478ec3bb881341258221a612b1))
* **web:** SPA sign-in UI — header chip, provider picker, signed-in state ([#480](https://github.com/mgzwarrior/mgz-pkmn/issues/480)) ([8f4fef9](https://github.com/mgzwarrior/mgz-pkmn/commit/8f4fef91e93d95b337dc3bf5adfe0820517bd2cd))
* **web:** Swipe discovery mode — card-at-a-time recommender UI ([#483](https://github.com/mgzwarrior/mgz-pkmn/issues/483)) ([#486](https://github.com/mgzwarrior/mgz-pkmn/issues/486)) ([25f09cb](https://github.com/mgzwarrior/mgz-pkmn/commit/25f09cbdcc0f997bd4eec3151f0f182431666eeb))
* **web:** tropical palette + light/dark theme toggle for the SPA ([#347](https://github.com/mgzwarrior/mgz-pkmn/issues/347)) ([22f0fc2](https://github.com/mgzwarrior/mgz-pkmn/commit/22f0fc25ee3eba75213fa078f441e680b1e64dc8))


### Fixed

* **api:** MGZ_PKMN_WARM_ON_STARTUP fires again (folded into lifespan) ([#374](https://github.com/mgzwarrior/mgz-pkmn/issues/374)) ([ef98cd9](https://github.com/mgzwarrior/mgz-pkmn/commit/ef98cd9b2aa87da25c533d5a3aadc25222526877))
* **api:** warm log invisibility — alembic env was disabling api.main logger ([#383](https://github.com/mgzwarrior/mgz-pkmn/issues/383)) ([0c74ddd](https://github.com/mgzwarrior/mgz-pkmn/commit/0c74dddb78e2a5c31998aa0bb5a50882db22ae71))
* **auth:** refresh magic-link email logo to current brand ([#595](https://github.com/mgzwarrior/mgz-pkmn/issues/595)) ([0700c72](https://github.com/mgzwarrior/mgz-pkmn/commit/0700c7269e5d710d5f610a70e8b1ac9eba489bbd))
* **ci:** document RELEASE_PAT scopes required by release-please ([#588](https://github.com/mgzwarrior/mgz-pkmn/issues/588)) ([7a6b958](https://github.com/mgzwarrior/mgz-pkmn/commit/7a6b95854c533198198e803aed60aea68239d0d9))
* **deploy:** declare magic-link SMTP env vars in render.yaml ([#490](https://github.com/mgzwarrior/mgz-pkmn/issues/490)) ([dc4472f](https://github.com/mgzwarrior/mgz-pkmn/commit/dc4472fc29240c9fefed78a3e14f9d942090091f))
* **deploy:** enable uvicorn --proxy-headers so OAuth redirect_uri is https ([#488](https://github.com/mgzwarrior/mgz-pkmn/issues/488)) ([ce15027](https://github.com/mgzwarrior/mgz-pkmn/commit/ce150275fd1d20e1f68f3103749ebac505b728fe))
* **deploy:** make set-catalog warm best-effort so a flaky API can't fail the build ([#327](https://github.com/mgzwarrior/mgz-pkmn/issues/327)) ([63bf064](https://github.com/mgzwarrior/mgz-pkmn/commit/63bf064e4f6e8ea5692248ed11e9fe60c4bb2422)), closes [#326](https://github.com/mgzwarrior/mgz-pkmn/issues/326)
* **deploy:** move previews into the service block + bump disk to 50 GB ([#393](https://github.com/mgzwarrior/mgz-pkmn/issues/393)) ([47ab8d7](https://github.com/mgzwarrior/mgz-pkmn/commit/47ab8d786b0854ccd90375438a77dd8db1680687)), closes [#392](https://github.com/mgzwarrior/mgz-pkmn/issues/392)
* **deploy:** re-enable PR preview environments in render.yaml ([#391](https://github.com/mgzwarrior/mgz-pkmn/issues/391)) ([4c0c34d](https://github.com/mgzwarrior/mgz-pkmn/commit/4c0c34db1f1e8e73426fbf35a7299455e5d7d9e3)), closes [#389](https://github.com/mgzwarrior/mgz-pkmn/issues/389)
* **deploy:** render.yaml declares plan: starter so the disk block validates ([#381](https://github.com/mgzwarrior/mgz-pkmn/issues/381)) ([2ce9c06](https://github.com/mgzwarrior/mgz-pkmn/commit/2ce9c0665861839d9f959b37e865b5fbcb122dd1))
* **deploy:** warm-bootstrap logs visible in Render + enable Phase 1 catalog warm ([#379](https://github.com/mgzwarrior/mgz-pkmn/issues/379)) ([7e8ef5b](https://github.com/mgzwarrior/mgz-pkmn/commit/7e8ef5b6c51d492889c91cdc1acb0711c8ad44ea))
* **docker:** allow CHANGELOG.md into the build context ([#319](https://github.com/mgzwarrior/mgz-pkmn/issues/319)) ([6c61d39](https://github.com/mgzwarrior/mgz-pkmn/commit/6c61d3944e1c4ab0df28a2f60385e3f584f3d544))
* eliminate final ReDoS paths by replacing suffix regex with str.rsplit+frozenset ([d307e7f](https://github.com/mgzwarrior/mgz-pkmn/commit/d307e7f51d933f358b88629c7fd136fabdb93ee8))
* harden parser regexes against ReDoS (polynomial backtracking) on user-supplied input ([93f439a](https://github.com/mgzwarrior/mgz-pkmn/commit/93f439a63f740d45f904b0fe5c334bc3dffa388e))
* **release:** wait for demo API to rotate before firing Pages hook ([#400](https://github.com/mgzwarrior/mgz-pkmn/issues/400)) ([8ac3370](https://github.com/mgzwarrior/mgz-pkmn/commit/8ac33701372e9f37c49263380bbb66f1ce329aed))
* replace final backtracking regex with str.rstrip for trailing separator cleanup ([ed86d8c](https://github.com/mgzwarrior/mgz-pkmn/commit/ed86d8c01981603b6f95e3439a7fc76f55ffd5d2))
* rewrite bulk-phrase regexes to eliminate remaining ReDoS paths in parser ([a8ab319](https://github.com/mgzwarrior/mgz-pkmn/commit/a8ab31970ca674de565f526c4edb81d7a11143f2))
* **site:** redraw social preview on the tropical palette ([#354](https://github.com/mgzwarrior/mgz-pkmn/issues/354)) ([94e3e2c](https://github.com/mgzwarrior/mgz-pkmn/commit/94e3e2cc5b1274640c356d093c38239624e80183))
* **site:** use www.matt-grant.com on the flyer contact line ([#335](https://github.com/mgzwarrior/mgz-pkmn/issues/335)) ([85bcc60](https://github.com/mgzwarrior/mgz-pkmn/commit/85bcc60e1a276519cb06bfd7f141c3d894903862)), closes [#334](https://github.com/mgzwarrior/mgz-pkmn/issues/334)
* **web:** always render export controls as a dropdown ([#252](https://github.com/mgzwarrior/mgz-pkmn/issues/252)) ([c3c7444](https://github.com/mgzwarrior/mgz-pkmn/commit/c3c74442936089a5bfc1e491e10d711ab257b8fc))
* **web:** move results-table counts above the table ([#363](https://github.com/mgzwarrior/mgz-pkmn/issues/363)) ([b3360cf](https://github.com/mgzwarrior/mgz-pkmn/commit/b3360cf31d9f1c99321f8d7b014d40eea944dbb7))
* **web:** persist per-line timer chips after a bulk lookup finishes ([#384](https://github.com/mgzwarrior/mgz-pkmn/issues/384)) ([bfe96c2](https://github.com/mgzwarrior/mgz-pkmn/commit/bfe96c2cc8e604c4abc29b1b60ec5fd0d2a22308))
* **web:** upcast cache-stats byte counts through GB / TB ([#394](https://github.com/mgzwarrior/mgz-pkmn/issues/394)) ([4925dc9](https://github.com/mgzwarrior/mgz-pkmn/commit/4925dc9ebb543a16ec7100b7ac3cf893b3893004)), closes [#390](https://github.com/mgzwarrior/mgz-pkmn/issues/390)


### Changed

* add "Environment variables" section to README ([#240](https://github.com/mgzwarrior/mgz-pkmn/issues/240)) ([00aacc1](https://github.com/mgzwarrior/mgz-pkmn/commit/00aacc1f4b39ff67eeae5a1346b88c373cd58f66)), closes [#210](https://github.com/mgzwarrior/mgz-pkmn/issues/210)
* add ADRs for v1.2 deliverables (0014–0017) ([#355](https://github.com/mgzwarrior/mgz-pkmn/issues/355)) ([92f2162](https://github.com/mgzwarrior/mgz-pkmn/commit/92f21628cc92fa2ab0589f81213d981cc3696a58))
* add CITATION.cff metadata ([#140](https://github.com/mgzwarrior/mgz-pkmn/issues/140)) ([d3e37b4](https://github.com/mgzwarrior/mgz-pkmn/commit/d3e37b46e089fabb299c62f4876d87dce369729e))
* add CLI troubleshooting guide ([#143](https://github.com/mgzwarrior/mgz-pkmn/issues/143)) ([8603a3a](https://github.com/mgzwarrior/mgz-pkmn/commit/8603a3a7096f82ef12dff5ca4a767b23674c2c7e))
* add GitHub Discussions entry points ([#142](https://github.com/mgzwarrior/mgz-pkmn/issues/142)) ([48fefcd](https://github.com/mgzwarrior/mgz-pkmn/commit/48fefcd0c729ec6a62f0b729ada081787637336a))
* **adr:** ADR-0013 — SQLite + Alembic persistent store ([#241](https://github.com/mgzwarrior/mgz-pkmn/issues/241)) ([05cce2a](https://github.com/mgzwarrior/mgz-pkmn/commit/05cce2a886ccef64e1fbbf7fefe07903cd00bd42))
* **adr:** ADR-0019 — hosted-demo identity and auth posture ([#406](https://github.com/mgzwarrior/mgz-pkmn/issues/406)) ([3df193e](https://github.com/mgzwarrior/mgz-pkmn/commit/3df193e08e5e490fb4d042cd5194f54b46c78987))
* **changelog:** add unreleased entries for [#267](https://github.com/mgzwarrior/mgz-pkmn/issues/267) / [#304](https://github.com/mgzwarrior/mgz-pkmn/issues/304) (browse sets) ([#307](https://github.com/mgzwarrior/mgz-pkmn/issues/307)) ([39bbac4](https://github.com/mgzwarrior/mgz-pkmn/commit/39bbac4419258315d5092161abfeb03d3efd6f29))
* **changelog:** consolidate historical release notes ([#589](https://github.com/mgzwarrior/mgz-pkmn/issues/589)) ([b0f2fb8](https://github.com/mgzwarrior/mgz-pkmn/commit/b0f2fb816eec82257f91897a25c93bac642cd238))
* explain the over-cap row fill in xlsx output ([#276](https://github.com/mgzwarrior/mgz-pkmn/issues/276)) ([2f48106](https://github.com/mgzwarrior/mgz-pkmn/commit/2f48106db91b35e19a9aa0c5a69d1bb6c5b2c20c))
* **marketing:** draft 3-email welcome sequence ([#333](https://github.com/mgzwarrior/mgz-pkmn/issues/333)) ([045d6bf](https://github.com/mgzwarrior/mgz-pkmn/commit/045d6bf7a4ebe07035988aa35e1f78ae2b7dd51d))
* project grooming pass — roadmap, ADRs, cache doc cleanup ([#454](https://github.com/mgzwarrior/mgz-pkmn/issues/454)) ([3e582c6](https://github.com/mgzwarrior/mgz-pkmn/commit/3e582c6c9e04ad7bd5232cec2af97f9fdbb893f3))
* **README:** use absolute logo URL so PyPI renders it ([#280](https://github.com/mgzwarrior/mgz-pkmn/issues/280)) ([e1a6216](https://github.com/mgzwarrior/mgz-pkmn/commit/e1a6216cb4b1cd7c9d2dbf39efe2088610fd5404))
* refresh curated starter issues table ([#216](https://github.com/mgzwarrior/mgz-pkmn/issues/216)) ([1ecbbac](https://github.com/mgzwarrior/mgz-pkmn/commit/1ecbbac084ba56ffe2e8f58cf3fe14bfd241df72)), closes [#215](https://github.com/mgzwarrior/mgz-pkmn/issues/215)
* refresh curated starter issues table ([#237](https://github.com/mgzwarrior/mgz-pkmn/issues/237)) ([7063cbb](https://github.com/mgzwarrior/mgz-pkmn/commit/7063cbbd994e3570ae1a2b2bd6b376fac9f9c54b))
* **release:** add CHANGELOG consolidation step to cut-release skill ([#585](https://github.com/mgzwarrior/mgz-pkmn/issues/585)) ([41c37b7](https://github.com/mgzwarrior/mgz-pkmn/commit/41c37b7b22bdb572845bc25032b5a7647ae46dce))
* require screenshots or Jam videos as PR verification artifacts ([#254](https://github.com/mgzwarrior/mgz-pkmn/issues/254)) ([273ba78](https://github.com/mgzwarrior/mgz-pkmn/commit/273ba78298f0a7e3131a77a657018e25dee5e7e1))
* **site:** refresh stale version copy in hero and roadmap ([#288](https://github.com/mgzwarrior/mgz-pkmn/issues/288)) ([203af94](https://github.com/mgzwarrior/mgz-pkmn/commit/203af948c0c63331fb7f59867187b1cbc179b0dd)), closes [#285](https://github.com/mgzwarrior/mgz-pkmn/issues/285)

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
