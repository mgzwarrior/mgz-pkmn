# ADR 0017: Tropical design system — sun + palm + coconut, paired light/dark tokens

- **Status:** Accepted
- **Date:** 2026-05-31
- **Tags:** design, site, web

## Context

Through v1.0 and most of v1.1, every surface — marketing site,
demo SPA, GitHub README — leaned on Tailwind's stock zinc/blue
palette. It worked but it didn't say anything: the project looked
like every other "dark-theme developer tool" shipped by everyone
else's solo side-project, which is the opposite of the actual
brand (a personal, warm, cards-and-collecting project where the
mascot is, more or less, Alolan Exeggutor).

By the v1.x line the project shipped enough surfaces that the
gap was load-bearing: a visitor could land on the marketing site,
click the demo, and feel like they'd opened a different app. The
README, the inline logo, the favicon, and the social preview all
told slightly different visual stories.

Constraints:

- Two surfaces (Astro marketing site + React SPA) with different
  styling stacks but a shared Tailwind 4 `@theme` mental model.
- Colors must clear WCAG AA contrast everywhere they appear (we
  publish [`docs/accessibility.md`](../accessibility.md) and want
  it to stay honest).
- Dark mode must remain a first-class theme — a meaningful slice
  of users (and the maintainer) live there.
- Solo maintainer. Whatever convention we land on has to be cheap
  to apply across every component without a design-tokens build
  pipeline.

## Decision

Adopt a **tropical palette** as the design system on the user-facing
surfaces (marketing site via [#342](https://github.com/mgzwarrior/mgz-pkmn/pull/342)
+ [#343](https://github.com/mgzwarrior/mgz-pkmn/pull/343); demo SPA
via [#347](https://github.com/mgzwarrior/mgz-pkmn/pull/347)), in two
themes:

- **Light:** cream `sand-50` background, sun-yellow CTAs, palm-green
  accents and prices, coconut-brown body text. Display type
  **Bricolage Grotesque**, body **DM Sans**, monospace **JetBrains
  Mono**. Warm coconut-alpha shadows replace flat black.
- **Dark:** husk coffee-charcoal surfaces (`husk-100` through
  `husk-500`), warm sand body text (`sand-50`/`sand-200`/`sand-300`),
  the same sun-yellow CTAs that define light mode, and badge
  accents on palm / sun / ember instead of generic emerald / blue
  / rose.

First-paint default differs per surface (each gets the
strongest-impression theme for its visitor pattern):

- **Marketing site** defaults to **dark** —
  [`site/src/layouts/BaseLayout.astro`](../../site/src/layouts/BaseLayout.astro)
  renders `<html class="dark">` and the pre-paint script resolves
  `localStorage[theme]` → OS `prefers-color-scheme: light` →
  `dark` fallback.
- **Demo SPA** defaults to **light** —
  [`web/index.html`](../../web/index.html)'s pre-paint script
  resolves saved choice → OS preference → `light` fallback, to
  match the site's tropical-light look the SPA inherits when
  visitors click through from a landing-page CTA.

Mechanism — applied per surface, same shape on each:

- Palette tokens defined once per surface in an `@theme` block in
  the surface's root CSS
  ([`site/src/styles/global.css`](../../site/src/styles/global.css),
  [`web/src/index.css`](../../web/src/index.css)). The token names
  (`--color-sun-300`, `--color-palm-400`, `--color-coconut-700`,
  …) are the contract.
- Tailwind 4's **`@custom-variant dark`** drives the theme switch,
  scoped to `.dark` on `<html>`. Each surface owns its own
  pre-paint inline script (see defaults above) so the toggle never
  flashes.
- Components use **paired classes** for every theme-sensitive
  property: `bg-sand-50 dark:bg-husk-400`,
  `text-coconut-700 dark:text-sand-50`,
  `border-sand-300 dark:border-husk-100`. The pairing is the
  convention, not a tool — there is no codegen.
- The stage-color mapping for the progress chips is documented in
  [`docs/accessibility.md`](../accessibility.md#color-coded-progress-stages)
  with the exact contrast ratios for both themes; that doc is the
  authority when we add a new state color.

The full design-system definition (palette swatches, type ramp,
component anatomy) lives outside the repo at
`~/Downloads/mgz-pkmn Design System-2/` on the maintainer's
machine. The repo intentionally only ships the *applied* tokens
in `@theme`, not the spec — the spec is allowed to drift ahead of
the code, and PRs reconcile when a new component lands.

## Consequences

- Every surface tells the same visual story: marketing → demo →
  README → social preview all use the same warm cream + sun-yellow
  + palm-green + coconut-brown vocabulary.
- The paired-class convention is verbose at the call site
  (`bg-sand-50 dark:bg-husk-400` instead of a single semantic
  token), but it stays readable in JSX/Astro and makes contrast
  bugs obvious in code review: missing `dark:` half is a smell.
  This is the lesson [#347](https://github.com/mgzwarrior/mgz-pkmn/pull/347)
  reinforced — every fixed Copilot finding was either a missing
  `dark:` half or an unscoped variant that overrode the rest state.
- Dark mode no longer ships as an afterthought. Both themes are
  load-bearing and tested in the same review pass; the contrast
  doc is the spec.
- The per-surface first-paint default (site → dark, SPA → light)
  is a soft brand decision: a marketing-site landing has the most
  punch on the moody dark palette, while the demo SPA looks most
  like a real tool on the warm tropical-light surface. Visitors
  who prefer the other half flip in one click; their choice
  persists in `localStorage[theme]`.
- Migration cost when we change a token (e.g., bump `sun-300`
  from `#F5C94B` to a different yellow): one find-and-replace in
  the two `@theme` blocks. Components don't reference hex codes
  directly.
- The design-system spec living outside the repo is a known
  drift risk. Acceptable today because the maintainer is also the
  designer; revisit when that stops being true.

## Alternatives considered

- **Keep zinc/blue, polish the existing look.** Cheapest path,
  zero migration cost. Loses the brand-coherence win and leaves
  the marketing site looking interchangeable with every other
  developer-tool landing page.
- **Tropical as a single (light-only) theme.** Half the work, but
  forces the meaningful dark-mode userbase off the brand. Would
  have shipped a "looks great until you're a dark-mode user"
  product.
- **CSS-in-JS theme provider (Stitches / vanilla-extract).**
  Generates type-safe tokens with semantic names. More
  ergonomic at the call site, but adds a runtime / build-time
  dependency on both surfaces and a second mental model on top of
  Tailwind. Tailwind 4's `@theme` + `@custom-variant dark`
  already gives us tokens-in-CSS without the extra layer.
- **Two separate palettes per surface (site stays zinc, SPA
  goes tropical).** Cuts the rollout in half but reintroduces the
  exact "feels like a different app" gap the rollout was meant to
  close.
