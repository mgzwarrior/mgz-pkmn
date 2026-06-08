# Integrating the mgz-pkmn Design System into your repo

This is a step-by-step guide for adopting this system in
[`mgzwarrior/mgz-pkmn`](https://github.com/mgzwarrior/mgz-pkmn). The current
product uses Tailwind v4 with `@theme` token blocks in two places —
`site/src/styles/global.css` and `web/src/index.css` — plus inline Tailwind
classes throughout the React/Astro components. **You don't have to rewrite
the components**; you mostly swap tokens at the `@theme` level and do a
small find-and-replace for hardcoded `zinc-*` / `blue-*` classes.

Estimate: **one focused afternoon** for a clean cutover, less if you're
willing to ship behind a `data-theme="tropical"` flag first.

---

## Suggested PR strategy

Open **two PRs** — one for the site, one for the web app. Each is
self-contained and reviewable. Tag them `area:site` and `area:web` to match
your existing labelling. Sign every commit with `-s` per
[CLAUDE.md → DCO](https://github.com/mgzwarrior/mgz-pkmn/blob/main/CLAUDE.md).

Branch names following your convention:

```
<issueNumber>-tropical-theme-site
<issueNumber>-tropical-theme-web
```

Open an umbrella issue first (`design: adopt tropical brand direction`) so
both PRs have a `Closes #N` to point at, and the change has a discoverable
trace in `area:design`-or-similar.

---

## Step 1 — Add brand assets to the repo

Copy these into `assets/` (next to your existing `logo.svg`):

| From this project | To `mgz-pkmn/` |
|---|---|
| `assets/logo-tropical.svg` | `assets/logo-tropical.svg` |
| `assets/mark-palm.svg` | `assets/mark-palm.svg` |
| `assets/icon-palm.svg` | `assets/icon-palm.svg` |
| `assets/icon-card.svg` | `assets/icon-card.svg` |
| `assets/icon-binder.svg` | `assets/icon-binder.svg` |
| `assets/icon-coconut.svg` | `assets/icon-coconut.svg` |

Then mirror two of them into the site's public folder so the favicon and
brand mark work:

```bash
cp assets/logo-tropical.svg site/public/logo-tropical.svg
cp assets/mark-palm.svg     site/public/favicon-tropical.svg
# also drop a copy into the web app so the React import path works:
cp assets/logo-tropical.svg web/src/assets/logo-tropical.svg
```

**Keep the original `assets/logo.svg`** — both for backward compatibility
with the GitHub README badge and so you can revert without breaking links.

---

## Step 2 — Replace `site/src/styles/global.css`

Replace your current file (the one with `--color-brand-*` blue tokens) with
the contents of [`migration/site-global.css`](migration/site-global.css) in
this project. The new file is a drop-in Tailwind v4 `@theme` block that:

- Defines `sun-*`, `palm-*`, `coconut-*`, `sand-*`, `husk-*`, `ember-*`,
  `sky-*` color scales — Tailwind auto-generates utilities (`bg-sun-300`,
  `text-palm-500`, `border-coconut-400`, etc.).
- Renames `brand` → an alias of `sun` so existing `bg-brand-500` classes
  keep working through the cutover (you can sweep them later).
- Adds Bricolage Grotesque + DM Sans + JetBrains Mono via Google Fonts
  `@import` (or via `<link>` in `BaseLayout.astro` — preference is yours).
- Flips `--color-scheme` from `dark` to `light` and the body background from
  `#09090b` to cream `#FBF6E8`.

Then in `BaseLayout.astro`, change the body class:

```diff
- <body class="bg-zinc-950 text-zinc-100">
+ <body class="bg-sand-50 text-coconut-600 antialiased">
```

---

## Step 3 — Sweep `site/src/components/*.astro`

These components hardcode `zinc-*` and `brand-*` classes. Run the cheatsheet
in [`migration/CLASS_CHEATSHEET.md`](migration/CLASS_CHEATSHEET.md) against
each file. Most replacements are 1-to-1 — e.g.

```diff
- class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 hover:border-zinc-700"
+ class="rounded-xl border border-sand-300 bg-white p-6 shadow-sm hover:shadow-md hover:border-coconut-300"
```

Files to touch:

- `Header.astro` — `bg-zinc-950/70` → `bg-sand-50/80`; `text-zinc-300` → `text-coconut-500`
- `Hero.astro` — `bg-brand-600/15` glow → `bg-sun-300/40`; `text-white` → `text-coconut-700`
- `FeaturesGrid.astro`, `HowItWorks.astro`, `BuiltInTheOpen.astro`, `RoadmapTeaser.astro` — same card pattern
- `Footer.astro` — `text-zinc-400` → `text-coconut-400`; `text-zinc-500` → `text-coconut-400`

**Reference implementation:** the file `ui_kits/site/index.html` in this
project is a faithful recreation of your site after the swap. Open it
side-by-side with your existing site to compare hue by hue.

---

## Step 4 — Replace `web/src/index.css`

Drop in [`migration/web-index.css`](migration/web-index.css). It's the same
`@theme` block as the site, scoped for the React app — plus the
`fadeInRow` keyframe you already use is preserved, and the `tour-highlight`
ring is recolored from red to palm.

Then in `App.tsx`, change the root wrapper:

```diff
- <div className="min-h-screen bg-zinc-950 text-zinc-100">
+ <div className="min-h-screen bg-sand-50 text-coconut-600">
```

And the brand image source:

```diff
- import logoUrl from './assets/logo.svg'
+ import logoUrl from './assets/logo-tropical.svg'
```

---

## Step 5 — Sweep `web/src/components/*.tsx`

Same cheatsheet. The biggest offenders:

- **`InputEditor.tsx`** — the blue Look-up button:
  ```diff
  - bg-blue-600 ... hover:bg-blue-500
  + bg-sun-300 text-coconut-700 hover:bg-sun-400 shadow-sm
  ```
- **`ResultsTable.tsx`** — sortable headers + market price color:
  ```diff
  - text-green-400  (price)
  + text-palm-500
  - text-amber-400  (over-cap)
  + text-sun-600
  ```
- **`SettingsDrawer.tsx`** — `bg-zinc-900` → `bg-white`; `border-zinc-700` → `border-sand-300`
- **`ExportBar.tsx`** — `bg-zinc-800 hover:bg-zinc-700` → `bg-white hover:bg-sand-100`
- **`RecentRuns.tsx`** — `bg-zinc-900/40` → `bg-sand-100`
- **App.tsx Easter egg overlay** — keep the green palette but bump to `palm` shades:
  ```diff
  - border-green-700 bg-green-900/30 text-green-300
  + border-palm-300 bg-palm-50 text-palm-700
  ```
- **App.tsx Easter egg 🌴** — **keep the emoji**. It's the one approved exception.

---

## Step 6 — Add Google Fonts to both surfaces

Easiest: add to the `<head>` in both `site/src/layouts/BaseLayout.astro` and
`web/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
```

If you'd rather self-host (recommended for production — no third-party
runtime dependency), download from
[fonts.google.com](https://fonts.google.com), drop the woff2 files in
`site/public/fonts/` + `web/src/assets/fonts/`, and replace the
`@font-face` rules at the top of `colors_and_type.css`.

---

## Step 7 — Update the GitHub README

The badge image in `README.md` references `assets/logo.svg`. Swap it:

```diff
- <img src="https://raw.githubusercontent.com/mgzwarrior/mgz-pkmn/main/assets/logo.svg" alt="mgz-pkmn" height="64">
+ <img src="https://raw.githubusercontent.com/mgzwarrior/mgz-pkmn/main/assets/logo-tropical.svg" alt="mgz-pkmn" height="64">
```

(Or keep both, side by side, for a v1-vs-v2 visual changelog.)

---

## Step 8 — Verify

For each PR, the standard mgz-pkmn gate applies:

```bash
make check                  # ruff lint, format, tests, web ESLint
cd web && npm run build     # full type-check + bundle
cd site && npm run build    # Astro build
```

Then take screenshots before/after for the PR body — reviewers (and future
you) will appreciate seeing the cream/sun render next to the existing
zinc/blue. Cmd+P to PDF and attach is the easiest path.

---

## Want to ship behind a feature flag first?

If you'd rather not cut over in one go, the system is built so you can run
both themes side by side. In `colors_and_type.css`:

```css
:root         { /* tropical tokens (default) */ }
[data-theme="legacy"] { /* paste your old zinc + blue values here */ }
```

Then `<html data-theme="legacy">` keeps the old look while you verify the
new one on a beta path. Once the new theme is signed off, remove the
`[data-theme="legacy"]` block.

---

## Reference files

| File in this project | What it's for |
|---|---|
| [`colors_and_type.css`](colors_and_type.css) | Canonical token source. The `@theme` files below are derived from this. |
| [`migration/site-global.css`](migration/site-global.css) | Paste over `site/src/styles/global.css`. |
| [`migration/web-index.css`](migration/web-index.css) | Paste over `web/src/index.css`. |
| [`migration/CLASS_CHEATSHEET.md`](migration/CLASS_CHEATSHEET.md) | Find/replace table for zinc/blue Tailwind classes. |
| [`ui_kits/site/index.html`](ui_kits/site/index.html) | Visual reference for what your marketing site should look like after the swap. |
| [`ui_kits/web/index.html`](ui_kits/web/index.html) | Visual reference for the web app after the swap. |

---

## Got stuck?

If a component doesn't look right after the sweep, the most likely culprits
(in order) are:

1. A hardcoded `text-white` that should be `text-coconut-700` on light surfaces.
2. A `border-zinc-800` that's now invisible on cream — bump to `border-sand-300`.
3. A `bg-zinc-900/40` translucent surface — these read as muddy brown on
   cream; switch to opaque `bg-sand-100`.
4. Missing fonts — check the Network tab in DevTools for failed Google Fonts
   requests (CSP, blocklist, etc.).

If you hit any of these and the cheatsheet doesn't cover it, open this
project back up and I'll iterate the migration files.
