# mgz-pkmn marketing site

Live at <https://mgz-pkmn.com>.

Astro 5 + Tailwind 4 static site deployed to Cloudflare Pages. Lives
alongside the source so site copy can ship atomically with the features
it describes — a push to `main` that touches `site/**` triggers a redeploy.

Issues and PRs that touch this directory should carry the
[`area:site`](https://github.com/mgzwarrior/mgz-pkmn/labels/area%3Asite)
label so they land in the marketing-site view on the project board.
See the [Project areas](../docs/roadmap.md#project-areas) table for
how the area labels map to the codebase.

## Dev

```bash
make install-site       # one-time, installs npm deps
make dev-site           # vite dev server on :4321
make build-site         # outputs to site/dist/
```

Direct invocation (from `site/`) also works:

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Structure

```
site/
├── public/
│   ├── favicon.svg              # copy of assets/logo.svg
│   └── social-preview.png       # copy of assets/social-preview.png
├── src/
│   ├── components/              # Header / Hero / FeaturesGrid / HowItWorks / RoadmapTeaser / Footer
│   ├── layouts/BaseLayout.astro # <head>, meta, og/twitter cards
│   ├── pages/index.astro        # single landing page composing the components
│   └── styles/global.css        # Tailwind import + @theme tokens
├── astro.config.mjs             # Astro config; wires up Tailwind via @tailwindcss/vite
├── package.json
└── tsconfig.json
```

Pure static output. No SSR, no runtime, no API routes.

## Deploying to Cloudflare Pages

The site builds and deploys automatically once the Cloudflare Pages
project is connected to the repo. The connection itself is a one-time
UI step that can't be done from inside the repo.

1. Sign in to **Cloudflare → Pages → Create a project → Connect to Git**.
2. Select the `mgzwarrior/mgz-pkmn` repository.
3. Configure the build:
   - **Production branch:** `main`
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory (advanced):** `site`
   - **Environment variable:** `NODE_VERSION=20` (or `22`)
4. Save and Deploy. The first build takes ~1 minute.
5. Add the custom domain: **Pages project → Custom domains → Add** →
   enter the domain → follow the DNS instructions (Cloudflare DNS is the
   easiest path; otherwise add the CNAME at your registrar).

Subsequent pushes to `main` that touch `site/**` trigger a redeploy
automatically.

## Custom domain

Live at [`mgz-pkmn.com`](https://mgz-pkmn.com), registered through
Cloudflare Registrar (at-cost) and wired to the Pages project via
Custom domains. Canonical URL is set in
[`astro.config.mjs`](astro.config.mjs) so OG meta tags and the
generated sitemap resolve correctly.

To change the domain later: update `site.url` in `astro.config.mjs`,
swap the Custom domain in the Pages project, and update the references
in `README.md`, `CITATION.cff`, and `pyproject.toml`.

## Assets

`public/favicon.svg` and `public/social-preview.png` are copies of
`assets/logo.svg` and `assets/social-preview.png` at the repo root.
Astro's static asset pipeline prefers files inside the site root, so
the duplication is intentional. If the logo changes, copy it forward.
