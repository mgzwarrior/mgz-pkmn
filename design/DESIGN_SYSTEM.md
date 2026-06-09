# mgz-pkmn Design System

> A tropical, all-ages design system for **mgz-pkmn** — an open-source Pokemon TCG
> card-show prep tool. Anchored by Exeggutor's signature trio: sun-yellow, palm-frond
> green, coconut-bark brown.

![logo](assets/logo-tropical.svg)

---

## What is mgz-pkmn?

[mgz-pkmn](https://github.com/mgzwarrior/mgz-pkmn) is an open-source toolkit that
helps Pokemon TCG collectors prep for a card show. You hand it a want-list (one
card per line, with a flexible grammar like `top:5 Charizard | base set`), and it:

1. **Looks each card up** across three open data sources — `pokemontcg.io`,
   `TCGdex` (multilingual), and `PriceCharting` (region exclusives).
2. **Downloads images** and current market prices.
3. **Writes an `.xlsx`** with embedded thumbnails, market price, and
   80 / 85 / 90 / 95 % negotiation comps for every card.
4. **Optionally generates** a printable 3×3 PDF binder, a condensed 6×4 binder,
   a set-completion checklist, and a structured JSON report.

It ships as:

- A **CLI** (`./pkmn lookup …`) — Python 3.11+, distributed via `uv`.
- A **Web UI** (`web/`) — React 19 + Vite + Tailwind v4 + Zustand + Radix
  primitives + `lucide-react` icons. Backend is FastAPI (`api/`). Live at
  <https://mgz-pkmn.onrender.com>.
- A **marketing site** (`site/`) — Astro 5 + Tailwind 4, on Cloudflare Pages
  at <https://mgz-pkmn.com>.

The project is MIT-licensed, contributor-friendly, and built in the open.

### Source materials this design system draws from

- **GitHub repo:** <https://github.com/mgzwarrior/mgz-pkmn>
  - Marketing site components: [`site/src/components/*.astro`](https://github.com/mgzwarrior/mgz-pkmn/tree/main/site/src/components)
  - Web app components: [`web/src/components/*.tsx`](https://github.com/mgzwarrior/mgz-pkmn/tree/main/web/src/components)
  - Existing tokens: [`site/src/styles/global.css`](https://github.com/mgzwarrior/mgz-pkmn/blob/main/site/src/styles/global.css)
  - Logo and social preview: [`assets/`](https://github.com/mgzwarrior/mgz-pkmn/tree/main/main/assets)

Browse the repo to extend this system with new components — the Astro and React
sources are the source of truth for product-level interaction behavior; this
system is the source of truth for **visual identity**.

---

## Design direction (and why it changed)

The current shipping product uses a generic dark Tailwind palette
(`zinc-950` surfaces, `blue-500` accents, Inter). It works, but it doesn't say
*Pokemon* and it doesn't say *Exeggutor*.

The maintainer's favorite Pokemon is **Exeggutor** — a six-headed coconut palm.
This design system re-anchors the brand on Exeggutor's three signature colors:

| Hue | Where it comes from | Role |
|---|---|---|
| **Sun yellow** `#F5C94B` | Exeggutor's heads / ripe coconut meat | Primary brand, CTAs |
| **Palm green** `#4A8B3B` | Exeggutor's crown of fronds | Secondary brand, success, links |
| **Coconut brown** `#6B4A2F` | Exeggutor's trunk / bark | Body text, dark accents |
| **Sand cream** `#FBF6E8` | Vintage TCG card border / play mat | Default surface |
| **Coffee husk** `#1F1B16` | Roasted shell | Dark-mode surface |

Pokemon TCG cards have warm beige borders and chunky-rounded corners. The
system leans into that — generous radii, soft shadows in warm coconut alpha,
and friendly typography.

---

## Content fundamentals

Voice is **friendly, plainspoken, and confident — never cute, never corporate**.
The tool is for collectors of every age, from a kid building a Sprigatito binder
to a vendor inventorying a $2k case. Copy should make either feel welcome.

### Voice pillars

There is **one voice**; the tone flexes by moment (see below). Every string
answers to these four traits:

1. **Plainspoken.** Say what the thing does in the fewest plain words. Clear over
   clever, every time. → `Look up`, not `Initiate lookup`.
2. **On your side.** Assume good faith and hand over the fix. Errors point at the
   next step, never scold. → `Add a PriceCharting URL to price this one.`, not
   `Invalid input.`
3. **Quietly knowledgeable.** We know the hobby — 1st Edition vs unlimited, market
   vs median, raw vs graded — and use the right word without showing off.
4. **Warm to everyone.** A kid with a Sprigatito binder and a vendor with a $2k
   case both feel addressed. Never talk down, never gatekeep.

> Visual reference: **Voice · pillars**, **Voice · tone by moment**, and
> **Voice · vocabulary** cards in the Brand section of the Design System tab.

### Tone & casing

- **Sentence case for everything.** Buttons (`Look up`, `Download .xlsx`),
  headings (`Where it's going.`), section titles (`Card list`). Title Case
  is reserved for product names (`PriceCharting`, `TCGdex`).
- **Use contractions.** "You'll", "we're", "it's". Reads warmer.
- **Second person.** "You" speaks to the collector directly; never "the user".
- **First-person plural ("we") for project voice** in the README and Discussions
  — never in the product UI itself.
- **No marketing-speak.** Avoid "unlock", "supercharge", "powerful", "seamless".
- **No emoji in copy** by default. The codebase reserves emoji for one place:
  the 🌴 Easter-egg overlay (5 clicks on the brand). Don't sprinkle them in headings.

### Concrete examples (from the existing product)

| Surface | Copy | What it does |
|---|---|---|
| Hero headline | *"Walk into your next card show with a plan, not a hope."* | Confident, specific, evokes the actual moment of use. |
| Hero sub | *"…would rather show up informed than wing it on convention center Wi-Fi."* | Specific imagery; trusts the reader to get the joke. |
| Empty state | *"Results will appear here after you run a lookup."* | Tells you what's next. No filler. |
| Button | `Look up (⌘↵)` | Verb + keyboard hint. Never `Submit`, never `Go!`. |
| Status | *"3 cards lines"*, *"5 matched · 1 unmatched · 6 shown"* | Numbers first, plain English. |
| Errors | *"Add PriceCharting URL"* (as an actionable link, not a red banner) | Errors offer the fix inline. |
| Easter egg | *"You found Exeggutor!"* / *"Claim code: EGG-EXEGGCUTE"* | Playful, but only when surfaced intentionally. |

### Tone by moment

Same voice, retuned for the state the collector is in:

| Moment | Feels | Example |
|---|---|---|
| **Empty** | Calm, points ahead | *"Results will appear here after you run a lookup."* |
| **Loading** | Honest, specific | *"Pricing 3 of 12…"* — show the count, never a vague spinner. |
| **Success** | Plain, numbers first | *"5 matched · 1 unmatched · 6 shown."* No confetti, no "Success!" |
| **Error** | On your side | *"Couldn't price this one. Add a PriceCharting URL and we'll retry."* |
| **Price & confidence** | Precise, never overclaims | *"$184.00 market · 85% comp · as of last lookup."* Hedge what's thin. |
| **Destructive** | Clear, no guilt | *"Clear all 12 lines? This can't be undone."* Name the count and the cost. |

### Vocabulary — say this, not that

One word per concept, enforced everywhere:

| Say this | Not that | Why |
|---|---|---|
| **Look up** | Search · Submit · Go | The core verb of the app. |
| **Want-list** | wishlist · cart · queue | One term, hyphenated, everywhere. |
| **Comps** | data · the numbers | Recent comparable sales. |
| **Market** | value · worth · est. | The headline price. |
| **Walk a set** | explore · discover | Browse a full set in order. |

Product & source names keep their own casing exactly: `PriceCharting`, `TCGdex`,
`pokemontcg.io`. **Never ships:** unlock, supercharge, powerful, seamless,
revolutionary, effortless, game-changing, next-gen.

### Vibe in one paragraph

> *Like the binder that comes out at a card show: well-thumbed, organized,
> earnest. Knows the difference between a 1st Edition Base Set and an
> unlimited print. Won't talk down to a kid asking about their starter deck.*

---

## Visual foundations

### Color

- **Primary:** sun-yellow `#F5C94B` for CTAs and primary actions.
- **Secondary:** palm-green `#4A8B3B` for links, success, supportive accents.
- **Tertiary:** coconut-brown `#6B4A2F` for body text and bold neutrals.
- **Surfaces:** cream `#FBF6E8` (app bg) → `#FFFEF8` (cards) → `#F4ECD3` (sunken).
- **Dark mode:** husk `#1F1B16` base; same sun/palm hues as accents.
- Full palette + dark-mode tokens in [`colors_and_type.css`](colors_and_type.css).

### Type

- **Display:** Bricolage Grotesque (700 / 800) — friendly grotesk with personality.
- **Body:** DM Sans (400 / 500 / 600 / 700) — warm geometric sans.
- **Mono:** JetBrains Mono — used for `code`, card numbers, the card-list
  textarea, prices (`tabular-nums`), and the "command" code-block in the hero.
- All three are Google Fonts substitutions. **⚠️ Flag for maintainer:** if
  there's a licensed brand font you want to use instead, swap it in
  `colors_and_type.css`. Inter (currently in the codebase) is widely felt to be
  a default — Bricolage gives the wordmark more character.
- Scale ranges from `11px` to `84px`; minimum body is `14px`. See `--size-*`
  tokens.

### Spacing

- 4px base. Use the `--space-*` scale (`1=4`, `2=8`, `3=12`, `4=16`, `6=24`, `8=32`, `12=48`, `16=64`, …).
- Inputs use `--space-3` vertical padding (`12px`).
- Cards use `--space-6` (24px) interior padding.
- Section vertical rhythm: `--space-20` (80px) between major page sections.

### Backgrounds & textures

- **Default:** flat warm surfaces. No gradients on cards or inputs.
- **Allowed gradient:** *one* per page max — a soft sun-radial glow behind hero
  headlines, mimicking sunlight on a play mat. Use `oklab` blending.
- **No imagery in product UI.** The marketing site can use the existing
  `assets/hero.png` (a screenshot of the app); the app itself doesn't use
  background imagery.
- **No textures, no grain.** The cream `#FBF6E8` does the warmth work alone.

### Animation & easing

- **Duration scale:** `--dur-fast: 120ms` (hovers), `--dur-base: 200ms`
  (transitions), `--dur-slow: 320ms` (drawers, modals), `--dur-page: 480ms`
  (route changes).
- **Easing:** `--ease-out` is the default (`cubic-bezier(.16,1,.3,1)`).
  `--ease-spring` for playful elements (Easter egg, "match found" pulse).
- Streamed result rows use a 220ms `fadeInRow` (`opacity` + `translateY(-4px)`) —
  carry this forward, not bouncing.
- **No infinite spinners.** Use Lucide's `Loader2` with `animate-spin` only when
  a determinate state isn't possible. Streaming progress should always render a
  determinate bar.

### Hover & press

- **Default hover:** lighten warm surfaces by stepping one notch (e.g. `sand-100 → sand-50`).
- **On the primary yellow button:** darken slightly (`sun-300 → sun-400`); never
  fade with opacity — yellow + opacity reads as "disabled".
- **Press:** `transform: translateY(1px)` + inset shadow on solid CTAs.
- **Focus:** `box-shadow: 0 0 0 3px` palm at 35% alpha. **Never** native blue ring.
- **Disabled:** 40% opacity; cursor `not-allowed`.

### Borders

- Default border is `1px solid var(--border-1)` (`sand-300`).
- Emphasized inputs / hover use `--border-2` (`sand-400`).
- Card outlines never use pure black — only `coconut-400` or `sand-300`.

### Shadows

Two systems:

1. **Card elevation** (`--shadow-xs` → `--shadow-xl`) — warm coconut alpha,
   low-y offset, generous blur. Used for raised cards and dropdowns.
2. **Inner press shadow** (`--shadow-press-inner`) — applied on the
   `:active` state of solid buttons for tactile feedback.
3. **Brand glow** (`--shadow-glow-sun`, `--shadow-glow-palm`) — reserved for
   focus rings and "match found" pulses, never for ambient decoration.

Cards prefer **outline + shadow-sm** over heavy elevation. The vibe is
"sun-warmed paper", not "floating slab".

### Corner radii

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4px | Inline code, tags |
| `--radius-sm` | 6px | Small chips |
| `--radius-md` | 10px | Buttons, inputs, dropdown items |
| `--radius-lg` | 14px | Cards, modal panels |
| `--radius-xl` | 20px | Hero card / large feature panels |
| `--radius-pill` | 9999px | Pill badges, segmented controls |

### Transparency & blur

- The marketing-site header uses `backdrop-blur` on a translucent surface
  — preserve this for sticky-app-bar treatments.
- **Avoid** translucent panels over imagery (none of the product surfaces
  show imagery behind them).
- Modal overlay: `rgba(46, 31, 17, 0.55)` (warm coconut wash, not pure black).

### Layout rules

- Max content widths: `--max-w-prose: 65ch`; `--max-w-app: 1200px`;
  `--max-w-marketing: 1080px`.
- Cards stack to a single column under `640px`; 2-up under `1024px`;
  3-up above.
- Sticky header height: `56px` (app) / `64px` (marketing).
- Bottom-of-screen actions: never; always inline.

---

## Iconography

The web app uses **[Lucide](https://lucide.dev)** (`lucide-react@latest`) at
**1.75 stroke width** in `13–14px` sizes (icons inside buttons) or `20px`
(standalone). Common icons in the codebase, by usage:

| Icon | Used for |
|---|---|
| `Play` / `Square` | Run / Stop bulk lookup |
| `RotateCcw` | Clear input |
| `Filter` | Toggle results-table filters |
| `ArrowUp` / `ArrowDown` / `ArrowUpDown` | Sortable headers |
| `ExternalLink` | Open a listing |
| `AlertCircle` | Unmatched row |
| `Download` / `ChevronDown` | Export dropdown trigger |
| `FileSpreadsheet`, `BookOpen`, `LayoutGrid`, `ListChecks`, `Tags` | Export formats |
| `History`, `X` | Recent searches |
| `Loader2` (with `animate-spin`) | Indeterminate loading |

**This design system continues to use Lucide** — load via CDN:

```html
<script src="https://unpkg.com/lucide@latest"></script>
<script>lucide.createIcons();</script>
```

In React, prefer the `lucide-react` package (matches the codebase).

In addition, this system adds **four brand SVGs** in [`assets/`](assets/):

- [`mark-palm.svg`](assets/mark-palm.svg) — Circular sun + palm seal. Use for app icons, favicons, social.
- [`icon-palm.svg`](assets/icon-palm.svg) — Lucide-weight palm-tree line icon. Use for the Exeggutor easter egg, theme indicators.
- [`icon-card.svg`](assets/icon-card.svg) — Stylized TCG card line icon.
- [`icon-binder.svg`](assets/icon-binder.svg) — Binder line icon (3-ring + 2 card slots).
- [`icon-coconut.svg`](assets/icon-coconut.svg) — Coconut line icon.

These match Lucide's visual grammar (24×24 viewBox, 1.75 stroke, round caps).

**Emoji:** the existing codebase uses 🌴 exactly once, in the Easter egg
overlay (5 brand clicks). Keep emoji to that single context.

**Unicode glyphs:** the Look-up button shows `⌘↵` to indicate the keyboard
shortcut. Keep this. Don't introduce more unicode UI glyphs without checking
they render across system fonts.

---

## Index

| File | What it is |
|---|---|
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | This file — brand context, content + visual foundations, iconography. |
| [`INTEGRATION.md`](INTEGRATION.md) | **Step-by-step guide for adopting the system in the `mgz-pkmn` repo.** |
| [`tokens/colors_and_type.css`](tokens/colors_and_type.css) | All CSS variables — palette, semantic tokens, type scale, spacing, radii, shadows, motion. |
| [`../assets/`](../assets/) | Logos, brand mark, icon SVGs, marketing imagery. |
| [`CLASS_CHEATSHEET.md`](CLASS_CHEATSHEET.md) | Find/replace table for zinc/blue Tailwind classes. |
| [`styleguide/`](styleguide/) | Design-system cards for palette, type specimen, components, and voice. |

### Styleguide cards

| Area | What it covers |
|---|---|
| [`styleguide/buttons.html`](styleguide/buttons.html), [`styleguide/inputs.html`](styleguide/inputs.html), [`styleguide/result-row.html`](styleguide/result-row.html) | Product component treatments for the React app. |
| [`styleguide/brand-logo.html`](styleguide/brand-logo.html), [`styleguide/brand-mark.html`](styleguide/brand-mark.html), [`styleguide/brand-icons.html`](styleguide/brand-icons.html) | Brand assets and iconography. |
| [`styleguide/voice-pillars.html`](styleguide/voice-pillars.html), [`styleguide/voice-moments.html`](styleguide/voice-moments.html), [`styleguide/voice-vocabulary.html`](styleguide/voice-vocabulary.html) | Product voice references for UI copy. |

---

## ⚠️ Notes & flags for the maintainer

1. **Font substitutions.** Bricolage Grotesque, DM Sans, and JetBrains Mono are
   Google Fonts choices the system author picked because they pair well with
   the chunky logo and the all-ages tone. If you have preferred licensed
   fonts, swap them in `colors_and_type.css` (`--font-display`, `--font-body`,
   `--font-mono`).
2. **Color direction.** This system replaces the current blue accent with
   sun-yellow primary. If you want to preserve a recognizable continuity with
   v1.x's blue (`#3b82f6`), let me know and I can:
   - keep yellow primary but reintroduce blue as the "info" semantic color, or
   - flip to a green-primary direction (mature, less playful), or
   - mock a side-by-side comparison so you can pick at the asset-review stage.
3. **Logo direction.** Two logos ship: the **original** zinc + blue mark
   (`assets/logo.svg`), preserved for compatibility; and the **tropical**
   recolor (`assets/logo-tropical.svg`) which keeps the same card-frame
   silhouette but recolors and adds a tiny palm + coconuts inside the art
   window. Same for the marketing site favicon — both versions are available.
4. **Iconography.** I added a handful of brand SVGs (palm, coconut, card,
   binder) at Lucide's weight; if you want a denser custom set, this is a
   place to invest.
