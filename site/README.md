# mgz-pkmn marketing site

Live at <https://mgz-pkmn.com>.

Astro 5 + Tailwind 4 static site deployed to Cloudflare Pages. Lives
alongside the source so site copy can ship atomically with the features
it describes — a push to `main` that touches `site/**` triggers a redeploy.

Issues and PRs that touch this directory should carry the
[`area:site`](https://github.com/mgzwarrior/mgz-pkmn/labels/area%3Asite)
label, so they're discoverable via the `area:site` filter on the
[project board](https://github.com/users/mgzwarrior/projects/11?filterQuery=label%3A%22area%3Asite%22).
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

### Hero binder grid (`public/cards/*.webp`)

The hero backdrop is a 3×3 tilted grid of real Pokémon TCG card
thumbnails. The source images live in `output/images/` (downloaded
by `pkmn lookup` from pokemontcg.io). To refresh or swap the curated
set, copy the desired card images, resize to ~360 px wide, and
convert to WebP:

```bash
for f in <chosen-files>; do
  cp "output/images/$f.png" "site/public/cards/$f.png"
done
cd site/public/cards
sips --resampleWidth 360 *.png -o .
for f in *.png; do cwebp -q 80 "$f" -o "${f%.png}.webp"; done
rm *.png
```

Update the `binderCards` array in
[`src/components/Hero.astro`](src/components/Hero.astro) to match the
new filenames + alt text.

### "What you get" gallery (`public/screenshots/*.webp`)

The OutputGallery section shows previews of the tracked sample
deliverables in `output/`. Regenerate them with:

```bash
./site/scripts/refresh-screenshots.sh
```

Requirements: `brew install poppler webp uv`.

The script handles each output via the cleanest available path:

- **binder.pdf / checklist.pdf**: `pdftoppm` renders page 1 to PNG;
  `cwebp` re-encodes at quality 82.
- **cards.xlsx**: composed by
  [`render_xlsx_preview.py`](scripts/render_xlsx_preview.py) directly
  from `output/summary.json` plus thumbnails in `output/images/`.
  LibreOffice headless can't render the xlsx writer's embedded image
  references, so a custom Pillow composer renders a faithful
  spreadsheet-style preview instead. Lives in the project's `uv` env
  for the Pillow dep.

Re-run after any `make refresh-examples` change.

### Asciinema cast (`public/casts/lookup-demo.cast`)

The hero embeds an [asciinema](https://asciinema.org/) cast of a real
`pkmn lookup` against `sample_cards.txt`. Player CSS/JS are vendored
in `public/vendor/asciinema-player.*`. To re-record after CLI output
changes:

```bash
./site/scripts/record-cast.sh
```

Requirements: `brew install asciinema` and the `pkmn` CLI on PATH
(`make install` from repo root). Set `POKEMONTCG_IO_API_KEY` to avoid
the anonymous-tier rate limit. The cast is overwritten in place —
commit the diff if it changed.
