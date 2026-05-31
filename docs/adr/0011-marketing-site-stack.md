# ADR 0011: Marketing site under `site/` (Astro + Tailwind, Cloudflare Pages)

- **Status:** Accepted
- **Date:** 2026-05-16
- **Tags:** marketing, infra, site

## Context

With 1.0 shipped, the GitHub README is no longer the right surface for
every audience. It serves developers landing on the repo well — install
instructions, API key setup, contributing guide — but the project's
actual end users (Pokemon TCG collectors prepping for card shows) need
an end-user-facing entry point that explains the value, shows the
outputs, and links to the live demo and the repo.

That surface needs a custom domain to be shareable (the GitHub URL is
the project, not a destination), and it needs to be visually composed
in a way the README isn't — hero, features grid, "how it works,"
roadmap teaser, footer with community links.

Constraints:

- Solo maintainer. The site can't add meaningful operational overhead
  or a second deploy pipeline that needs babysitting.
- Site copy should ship atomically with the features it describes.
  If the CLI gets a new flag, the site should reflect it in the same
  PR, not days later in a separate repo.
- Pure static output. No SSR, no API routes, no server runtime — the
  site is marketing content, not the application.
- Free or near-free hosting. The project doesn't generate revenue (yet),
  and a marketing site shouldn't have a fixed monthly cost.

## Decision

Build a one-page marketing site at `site/` in the main repo using
Astro 5 + Tailwind 4. Deploy to Cloudflare Pages on a custom domain.

Specifically:

- **Astro 5** for the framework. Component-based, zero-JS by default,
  excellent build performance, mature templating syntax. Pure static
  output is the default mode — no adapter needed.
- **Tailwind 4** via `@tailwindcss/vite` plugin. CSS-first config
  via `@theme` (no `tailwind.config.mjs`). Brand color tokens live in
  `src/styles/global.css`.
- **Single page** (`src/pages/index.astro`) composed of six small
  components (Header, Hero, FeaturesGrid, HowItWorks, RoadmapTeaser,
  Footer) — easier to iterate than a multi-page site, and the
  project's scope doesn't warrant separate Pricing / Blog / Docs
  pages today.
- **Cloudflare Pages** for hosting. Free tier with unlimited bandwidth,
  no cold starts, automatic HTTPS, custom-domain support, GitHub
  integration with auto-deploy on push to `main`. The Pages project
  is configured via the Cloudflare dashboard (one-time, UI-only); the
  per-deploy build config (root dir, build command) is documented in
  [`site/README.md`](../../site/README.md).
- **CI gate**: a new `site` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
  runs `npm ci && npm run build` on every PR so broken builds don't
  reach Cloudflare Pages.
- **Shared assets**: the canonical brand SVGs (`assets/logo.svg`,
  `assets/logo-dark.svg`) live once at the repo root and are
  pulled into the marketing site via relative Vite imports
  (`import logoUrl from "../../../assets/logo.svg?url"` in
  `Header.astro` / `Footer.astro`). Vite resolves the path, bundles
  the asset, and emits a hashed URL under `_astro/` — no copy
  step, no symlink, no drift across surfaces (see [#360](https://github.com/mgzwarrior/mgz-pkmn/issues/360)
  for the consolidation from the prior copy-forward approach).
  `astro.config.mjs` opts the dev server's `fs.allow` up one level
  so the import resolves at dev time too. The `site/` build still
  needs the repo checkout to include `assets/` — true in CI and
  in any local checkout. Larger PNG assets (social preview) stay
  in `site/public/` because they're served as static files for
  Open Graph metadata, not bundled into components.

## Consequences

- Site lives next to the code; site copy can ship in the same PR as
  the feature it describes. PRs that change observable behavior can
  include the corresponding hero/feature/copy update atomically.
- Astro is small enough (~300 packages, 281 ms build) that the
  repo's `site/node_modules` footprint is negligible and the CI job
  finishes in under a minute. The `clean` Makefile target tears
  everything down.
- Cloudflare Pages handles HTTPS, CDN, and auto-deploys with no
  per-deploy operational work. Build config is in the Pages
  dashboard, not a `wrangler.toml` in the repo — keeps the repo free
  of provider-specific config files.
- The site is pure static output. Adding interactivity (a stale
  pricing widget, embedded demo, etc.) means either adding a
  client-side island (Astro supports this) or a tiny serverless
  function — both available without re-platforming.
- Brand SVGs have a single source of truth under `assets/`. Each
  surface (marketing site, demo SPA) imports from the same files
  via Vite, so a logo change is one file edit instead of a
  six-file sweep. The `?url` import returns a hashed URL so each
  surface's bundler still handles cache-busting on its own.
- Cloudflare Pages requires a one-time UI setup (connect the repo,
  pick the build config). Documented in `site/README.md`. Can't be
  reproduced from the repo itself.

## Alternatives considered

- **Separate `mgz-pkmn-site` repo.** Cleaner separation of concerns
  but loses the atomic-ship property: now there's a second repo to
  keep in sync, and any "ship a feature + update the site" change
  spans two PRs. Worth revisiting if the site grows beyond marketing
  and warrants its own contributor base.
- **Ready-made marketing template (Astrowind, Astroship).** Faster
  initial render of a "professional" look, but most of the work would
  be removing sections we don't need (Pricing, Blog, Testimonials)
  and overriding the template's branding. Building six small
  components from scratch was faster than gutting a generic template
  and gives us exactly the page we want.
- **GitHub Pages.** Free, in-repo, fine for static sites. Loses
  Cloudflare's edge functions (future-proofing for any tiny dynamic
  pieces) and the Cloudflare Registrar at-cost domain pricing. Tie
  is broken by Cloudflare's better DNS UX for custom domains.
- **Vercel.** Excellent DX; comparable feature set. Bandwidth-metered
  on the free tier where Cloudflare is unmetered, and the latter pairs
  naturally with Cloudflare Registrar for the custom domain.
- **Docusaurus / VitePress.** Docs-first frameworks. The project's
  docs already mirror to the GitHub Wiki; what's missing is
  marketing, not documentation, so a docs framework is the wrong fit.
- **Plain HTML + CSS, no build step.** Simplest possible. Loses
  component reuse (six near-identical card components in a grid),
  utility-class ergonomics, and any future ability to compose new
  pages from shared components. The Astro build is small enough that
  the cost is minimal.
