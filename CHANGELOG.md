# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Design: **Styleguide published to GitHub Pages at `styleguide.mgz-pkmn.com`** ([#547](https://github.com/mgzwarrior/mgz-pkmn/issues/547), [#567](https://github.com/mgzwarrior/mgz-pkmn/issues/567)). New `.github/workflows/pages.yml` stages `design/styleguide/`, `design/tokens/`, and `assets/` into a deploy artifact (plus a `CNAME` pinning the deploy to `styleguide.mgz-pkmn.com` so it doesn't follow the maintainer's user-level `mgzwarrior.github.io` → `matt-grant.com` redirect) and publishes the tree on every push to `main` that touches `design/` or `assets/`. The root index redirects to `design/styleguide/index.html`; the relative `../tokens/colors_and_type.css` and `../../assets/*.svg` references the cards already use resolve unchanged. Separate from the marketing-site Cloudflare Pages deploy (which still hosts the product). A new `tests/test_styleguide_links.py` guard fails CI when any local `href` / `src` in a styleguide card stops resolving so a broken stylesheet or asset surfaces before review. `design/DESIGN_SYSTEM.md`, `design/INTEGRATION.md`, and `README.md` point at the hosted URL.

### Fixed

- Web: **Bookmark / heart actions pinned to the left of every ResultsTable row** ([#540](https://github.com/mgzwarrior/mgz-pkmn/issues/540)). `AddToCollectionButton` and `AddToWishlistButton` used to render in the rightmost cell, which sat off-screen behind a horizontal scrollbar whenever the table overflowed (narrow viewports, or once the comp-tier + price-source columns kicked in). They now live in their own fixed-width cell on the left edge so they stay visible regardless of column count, matching the row-actions convention used by Gmail / Linear / GitHub PR lists. The external-link icon stays at its right-end position. The new actions column is only rendered when the row-level save buttons would actually be visible (signed-in or self-host) so anonymous hosted-demo visitors see no extra empty cell.

## [1.4.0] - 2026-06-08

### Added

- Design: **Tropical design system landed as a durable, machine-checkable package** ([#543](https://github.com/mgzwarrior/mgz-pkmn/issues/543)). Adds a new `design/` folder with the canonical token source (`design/tokens/colors_and_type.css` — the `@theme` blocks in `site/src/styles/global.css` and `web/src/index.css` derive from this) plus the supporting docs (`INTEGRATION.md` cutover playbook, `CLASS_CHEATSHEET.md` find-and-replace table, `DESIGN_SYSTEM.md` voice + component guide) and `design/styleguide/*.html` rendered reference cards (publishable via GitHub Pages later). Wires `.oxlintrc.json` into `make check` via a new `lint-design` target and a CI step in the `web` job — `oxlint` enforces `no-restricted-imports` (no deep imports from `ui_kits/web/**`); the dropin's `no-restricted-syntax` regex rules for raw hex / raw px / off-system fonts are documented as a known TODO in `CLAUDE.md` since `oxlint` doesn't implement that selector yet (likely landing as an `eslint` preset with an allowlist for brand-mark SVGs and Tailwind arbitrary values). Appends a "Design system" section to `CLAUDE.md` covering the source-of-truth rule, the hard rules + exceptions, the voice pillars, and the visual-reference pointer so every agent reads the same brief.
- API + Web: **Sign in with Apple** ([#530](https://github.com/mgzwarrior/mgz-pkmn/issues/530), fifth provider in the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61) auth epic). Adds `/api/v1/auth/apple/login` and a form-POST `/api/v1/auth/apple/callback` behind the `MGZ_PKMN_AUTH_ENABLED` kill switch, plus the corresponding `/auth/link/apple/{start,callback}` pair for the Account panel. Apple's flow has three twists over GitHub / Google: (1) **No static client secret** — the API mints a short-lived `ES256` JWT per deploy (`iss=team_id`, `sub=services_id`, `aud=https://appleid.apple.com`, `kid=key_id`, 90-day lifetime under Apple's 6-month cap) and caches it in-process so we don't sign on every callback. (2) **`response_mode=form_post`** — Apple POSTs the callback as a cross-site request from `appleid.apple.com`, and browsers strip our `SameSite=Lax` session cookie on that POST. Defeats Authlib's default session-stored OAuth state; we bypass Authlib for Apple entirely and sign the `state` parameter ourselves with itsdangerous (the same trust model the magic-link tokens already use), packing `link_user_id` into the signed payload for the link flow so the cross-site POST doesn't need session identity either. (3) **`id_token` is the source of truth** — verified against Apple's JWKS at `https://appleid.apple.com/auth/keys`, with `email_verified` parsed (handling both the boolean and JSON-string shapes Apple ships) so Managed Apple Account / Work & School payloads with an unverified email are dropped before the ADR-0019 merge contract is ever invoked. `@privaterelay.appleid.com` addresses are deterministic per Services ID, so the merge anchor stays stable across re-signs. Name handling honours Apple's one-shot contract: the `user` form field is parsed on first sign-in only, and ADR-0019 first-set-wins keeps a previously-chosen `display_name` intact on subsequent re-signs. Four new env vars (`MGZ_PKMN_APPLE_CLIENT_ID` / `_TEAM_ID` / `_KEY_ID` / `_PRIVATE_KEY`) — all must be set when auth is enabled, otherwise the routes return 503 with a clear "not configured" message. SPA: the provider picker modal grows a Sign in with Apple anchor styled per Apple's HIG (official logo glyph, "Continue with Apple" copy, black-on-white / white-on-black pairing); AccountPanel's provider registry, OAuth link-start map, icon switch, and link-error allow-list include `apple` so Connect Apple works and an Apple identity from `/me` renders with the Apple chip + label. Pinned by `tests/test_auth_apple.py` covering state validation (missing, tampered, signed with the wrong secret, link-payload-on-signin), id_token signature mismatch, unverified `email_verified=false`, missing email / sub, fresh signup, existing-user reuse (display_name preserved + filled), private-relay verification, repeat sign-in keeping the first-hit name, the client-secret cache, the login redirect's signed state, and the cookie-less callback property that confirms Apple's cross-site POST does not need our session cookie to authenticate.

### Changed

- CLI + DevOps: **`cli.py` split into per-command modules, maintainability gate added to CI, repo-analysis skill captured** ([#387](https://github.com/mgzwarrior/mgz-pkmn/issues/387)). The 1761-line `src/mgz_pkmn/cli.py` is gone, replaced by a `src/mgz_pkmn/cli/` package — `lookup.py`, `set_cards.py`, `cache.py`, `exeggutor.py`, plus shared `_styling`/`_inputs`/`_cache_warn` helpers. Every command renders identical `--help` output (byte-for-byte snapshot-equivalent) and the public surface `from mgz_pkmn.cli import cli` is preserved via re-exports in `__init__.py`. The F-rank `lookup` function (CC 87) decomposes into `_read_tagged_inputs`, `_lookup_one_bulk`, `_lookup_one_single`, `_print_lookup_summary` (and friends), all under D-rank — `radon cc src/mgz_pkmn/cli -n D` is now empty. A new `make complexity` target wires `radon` into `make check` and the `api` CI matrix, failing the build on any new D-rank-or-worse function or B-rank-or-worse file outside the documented `RADON_CC_EXCLUDE`/`RADON_MI_EXCLUDE` allowlist (eight pre-existing files: spreadsheet, lookup, cache, card_images, parser, pricing, binder, report — to be tightened as each is refactored). A `.claude/skills/repo-analysis/SKILL.md` skill captures the exact LOC + complexity + MI + codecov pipeline that surfaced this hotspot so the next one is one command away.

- API: **Anonymous hosted-demo lookups now run cache-only** ([#413](https://github.com/mgzwarrior/mgz-pkmn/issues/413)). When `MGZ_PKMN_AUTH_ENABLED=1` and no user is signed in, `/lookup` and `/bulk` read the Pokemon TCG disk cache but decline live upstream fetches on misses, surfacing `X-Cache: MISS-CACHE-ONLY` for single-line misses. Signed-in users and auth-off self-hosters keep the existing live lookup path.

- API + Web: **Saved searches now require sign-in on hosted auth deployments** ([#412](https://github.com/mgzwarrior/mgz-pkmn/issues/412)). The Save Search toolbar action now reads the auth state before saving: signed-in and self-host users save immediately, while anonymous hosted visitors see a "Sign in to save" affordance that opens the provider picker with saved-search-specific copy and resumes the originally-entered name after sign-in. The saved-search sidebar avoids raw 401 errors by showing a signed-out empty state until a user is present. On the API, `GET /api/v1/runs` and `GET /api/v1/runs/{id}` are both scoped to the current user (the detail endpoint mirrors the same handoff carve-out as PATCH: an anonymous still-unnamed run is readable so the just-completed pre-sign-in stream can promote into the saved list), `PATCH /api/v1/runs/{id}` requires a user when auth is enabled (falling back to the sentinel default user only when auth is off), and signed-in `/bulk` streams persist runs against that user id. On the SPA, `useAuth` is now backed by a module-level zustand store so the header chip's sign-out propagates to every consumer in the same tick — the results-table Save buttons and the saved-search sidebar see the cleared user without waiting for a reload. The Save Search flow also moves the auth modal in front of the name prompt: clicking "Sign in to save" opens the provider picker first (no native `window.prompt` interstitial), and once the OAuth / magic-link round-trip resolves the visitor sees a design-system Radix dialog to name the search — matching the rest of the SPA's look and feel.

- Web: **Header decluttered — What's new folded into the Help modal** ([#481](https://github.com/mgzwarrior/mgz-pkmn/issues/481)). Removes the standalone "What's new" header chip and surfaces the same release-notes content as a new section inside the Help modal, fetched lazily from `GET /api/v1/changelog` on mount. The unseen-release dot (and its `lastSeenChangelogVersion` zustand wiring) now lives on the Help button — returning visitors still see a "new release available" affordance without a dedicated chip competing with the brand on narrow viewports. Test coverage migrates from `WhatsNewModal.test.tsx` into a new `HelpModal.test.tsx`; the `a11y.test.tsx` scans continue to pass against the consolidated trigger and open modal.

- Web: **Auth unification — Account panel** ([#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491), slice 3 of 3). Closes the issue by giving the user something to look at: a new "Account" item in the signed-in chip's dropdown opens a Radix dialog listing each provider already attached to the row (with the per-identity email + a Disconnect button) and surfaces the missing providers as Connect actions. Connect GitHub / Google form-POST to the slice-2 `POST /api/v1/auth/link/{github,google}/start` endpoints — the session cookie travels with the same-origin POST, and the OAuth state from Authlib provides CSRF. Connect email expands inline into a magic-link form that hits `POST /api/v1/auth/link/magic/start` and renders the same "check your inbox" confirmation the sign-in dialog uses. Disconnect calls `DELETE /api/v1/auth/identities/{id}` and is disabled when only one identity remains so the last-provider safeguard is visible up-front rather than discovered as a 400. The Account panel also auto-opens when the SPA loads on `/account`, the path the link callback redirects to, and surfaces the slice-2 `?link_error=identity_already_linked&provider=…` query param as an inline alert ("That Google account is already linked to another mgz-pkmn account"). Pinned by 7 new tests in `web/src/components/AccountPanel.test.tsx` (identity rendering, disconnect call + last-identity disable, OAuth form-POST targets, magic-link submit + confirmation, 409 conflict surface, no spurious alert for unrelated query strings) plus 1 new `SignInChip.test.tsx` test covering the Account menu item.

- API: **Auth unification — link / unlink endpoints** ([#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491), slice 2 of 3). Adds the backend management surface on top of the `user_identities` foundation from slice 1: `POST /api/v1/auth/link/github/start` and `POST /api/v1/auth/link/google/start` stash a signed-in user's pending link marker in the session and redirect to the provider; `GET /api/v1/auth/link/github/callback` and `GET /api/v1/auth/link/google/callback` consume that marker, verify the OAuth callback, and attach the proved provider identity to the current `users` row even when the provider email differs from `users.email`; `POST /api/v1/auth/link/magic/start` sends a magic-link email pointed at `GET /api/v1/auth/link/magic/callback` for attaching an additional email identity. If the proved identity already belongs to another user, callbacks return `409` with an `identity_already_linked` detail body. `DELETE /api/v1/auth/identities/{id}` removes a linked provider for the signed-in user but rejects the last identity with `400 cannot_unlink_last_identity`. `GET /api/v1/me` now includes the current user's linked identities so slice 3's Account panel can render the list without an extra request. Pinned by `tests/test_auth_links.py` covering signed-in gating, OAuth and magic-link linking, conflict handling, and last-provider unlink protection.

- API: **Auth unification — `user_identities` table + identity-first provider lookup** ([#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491), slice 1 of 3). Promotes "which provider attached to this account" from an implicit `users.name` prefix (`gh:` / `google:` / `magic:`) into a first-class `user_identities` table with a `UNIQUE(provider, provider_subject)` constraint and a CASCADE FK back to `users`. New Alembic migration `7d2e3a8c4b91` creates the table and backfills one identity row per pre-existing `users` row by parsing the prefix (the sentinel `default` row gets no identity attached). All three provider callbacks ([api/auth/github.py](api/auth/github.py) / [api/auth/google.py](api/auth/google.py) / [api/auth/magic.py](api/auth/magic.py)) now delegate to a single `resolve_or_link_identity` helper in [api/auth/identity.py](api/auth/identity.py) that resolves by `(provider, subject)` first, falls back to the verified email second (attaching a new identity row on hit — the "I signed in via GitHub last week, today I'm using Google with the same email" path is now explicit linkage rather than the silent first-set-wins merge ADR-0019 footnoted as a deferral), and mints a new `users` + first identity on a cold miss. Race recovery on both unique constraints lives in the helper so each callback stops needing its own handler. No new endpoints, no SPA changes — link / unlink endpoints land in slice 2, the SPA Account panel in slice 3. Pinned by 11 new tests in `tests/test_auth_identities.py` (migration up/down round-trip, backfill correctness across all four pre-#491 name shapes, the helper's identity-hit / email-fallback / cold-mint branches, cross-provider linking, the email-race-falls-through-to-fallback recovery shape, and the `(provider, subject)` unique constraint).

- API + Web: **Collections / wishlists gated on a signed-in user** ([#492](https://github.com/mgzwarrior/mgz-pkmn/issues/492)). Every endpoint under `/api/v1/collections` and `/api/v1/wishlists` (list / create / get / patch / delete + the item sub-tree on each) is now scoped to the user behind the session cookie. Anonymous request with `MGZ_PKMN_AUTH_ENABLED=1` → `401`; cross-account access on any per-id route 404s rather than leaking existence. Self-host installs (`MGZ_PKMN_AUTH_ENABLED=0`) keep today's behaviour by falling back to the sentinel `default` user row seeded by the first migration — no configuration change for existing self-hosters. A new `current_user_or_default` FastAPI dep in [api/auth/session.py](api/auth/session.py) carries the contract; `GET /api/v1/me` widens to a single 200 envelope (`{user, auth_enabled}`) so the SPA can distinguish "production signed-out" from "self-host" with one call (self-host surfaces the default-user payload, production-signed-out surfaces `user: null`, both report `auth_enabled` so the SignInChip knows whether to render). On the SPA, the Collections / Wishlists header chips and the row-level bookmark / heart buttons in [ResultsTable.tsx](web/src/components/ResultsTable.tsx) now hide whenever `useAuth()` reports no user — production-signed-out → chips hidden, production-signed-in → chips shown, self-host → chips shown (default user). The SignInChip itself hides when `auth_enabled` is false so self-host doesn't show a sign-in surface it has no use for. Pinned by 8 new Python tests in `tests/test_collections.py` + `tests/test_wishlists.py` (`401` on anon, cross-account `404` on the list / get / patch / delete / add-item / delete-item routes) and 5 new Vitest tests across `useAuth.test.tsx` / `SignInChip.test.tsx` / `ResultsTable.test.tsx` / `client.test.ts` (self-host envelope shape, chip hidden when `authEnabled` false, row-button hidden when `user` null, fetchMe envelope contract).

### Fixed

- API + Web: **Post-link redirect lands back in the Account modal instead of 404-ing** ([#536](https://github.com/mgzwarrior/mgz-pkmn/issues/536)). Three fixes on the same screen. (1) `api/main.py`'s `SPAStaticFiles` mount now falls back to `index.html` for any non-asset path that misses, so the OAuth link callback's redirect to `/account` lands on the SPA shell and the Account modal opens — previously the static handler returned a bare `{"detail":"Not Found"}` because `StaticFiles(html=True)` only resolves `/` to `index.html`. The fallback uses the dot-in-last-segment heuristic, so a missing hashed bundle (`/assets/foo-abc123.js`) keeps its real 404 instead of silently degrading to the SPA shell. (2) Identity-conflict on link in all five provider callbacks ([api/auth/github.py](api/auth/github.py) / [google.py](api/auth/google.py) / [discord.py](api/auth/discord.py) / [apple.py](api/auth/apple.py) / [magic.py](api/auth/magic.py)) now redirects to `/account?link_error=identity_already_linked&provider=…` instead of raising a JSON 409 — the `AccountPanel` already had UI plumbed to surface this query param as an inline alert (see [#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491) slice 3), but the redirect side of the contract was never wired up. (3) Discord's icon in [providerIcons.tsx](web/src/components/providerIcons.tsx) now renders the white mark on a blurple (`#5865F2`) rounded tile per [Discord's brand guidelines](https://discord.com/branding) instead of the mono `currentColor` silhouette. Pinned by three new `tests/test_spa_mount.py` cases (single-segment client route → 200 + SPA shell, multi-segment route → 200 + SPA shell, missing hashed asset → 404 keeps the real error) and an updated `tests/test_auth_links.py` conflict test asserting the 302 → `/account?link_error=...&provider=…` redirect shape.

- Deploy: **Magic-link SMTP env vars declared in `render.yaml`** ([#489](https://github.com/mgzwarrior/mgz-pkmn/issues/489)). `POST /api/v1/auth/magic/request` was returning 503 in production because none of the five env vars the magic-link route requires (`MGZ_PKMN_SMTP_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` / `MGZ_PKMN_MAGIC_LINK_FROM`) were declared on the `mgz-pkmn` service. Adds the five with `sync: false` so the deploy knows they're required without storing the secrets in git. Also corrects a misleading comment in [api/auth/magic.py](api/auth/magic.py): Buttondown's "SMTP endpoint" (ADR-0014) is sender-side compose-by-email for newsletter drafts, not a transactional relay — production runs against Resend (`smtp.resend.com:587`, STARTTLS), which the existing `SmtpMailer` class works against unchanged.

- Deploy: **Production OAuth callbacks now resolve as `https://`** ([#487](https://github.com/mgzwarrior/mgz-pkmn/issues/487)). The Dockerfile launched uvicorn without `--proxy-headers`, so behind Render's TLS-terminating proxy FastAPI saw the request as `http`. `request.url_for("github_callback")` (and the Google equivalent) then produced an `http://` redirect_uri that didn't match the `https://` URL registered on the OAuth apps — GitHub returned its "redirect_uri is not associated with this application" page, and Google would have failed the same way on first use. Adds `--proxy-headers --forwarded-allow-ips=*` so uvicorn trusts Render's `X-Forwarded-Proto: https` header and `url_for` resolves the scheme correctly.

- Docs: **BMC button image now renders in the README** ([#472](https://github.com/mgzwarrior/mgz-pkmn/issues/472)). The Buy Me a Coffee button-api img src added in [#471](https://github.com/mgzwarrior/mgz-pkmn/pull/471) contained raw spaces (`text=Buy me some pizza`) and a raw multibyte emoji (`emoji=🍕`); GitHub's image proxy (camo) silently refuses URLs with those characters and the button rendered as a broken image. URL-encodes `text` (`Buy%20me%20some%20pizza`) and `emoji` (`%F0%9F%8D%95`), and switches the `&` query separators to `&amp;` so the HTML stays well-formed. `curl -sI` on the encoded URL returns `HTTP/2 200` with `content-type: image/svg+xml`.

### Added

- API + Web: **Discord OAuth sign-in** ([#517](https://github.com/mgzwarrior/mgz-pkmn/issues/517)). Adds `GET /api/v1/auth/discord/login` and `/callback` behind the hosted-demo auth kill switch, using Authlib with `identify email` scopes and Discord's `/users/@me` payload. The callback rejects unverified emails, keys identities by Discord user id, reuses existing same-email accounts through the shared identity resolver, issues the existing signed session cookie, and redirects back to `/`. The account panel can label Discord identities and start Discord linking, while the sign-in picker now shows Discord alongside GitHub, Google, and magic link. Deployment docs and `render.yaml` declare `MGZ_PKMN_DISCORD_CLIENT_ID` / `MGZ_PKMN_DISCORD_CLIENT_SECRET`; tests cover OAuth errors, unverified email rejection, fresh account creation, same-email reuse, session-cookie authentication, and SPA provider rendering.

- Web: **Saved searches sidebar** ([#243](https://github.com/mgzwarrior/mgz-pkmn/issues/243)). Collapsible left-rail panel that lists runs the user has explicitly *saved* (named) via the in-page "Save search" action on the results toolbar. Each entry surfaces the name plus the timestamp / row count / total value / tag breakdown pulled from `runs.summary_json`; clicking hydrates the editor + ResultsTable from `/api/v1/runs/{id}` *and* restores the sort + per-column filter state the user had when they saved. Coexists with the client-side "Recent searches" panel under the editor — the local panel re-submits the *input*, the sidebar re-loads the *results* with view-state. Schema adds nullable `runs.name` + `runs.view_state` columns (Alembic migration `4a1c7b1e9b22`); existing unnamed runs persist server-side and stay reachable via `GET /runs/{id}`, but no longer appear in the saved-search listing. New `PATCH /api/v1/runs/{id}` promotes a streamed run into the saved-search list with a `name` and a `view_state` snapshot (opaque JSON); `GET /api/v1/runs` now filters to `name IS NOT NULL`, so the sidebar surfaces only the curated list rather than every recent run. `/bulk`'s terminating SSE frame carries `run_id` so the SPA can offer Save without an extra round-trip. Drops `POST /api/v1/runs/{id}/export` — re-exporting a stored run is now a load-then-export flow through the existing `/export` endpoint, with the full sort / format / max-price controls instead of the sidebar's xlsx-only shortcut. Closes [#58](https://github.com/mgzwarrior/mgz-pkmn/issues/58).

- Web: **Swipe discovery mode — card-at-a-time recommender UI** ([#483](https://github.com/mgzwarrior/mgz-pkmn/issues/483)). Replaces the placeholder shipped in [#482](https://github.com/mgzwarrior/mgz-pkmn/pull/482) with a real Tinder-style swipe surface for the Swipe tab. One card renders at a time and accepts pass / save / love decisions via mouse drag, touch swipe, keyboard (←/↑/→), or three action buttons; the card animates off-screen on commit and the next candidate slides in. A new `useSwipeProfile` hook owns a localStorage-backed taste profile (signed rarity / set / supertype+subtype counters) plus the saved-card list, and a `useSwipeCandidates` hook walks the six newest sets (seeded from `BAKED_SETS`, revalidated against `/api/v1/sets`) and ranks the unseen pool by profile score with market-price descending as the cold-start tie-break. Once at least one card is saved, an inline "Build prep list" CTA turns the saved cards into a new wishlist via the `useWishlists` cache so the new list shows up in the WishlistsModal without a second round-trip; the local saved list clears on success so the next session starts fresh. Pinned by 10 new Vitest tests across `useSwipeProfile.test.ts` (counter math, save/love adds-to-saved, scoreCard, clearSaved, reset) and `SwipePanel.test.tsx` (current candidate, ArrowRight save + advance, ArrowLeft pass, Build prep list flow).

- API + Web: **Wishlists — `/api/v1/wishlists` tree + minimal SPA surface** ([#245](https://github.com/mgzwarrior/mgz-pkmn/issues/245), closes [#57](https://github.com/mgzwarrior/mgz-pkmn/issues/57)). Fourth and final slice of [ADR-0013](docs/adr/0013-sqlite-persistence-for-runs-collections-wishlists.md): the "I want these" counterpart to collections, with one schema addition — `wishlist_items.max_price`, an optional `Numeric(12, 2)` alert threshold that persists today and wires to alerting later (separate feature, file when scoped). Backend mirrors the collections slice: new Alembic migration adds `wishlists` (id, user_id FK, name, description, created_at) and `wishlist_items` (id, wishlist_id FK CASCADE, card_json, notes, max_price, added_at); SQLAlchemy 2 models follow the Collection/CollectionItem pattern; seven endpoints (`GET/POST /wishlists`, `GET/PATCH/DELETE /wishlists/{id}`, `POST/DELETE /wishlists/{id}/items[/{item_id}]`) accept `max_price >= 0` with `422` on negative input. SPA adds a heart button on every matched ResultsTable row that opens a Radix dropdown listing the user's existing wishlists plus an inline "New wishlist…" form with an optional cap field (creates wishlist + adds the card with the cap in one round-trip), plus a header "Wishlists" chip that opens a Radix dialog listing every wishlist by name + card count. Both surfaces share a module-level cache (`useWishlists`) following the `useCollections` pattern from the prior slice. Pinned by 16 new Python tests in `tests/test_wishlists.py` (migration up/down round-trip with `command.downgrade(cfg, "-1")` so the collections slice underneath survives; every CRUD endpoint + its 404 paths; `max_price` persistence with and without a cap; `max_price < 0` rejection; cascade-delete) and 10 new Vitest tests across `AddToWishlistButton.test.tsx` + `WishlistsModal.test.tsx` (empty state, list rendering with item counts, add-card flow, create-and-add flow *with* the cap, create-and-add flow *without* the cap, fetch / submit error surfaces). New `docs/wishlists.md` documents the SPA surface, endpoint reference, schema, and cross-links from `docs/collections.md`.

- API + Web: **Collections — `/api/v1/collections` tree + minimal SPA surface** ([#244](https://github.com/mgzwarrior/mgz-pkmn/issues/244)). Third slice of [ADR-0013](docs/adr/0013-sqlite-persistence-for-runs-collections-wishlists.md): user-named buckets for pinning matched cards across runs. New Alembic migration adds `collections` (id, user_id FK, name, description, created_at) and `collection_items` (id, collection_id FK CASCADE, card_json, notes, added_at), with SQLAlchemy 2 models mirroring the Run/RunRow pattern from the first slice. Seven endpoints (`GET/POST /collections`, `GET/PATCH/DELETE /collections/{id}`, `POST/DELETE /collections/{id}/items[/{item_id}]`) wired into the API. SPA surface adds a bookmark button on every matched ResultsTable row that opens a small Radix dropdown listing the user's existing collections plus an inline "New collection…" form (creates + adds in one round-trip), plus a header "Collections" chip that opens a Radix dialog listing every collection by name + card count. Both surfaces share a module-level cache (`useCollections`) so creates in one path light up the other without a second fetch. Pinned by 13 new Python tests in `tests/test_collections.py` (migration up/down round-trip, every CRUD endpoint + its 404 paths, add-card round-trip end-to-end, cascade-delete behavior) and 9 new Vitest tests across `AddToCollectionButton.test.tsx` + `CollectionsModal.test.tsx` (empty state, list rendering with item counts, add-card flow, create-and-add flow, fetch / submit error surfaces). New `docs/collections.md` documents the SPA surface, endpoint reference, and schema.

- Web: **Discovery mode switcher — Search / Browse / Swipe tabs above the main column** ([#340](https://github.com/mgzwarrior/mgz-pkmn/issues/340)). First slice of the discovery-modes epic, scoped down to a single iteration: a `role="tablist"` segmented control over the main content area routes between freeform Search (the existing want-list editor + results), inline Browse (the BrowseModal's set-list + set-detail UI promoted into the page, sharing all state with the modal so the header chip still works), and a Swipe placeholder section that links back to issue [#340](https://github.com/mgzwarrior/mgz-pkmn/issues/340) for follow-up. BrowseModal's state + effects were lifted into a new `useBrowseController` hook so the modal and the inline panel share one source of truth without duplicating fetch / cache / reset behavior; the existing 16 BrowseModal tests still pass against the refactored wrapper. Four new App-level tests in `web/src/App.test.tsx` cover the default Search mode, the Browse panel rendering inline, the Swipe placeholder copy + link, and round-tripping back to Search without losing the editor's input.

- Web: **SPA sign-in UI — header chip, provider picker, signed-in state** ([#411](https://github.com/mgzwarrior/mgz-pkmn/issues/411)). Fifth slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61) hosted-demo auth epic, per [ADR-0019](docs/adr/0019-hosted-demo-identity-and-auth.md). Turns the auth backend ([#407](https://github.com/mgzwarrior/mgz-pkmn/issues/407) / [#408](https://github.com/mgzwarrior/mgz-pkmn/issues/408) / [#409](https://github.com/mgzwarrior/mgz-pkmn/issues/409) / [#410](https://github.com/mgzwarrior/mgz-pkmn/issues/410)) into something a visitor can actually use. New `web/src/components/SignInChip.tsx` mounts in the header next to the theme toggle as an icon-only control (the sign-in glyph for anonymous sessions, a circular initials avatar for signed-in ones) so the header stays uncluttered as the nav row grows. Anonymous sessions open a Radix dialog with three provider options — GitHub (anchor to `/api/v1/auth/github/login`), Google (anchor to `/api/v1/auth/google/login`), and a magic-link button that expands inline into an email field and POSTs to `/api/v1/auth/magic/request`, then shows a "check your inbox" confirmation (no enumeration leak: the response shape is identical for known and unknown addresses by design of the backend's 202). Signed-in sessions open a Radix dropdown that surfaces the user's `display_name` and email at the top of the menu plus a "Sign out" item, which POSTs to `/api/v1/auth/logout` and flips the chip back to anonymous. State is backed by a new `useAuth` hook in `web/src/hooks/useAuth.ts` that polls `GET /api/v1/me` once on mount and maps 204 No Content to `null` so the chip's signed-out path doesn't have to know about the status-code split — when a provider's OAuth callback 302s back to `/`, the hook's mount-time fetch re-runs and the chip flips to the signed-in shape without the SPA having to thread anything through the URL. New API-client helpers (`fetchMe`, `logout`, `requestMagicLink`) in `web/src/api/client.ts` keep the network surface in one place. Pinned by six new component tests in `web/src/components/SignInChip.test.tsx` covering the anonymous chip + picker shape, the OAuth anchor hrefs, the magic-link submit + confirmation + error paths, the signed-in dropdown's Sign-out flow, and the initials fallback when `display_name` is null; the existing `a11y.test.tsx` scan adds the anonymous chip and the open picker (with the magic-link form expanded) so axe enforces no violations in any of the three new dialog states.

- API: **Google OAuth sign-in** ([#410](https://github.com/mgzwarrior/mgz-pkmn/issues/410)). Fourth slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61) hosted-demo auth epic, per [ADR-0019](docs/adr/0019-hosted-demo-identity-and-auth.md). New `api/auth/google.py` registers an Authlib OAuth client against Google's OIDC discovery doc (`https://accounts.google.com/.well-known/openid-configuration`) via two env vars (`MGZ_PKMN_GOOGLE_CLIENT_ID` + `MGZ_PKMN_GOOGLE_CLIENT_SECRET`) and exposes `GET /api/v1/auth/google/login` → authorize redirect, `GET /api/v1/auth/google/callback` → ID-token exchange + verified-email read + upsert against the `users` table + session-cookie issue + 302 back to `/`. Scope is `openid email profile` — no Gmail or Drive access. Account-merge follows the same ADR-0019 first-set-wins contract as the GitHub + magic-link providers: the row is keyed on the verified email (an `email` claim without `email_verified=true` is rejected as `no_verified_email`), `display_name` is only populated when the existing row has none, and `email_verified_at` is stamped on the first sign-in that brings a verified email through. `users.name` is namespaced under `google:` followed by Google's stable `sub` identifier, keeping it domain-separated from the `gh:` and `magic:` prefixes minted by the other providers. Both routes 404 cleanly when `MGZ_PKMN_AUTH_ENABLED` is off, and 503 with a friendly message when the env vars aren't set, instead of leaking an Authlib traceback. `render.yaml` declares the two new env vars under the `mgz-pkmn-api` service with `sync: false` so the deploy knows they're required without storing the values in git. Pinned by 10 new tests in `tests/test_auth_google.py` covering the login gate (auth-off → 404 with Starlette-default body, env-missing → 503), the callback error branches (Authlib `MismatchingStateError` → 400, missing-or-unverified email → 400, empty `sub` → 400), the upsert paths (fresh signup creates a `google:`-prefixed row; existing row with a `display_name` keeps it; existing row without one is filled; concurrent-signup race recovers via `IntegrityError` rollback + re-read instead of 500), and the session-cookie acceptance criterion (the callback's cookie authenticates a subsequent `/api/v1/me` call to 200 with the new user's payload).

- API: **Magic-link sign-in via Buttondown SMTP** ([#409](https://github.com/mgzwarrior/mgz-pkmn/issues/409)). Third slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61) hosted-demo auth epic, per [ADR-0019](docs/adr/0019-hosted-demo-identity-and-auth.md). New `api/auth/magic.py` adds two routes: `POST /api/v1/auth/magic/request` (accepts `{"email": "..."}`, signs an itsdangerous `URLSafeTimedSerializer` token carrying the email, queues an SMTP send via a `BackgroundTasks` job, and **always returns 202** with an empty body so the response shape doesn't leak whether the address matched an existing account); `GET /api/v1/auth/magic/callback?token=...` (verifies the 15-minute-TTL token, upserts the `users` row keyed on the email, issues the session cookie, 302s to `/`). Account-merge follows the same first-set-wins contract as the GitHub provider: `email_verified_at` is stamped on first successful callback; `display_name` is left untouched on an existing row so a prior GitHub or Google sign-in's name survives. A new `SmtpMailer` class wraps `smtplib` (STARTTLS) and reads four `MGZ_PKMN_SMTP_*` env vars plus `MGZ_PKMN_MAGIC_LINK_FROM` for the `From:` header. The plain-text email body lives at `api/templates/auth_magic.txt`; HTML formatting is a follow-up. Pinned by 12 new tests in `tests/test_auth_magic.py` covering the gate branches (auth-off → 404 with Starlette default body, SMTP env missing → 503), the no-enumeration contract (202 + empty body for both known and unknown emails, plus garbage input), the mailer queue (a single `EmailMessage` is recorded with the correct `To`, `From`, and a callback URL in the body), token verification (tampered → 400, expired → 400 via patched `itsdangerous.timed.time.time`), the upsert paths (fresh signup creates a `magic:`-prefixed row with no `display_name`; existing row reused with `display_name` preserved), the session-cookie acceptance (callback's cookie authenticates a subsequent `/api/v1/me` to 200), and the same `IntegrityError`-recovery race as the GitHub provider.

- API: **GitHub OAuth sign-in** ([#408](https://github.com/mgzwarrior/mgz-pkmn/issues/408)). Second slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61) hosted-demo auth epic, per [ADR-0019](docs/adr/0019-hosted-demo-identity-and-auth.md). New `api/auth/github.py` registers an Authlib OAuth client for GitHub via two env vars (`MGZ_PKMN_GITHUB_CLIENT_ID` + `MGZ_PKMN_GITHUB_CLIENT_SECRET`) and exposes `GET /api/v1/auth/github/login` → authorize redirect, `GET /api/v1/auth/github/callback` → token exchange + profile fetch (login, name, and a verified primary email pulled via `/user/emails`) + upsert against the `users` table + session-cookie issue + 302 back to `/`. Account-merge follows ADR-0019 first-set-wins: the row is keyed on the verified primary email, and `display_name` is only populated when the existing row has none — a later magic-link or Google sign-in for the same address reuses the row without overwriting whatever name the user chose first. Both routes 404 cleanly when `MGZ_PKMN_AUTH_ENABLED` is off, and 503 with a friendly message when the env vars aren't set, instead of leaking an Authlib traceback. `render.yaml` declares the four new env vars under the `mgz-pkmn-api` service: `MGZ_PKMN_AUTH_ENABLED=1` lives in the blueprint (reviewable deploy policy), while `MGZ_PKMN_SESSION_SECRET` + `MGZ_PKMN_GITHUB_CLIENT_ID` + `MGZ_PKMN_GITHUB_CLIENT_SECRET` use `sync: false` so the deploy knows they're required without storing the values in git. Set the three secrets in the Render dashboard *before* merging this so the post-merge redeploy boots cleanly — production + auth-on + missing session secret is a `RuntimeError` by design. Pinned by 10 new tests in `tests/test_auth_github.py` covering the login gate (auth-off → 404 with Starlette-default body, env-missing → 503), the callback error branches (Authlib `MismatchingStateError` → 400, missing verified email → 400, empty GitHub login → 400), the upsert paths (fresh signup creates a row; an existing row with a `display_name` keeps it; an existing row without one is filled; concurrent-signup race recovers via `IntegrityError` rollback + re-read instead of 500), and the session-cookie acceptance criterion (the callback's cookie authenticates a subsequent `/api/v1/me` call to 200 with the new user's payload).

### Changed

- Docs: **Tier ladder added to the README's Support the project section** ([#474](https://github.com/mgzwarrior/mgz-pkmn/issues/474)). Replaces the single-paragraph tier mention from [#471](https://github.com/mgzwarrior/mgz-pkmn/pull/471) with a 3-column table showing each membership tier's badge image (left), explicit name + price (center), and a one-line perks summary (right). Versions the brand assets used by the table (and the BMC page itself) under `assets/bmc/` — `cover.svg` + `cover.png` (1600×400 BMC cover banner), `tier-common.svg`/`.png`, `tier-uncommon.svg`/`.png`, `tier-holo-rare.svg`/`.png` (250×150 each). README references images via raw.githubusercontent.com URLs, matching the existing logo block.

- Docs: **Q3 2026 grooming pass — second-pass refinements**
  ([#415](https://github.com/mgzwarrior/mgz-pkmn/issues/415)). Acts on
  reviewer feedback against the initial grooming PR:
  - `docs/roadmap.md` — drops the V1.0/V1.1/V1.2 shipped sections from
    the body (now one-line summaries in the Versioning policy); badges
    refreshed to in-flight milestones only; V2 entry reframed around
    the strict-semver trigger ("plugin contract goes live" or
    "hosted-demo identity becomes required"), naming the current v2.0
    milestone as a staging area for breakpoint-adjacent epics.
  - `docs/contributing.md` — Project layout section extended beyond
    `src/mgz_pkmn/` to cover `api/`, `web/`, `site/`, `tests/`, plus
    the newer mgz_pkmn modules (`card_images.py`, `set_cards.py`,
    `branding.py`, `changelog.py`).
  - `docs/cli.md` — `pkmn cache` is documented as a group with all
    eight subcommands (path, stats, clear, warm-concepts, warm-sets,
    warm-set-cards, warm-cards, warm-card-images), not just `stats`.
  - `docs/cache.md` — new "Entries vs. API calls" section showing why
    a 20k-entry cache typically represents under 1k catalog API
    calls (per-card structural fan-out from a handful of paginated
    search fetches).
  - `docs/deployment.md` — Cache warming table extended to five
    passes (was three) with their separate env-var opt-ins.
  - Two new ADRs as Proposed:
    [ADR-0023](docs/adr/0023-source-ensemble-pricing.md) (source
    ensemble for pricing display, partially superseding ADR-0002) and
    new content in ADR-0020 / ADR-0021 reflecting the ensemble model
    and the "TCGPlayer may become default if pokemontcg.io is sunset"
    forward note.
  - ADR-0002 amended with a Status note pointing to ADR-0023 for the
    pricing-priority aspect.

- Docs: **Q3 2026 grooming pass — roadmap, ADRs, cache doc cleanup**
  ([#415](https://github.com/mgzwarrior/mgz-pkmn/issues/415)).
  `docs/roadmap.md` gains a "How to read this roadmap" intro naming the
  new `epic:*` and `specialty:*` label families, plus committed
  sections for **V1.5** (eBay integration), **V1.6** (TCGPlayer
  integration), and **V2.1** (persistence-at-growth). The V2 entry for
  [#39](https://github.com/mgzwarrior/mgz-pkmn/issues/39) is re-framed
  as dual-mode + smart auto-detect, and the V3 *Vendor / power-user
  portal* section now names the vendor scanner explicitly and links to
  [ADR-0012](docs/adr/0012-open-core-architecture.md). Three new ADRs
  land as Proposed: [ADR-0020](docs/adr/0020-ebay-pricing-source.md)
  (eBay pricing source),
  [ADR-0021](docs/adr/0021-tcgplayer-first-class-pricing.md) (TCGPlayer
  first-class pricing), [ADR-0022](docs/adr/0022-query-dsl.md) (query
  DSL with dual-mode); ADR-0012 is amended to name the bulk
  card-recognition scanner as the first architectural vendor surface.
- Docs: **`docs/cache.md` TTL vs. freshness-window cleanup**
  ([#415](https://github.com/mgzwarrior/mgz-pkmn/issues/415)). The page
  previously conflated *entry-level TTLs* (structural: none, pricing:
  24 h SWR) with *per-warm-pass freshness windows* (e.g. 7 d for the
  catalog warms), which read as if the structural cache had a TTL it
  doesn't have. A new "Two kinds of 'expiry'" glossary distinguishes
  the two, the legacy `api/<sha1>.json` row's behaviour after lazy
  migration is spelled out, and the warm-passes table is re-labelled
  *Freshness window* with a paragraph explaining why concepts is 24 h
  while the catalog warms are 7 d.

### Added

- API: **Auth scaffold foundation** ([#407](https://github.com/mgzwarrior/mgz-pkmn/issues/407)). First slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61) hosted-demo auth epic, per [ADR-0019](docs/adr/0019-hosted-demo-identity-and-auth.md). New `api/auth/` package mounts Starlette's signed-cookie `SessionMiddleware` (HttpOnly, SameSite=Lax, https-only in production) and exposes `GET /api/v1/me` (200 + user payload signed-in, 204 anon) plus `POST /api/v1/auth/logout`. Alembic migration `9c4f2a7d8e15` extends `users` with `email`, `email_verified_at`, and `display_name` columns (partial-unique index on `email` so the sentinel `default` row with NULL email keeps working). Two new env vars: `MGZ_PKMN_AUTH_ENABLED` (default off, so self-hosters keep today's anonymous-everywhere behaviour with no configuration) and `MGZ_PKMN_SESSION_SECRET` (required in production when auth is on; logs a warning + uses a fixed dev fallback otherwise). No sign-in providers wired yet — those land in [#408](https://github.com/mgzwarrior/mgz-pkmn/issues/408) (GitHub OAuth), [#409](https://github.com/mgzwarrior/mgz-pkmn/issues/409) (magic link), [#410](https://github.com/mgzwarrior/mgz-pkmn/issues/410) (Google OAuth). Pinned by 17 new tests in `tests/test_auth.py` covering the env-flag parse rules, session-secret resolution (env wins, dev fallback warns, production refuses to boot), the `users` migration round-trip, `/me` + `/logout` behaviour, and the `get_current_user` dependency across the auth-off / no-cookie / dangling-id / unparseable-id / happy-path branches.
## [1.3.1] - 2026-06-02

### Fixed

- Release: **`rebuild-site` waits for the demo API to rotate before
  firing the Pages deploy hook**
  ([#399](https://github.com/mgzwarrior/mgz-pkmn/issues/399)). Cutting
  v1.3.0 fired the hook ~5 seconds after the GitHub Release was
  cut — before Render had finished rolling out the new API — so
  Astro's build-time call to `GET /api/v1/changelog` baked the
  previous version into the static HTML and the hero pill stayed
  on `Now shipping 1.2.0` until the hook was re-fired manually.
  `release.yml` now polls `https://mgz-pkmn.onrender.com/version` until it reports the
  new tag's version (15 s interval, 10 min budget) before firing
  the hook, with a warn-and-continue fall-through so a slow or
  stuck Render rollout never blocks the rebuild indefinitely.

## [1.3.0] - 2026-06-02

### Added

- API + CLI: **Split lookup cache + stale-while-revalidate on pricing**
  ([#372](https://github.com/mgzwarrior/mgz-pkmn/issues/372)). Phase 3
  of the pre-Scrydex catalog-warm epic
  ([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)) — the
  architectural shift that makes Phases 1 + 2's pre-warm pay off. The
  on-disk lookup cache now stores card payloads as **two slices**:
  structural fields (name, set, number, rarity, attacks, images, …)
  live under `cache/api_structural/` with **no TTL**, while volatile
  pricing fields (`tcgplayer.prices`, `cardmarket.prices`, `_pc_prices`,
  `_pc_url`) live under `cache/api_pricing/` with a **24 h TTL** and
  **stale-while-revalidate**. Stale reads return the cached value
  immediately and spawn a background daemon thread that re-fetches
  upstream and writes a fresh pricing slice for the next request.
  Concurrent stale reads on the same key coalesce to a single refresh
  via a process-local in-flight set guarded by one `threading.Lock`.
  Legacy `cache/api/{sha1}.json` entries from before the split migrate
  lazily on first read — the legacy file is parsed, written to both
  new locations atomically, pricing mtime preserved via `os.utime` so
  a 9d-old legacy entry stays correctly STALE, and the legacy file is
  unlinked. `/api/v1/lookup` now advertises which path served the
  request through an **`X-Cache` response header**
  (`HIT` / `STALE` / `MISS`), closing the backend half of
  [#310](https://github.com/mgzwarrior/mgz-pkmn/issues/310);
  `/sets/{set_id}/cards` + SPA chip are tracked as a tight follow-up.
  New `CacheStats` fields (`api_structural_entry_count`,
  `api_structural_bytes`, `api_pricing_entry_count`,
  `api_pricing_bytes`, `api_pricing_oldest_mtime`) surface in
  `pkmn cache stats`, `GET /api/v1/cache/stats`, and two new rows in
  the SettingsDrawer cache-stats panel. New ADR-0018 records the
  freshness-model decision; `docs/cache.md` documents the contract.
  Pinned by 20 new tests in `tests/test_cache.py` covering State A/B/C
  split reads, lazy migration with mtime inheritance, SWR coalescing,
  inflight cleanup on success/failure, and the `X-Cache` header on
  HIT / STALE / MISS for `/api/v1/lookup`.

- API + CLI: **Self-hosted per-card images via `pkmn cache warm-card-images`**
  ([#371](https://github.com/mgzwarrior/mgz-pkmn/issues/371)). Phase 2
  of the pre-Scrydex catalog-warm epic
  ([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)). Three
  pieces wired together so the SPA gets self-hosted card images
  transparently: (1) a new `pkmn cache warm-card-images` subcommand
  with `--sizes / --max-bytes / --skip-existing / --throttle-ms /
  --prefer-popular` flags walks the catalog and downloads `large` and
  `small` image bytes into `cache/images/cards/{size}/<card_id>.<ext>`
  on the persistent disk (warmer in
  [`src/mgz_pkmn/card_images.py`](src/mgz_pkmn/card_images.py)); (2)
  a new `GET /api/v1/cards/{card_id}/image/{size}` route in
  [`api/routes/cards.py`](api/routes/cards.py) streams those files
  with a 30-day immutable browser-cache header, mirroring the existing
  `get_set_logo` route's 404-on-miss contract; (3) the lookup
  response and `/sets/{id}/cards` trim now rewrite
  `images.{large,small}` and `thumb` URLs to point at that route
  whenever the file is cached on disk — cache miss leaves the upstream
  pokemontcg.io URL in place so cold deploys still serve a working
  `<img>`. A new `MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP=1` env var
  (default off, separate from the existing two warm flags) opts a
  deploy into the runtime image warm bootstrap. New `CacheStats`
  fields (`card_images_warm_timestamp`, `card_images_warm_count`,
  `card_images_warm_bytes`, `card_images_warm_budget_reached`)
  surface state in `pkmn cache stats` and `GET /api/v1/cache/stats`.
  Pinned by 25+ tests in `tests/test_warm_card_images.py` and
  `tests/test_card_images_api.py`.

- Release + site: **Marketing site auto-rebuilds after a release, and
  the "Where it's going." teaser is now milestone-driven**
  ([#362](https://github.com/mgzwarrior/mgz-pkmn/issues/362)).
  `release.yml` now fires a Cloudflare Pages deploy hook
  (`CF_PAGES_DEPLOY_HOOK`) after the GitHub Release is cut, so the
  hero pill and roadmap teaser pick up the new version once the demo
  API has rotated rather than waiting for the next `site/**` push.
  [RoadmapTeaser.astro](site/src/components/RoadmapTeaser.astro)
  now build-time-fetches the repo's milestones via the GitHub API and
  renders the most-recently-closed milestone as **Shipped**, the open
  milestone with the soonest due date as **In flight**, and the next
  open milestone as **Planned** — body copy comes from each
  milestone's description, falling back to a generic per-state line
  when empty. The previous hard-coded cards remain as the fallback
  when the GitHub call fails, matching the changelog helper's
  fail-open pattern. The rebuild job is `continue-on-error: true`,
  so a missing or bouncing deploy hook never blocks the release.

### Fixed

- Web: **Cache-stats panel upcasts byte counts through GB / TB**
  ([#390](https://github.com/mgzwarrior/mgz-pkmn/issues/390)). The
  `formatBytes` helper in
  [SettingsDrawer.tsx](web/src/components/SettingsDrawer.tsx) capped
  at MB, so once the per-card image warm
  ([#371](https://github.com/mgzwarrior/mgz-pkmn/issues/371))
  landed ~17 GB on disk the *Images* row read as `17073.0 MB`
  instead of `16.7 GB`. Function now mirrors the CLI's
  `_format_bytes` (powers-of-1024, B / KB / MB / GB / TB,
  one decimal once we leave the B range). Same pass renames the
  *Overrides* row to *URL overrides* to match the CLI label —
  the row tracks sticky `(name, set_hint) → PriceCharting URL`
  entries from `url_overrides.json`, not a generic override
  bucket. Pinned by a new test in
  [SettingsDrawer.test.tsx](web/src/components/SettingsDrawer.test.tsx)
  asserting B / KB / GB upcasting against the deployed instance's
  17 GB image-warm result.

- Docs: **`docs/cache.md` documents `pkmn cache warm-card-images`**
  ([#390](https://github.com/mgzwarrior/mgz-pkmn/issues/390)). The
  warm-passes table and env-variable reference were both missing
  Phase 2 of the catalog-warm epic
  ([#371](https://github.com/mgzwarrior/mgz-pkmn/issues/371)).
  Added rows for the `warm-card-images` command and the
  `MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP` env var, plus the
  deployed-instance final result (`40088 images warmed
  (17904440414 bytes) across 173 sets`) as a planning reference
  for disk size and first-deploy duration.

- Deploy: **`render.yaml` re-enables PR preview environments**
  ([#389](https://github.com/mgzwarrior/mgz-pkmn/issues/389)). The
  blueprint had no `previews` block, so each sync against Render
  reverted preview generation to `off` and pull requests stopped
  getting their own preview deploys. Added a top-level
  `previews: generation: automatic` so every PR against `main` now
  spins a preview environment automatically (see
  [Render's Blueprint spec](https://render.com/docs/blueprint-spec#previews)).

- Deploy: **`render.yaml` blueprint-sync fixes after #389**
  ([#392](https://github.com/mgzwarrior/mgz-pkmn/issues/392)). The
  next blueprint sync after [#391](https://github.com/mgzwarrior/mgz-pkmn/pull/391)
  failed with two errors. (1) The top-level `previews.generation`
  field added in #389 governs *multi-service* preview environments;
  for a single-service blueprint the field that actually opts the
  web service into PR preview deploys is
  `services[].previews.generation`, so move it there. Hobby
  workspaces still reject the field at sync time — previews
  require a paid workspace tier. (2) The persistent disk was
  resized in-dashboard to 50 GB after the per-card image warm
  ([#371](https://github.com/mgzwarrior/mgz-pkmn/issues/371))
  landed ~17 GB on disk; Render disallows shrinking a disk
  in-place, so the blueprint's `sizeGB: 10` was blocking every
  sync. Bumped the blueprint to `sizeGB: 50` to match the live
  disk.

- Web: **Per-line timing chips now persist after a bulk lookup
  finishes** ([#376](https://github.com/mgzwarrior/mgz-pkmn/issues/376)).
  The [ProcessingQueue](web/src/components/ProcessingQueue.tsx) early-
  returned `null` the moment `isRunning` flipped to false, so the per-
  stage chips and their elapsed-time badges vanished as soon as the
  SSE stream ended — making it impossible to compare individual queries
  against each other after the fact (cache-hit vs upstream-fetch
  benchmarks, slow-outlier debugging, etc.). The panel now stays
  mounted post-run with the heading "Last lookup", and any spinner on
  a line that was abandoned mid-stage (Stop, SSE error) freezes
  instead of animating indefinitely. The global `LookupTimer` summary
  and during-run UX are unchanged. Pinned by three new tests in
  [ProcessingQueue.test.tsx](web/src/components/ProcessingQueue.test.tsx).

- Deploy: **`render.yaml` declares `plan: starter`** instead of
  `plan: free` ([#380](https://github.com/mgzwarrior/mgz-pkmn/issues/380)).
  Render's blueprint validator rejects `disks are not supported for
  free tier services` whenever a blueprint pairs a `disk:` block with
  a free plan, so the post-#369 sync had been failing silently — none
  of the persistent disk, `XDG_CACHE_HOME=/var/cache`,
  `MGZ_PKMN_WARM_ON_STARTUP` (new addition), or
  `MGZ_PKMN_WARM_CARDS_ON_STARTUP` env vars from #375 / #377 / #379
  were actually applied to the live service. The deployed instance
  was still caching to `/root/.cache/mgz-pkmn` (ephemeral writable
  layer) and the card warm bootstrap was never triggered, which
  cascaded into the missing-logs symptom in #378. Also refreshes
  [`docs/deployment.md`](docs/deployment.md) to match the new plan and
  drops the now-obsolete "free-tier cold-start" caveat.
- API: **Warm-bootstrap log lines now reach Render's log stream**
  ([#378](https://github.com/mgzwarrior/mgz-pkmn/issues/378),
  [#382](https://github.com/mgzwarrior/mgz-pkmn/issues/382)).
  Two compounding bugs were dropping every `_log.info(...)` call from
  the four warm bootstraps, making the deploy look broken even when
  warmers were running successfully (`concept cache fresh; skipping
  startup warm`, `card warm complete: 18500 cards warmed across 173
  sets`, etc. were all going to /dev/null). **First**, `api/main.py`
  never configured the root logger, so Python's default behavior
  dropped INFO records on the floor — fixed by a module-level
  `logging.basicConfig(level=INFO, format="…[%(name)s] %(message)s")`.
  **Second**, the alembic env loaded during the startup automigrate
  called `fileConfig(...)` with its default
  `disable_existing_loggers=True`, which flips `.disabled = True` on
  every existing logger that isn't named in `alembic.ini` — including
  `api.main`, which had been instantiated moments earlier at module
  import. After that, every warm-bootstrap log call was dropped at
  `Logger.handle` regardless of level. Fixed by passing
  `disable_existing_loggers=False` in
  [`api/migrations/env.py`](api/migrations/env.py). Both branches are
  pinned by `tests/test_logging_config.py`.

### Changed

- Deploy: **Phase 1 catalog warm now enabled by default in
  `render.yaml`** — `MGZ_PKMN_WARM_CARDS_ON_STARTUP=1` joins the
  three already-enabled warm flags. First boot after this lands runs
  a full ~30 min background pass writing ~18,000 cache entries; every
  subsequent boot hits the 1-week `card_warm.json` freshness gate and
  skips. With persistent disk in place this is the bake-once,
  serve-forever shape the
  [pre-Scrydex catalog-warm epic #368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)
  is built around. Originally added as opt-in in #377 then promoted
  to default in [#378](https://github.com/mgzwarrior/mgz-pkmn/issues/378).

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

[Unreleased]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/mgzwarrior/mgz-pkmn/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mgzwarrior/mgz-pkmn/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/mgzwarrior/mgz-pkmn/releases/tag/v0.1.0
