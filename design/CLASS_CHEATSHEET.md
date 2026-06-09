# Class-replacement cheatsheet

Sweep these find-and-replace pairs through `site/src/components/*.astro`
and `web/src/components/*.tsx` after pasting in the new `@theme` blocks.

Most entries are 1-to-1. Where a replacement adds extra classes (shadow,
border) it's because the dark surface implicitly provided contrast that
cream doesn't — you need to add it back as elevation.

---

## Background surfaces

| Find | Replace with | Notes |
|---|---|---|
| `bg-zinc-950` | `bg-sand-50` | app/page background |
| `bg-zinc-950/70` | `bg-sand-50/80` | sticky header |
| `bg-zinc-950/90` | `bg-sand-50/90` | sticky header on web app |
| `bg-zinc-900` | `bg-white` | panels / drawers |
| `bg-zinc-900/40` | `bg-sand-100` | feature/open cards (was translucent) |
| `bg-zinc-900/60` | `bg-sand-100` | filter rows, hero pill |
| `bg-zinc-900/80` | `bg-sand-100` | code blocks |
| `bg-zinc-950/80` | `bg-sand-50` | hero code block |
| `bg-zinc-800` | `bg-sand-200` | hover surfaces, badges |
| `bg-zinc-800/40` | `bg-sand-100` | chip panel |
| `bg-zinc-800/50` | `bg-sand-100` | row hover |
| `bg-zinc-800/60` | `bg-sand-200` | override-form panel |
| `bg-zinc-700` | `bg-sand-300` | progress track, scrollbars |
| `bg-black/80` | `bg-coconut-700/55` | modal overlay (warm wash) |

## Borders

| Find | Replace with |
|---|---|
| `border-zinc-900` | `border-sand-300` |
| `border-zinc-900/80` | `border-sand-300` |
| `border-zinc-800` | `border-sand-300` |
| `border-zinc-700` | `border-sand-400` |
| `border-zinc-600` | `border-coconut-400` |

## Text

| Find | Replace with | Notes |
|---|---|---|
| `text-white` | `text-coconut-700` | on cream surfaces |
| `text-zinc-100` | `text-coconut-700` | primary text |
| `text-zinc-200` | `text-coconut-600` |  |
| `text-zinc-300` | `text-coconut-500` |  |
| `text-zinc-400` | `text-coconut-400` | secondary text |
| `text-zinc-500` | `text-sand-500` | muted captions |
| `text-zinc-600` | `text-sand-400` | placeholders |

## Brand / blue

| Find | Replace with |
|---|---|
| `bg-blue-600` | `bg-sun-300 text-coconut-700` |
| `bg-blue-500` | `bg-sun-300 text-coconut-700` |
| `hover:bg-blue-500` | `hover:bg-sun-400` |
| `hover:bg-blue-400` | `hover:bg-sun-400` |
| `bg-blue-700` | `bg-sun-400 text-coconut-700` |
| `bg-blue-900/30` | `bg-sun-100` |
| `text-blue-300` | `text-palm-500` |
| `text-blue-400` | `text-palm-500` |
| `border-blue-500` | `border-palm-400` |
| `border-blue-700` | `border-palm-500` |
| `focus:ring-blue-500` | `focus:ring-palm-400` |
| `shadow-brand-500/20` | `shadow-md` |
| `shadow-brand-500/30` | `shadow-md` |
| `bg-brand-500` | `bg-sun-300 text-coconut-700` |
| `bg-brand-600` | `bg-sun-400 text-coconut-700` |
| `hover:bg-brand-400` | `hover:bg-sun-400` |
| `text-brand-400` | `text-palm-500` |
| `text-brand-300` | `text-palm-400` |

## Status colors

| Find | Replace with | Notes |
|---|---|---|
| `text-green-400` (price) | `text-palm-500` | market price |
| `text-green-300` | `text-palm-600` |  |
| `text-green-700` | `text-palm-500` |  |
| `bg-green-900/30` | `bg-palm-50` | easter-egg success |
| `border-green-700` | `border-palm-300` |  |
| `text-emerald-300` | `text-palm-600` | roadmap "done" pill |
| `bg-emerald-500/15` | `bg-palm-50` |  |
| `border-emerald-500/30` | `border-palm-200` |  |
| `text-amber-400` (over-cap) | `text-sun-600` |  |
| `bg-amber-950/30` | `bg-sun-50` | warning row |
| `text-yellow-300` (claim code) | `text-sun-700` |  |
| `bg-red-700` (Stop) | `bg-ember-500 hover:bg-ember-600` |  |
| `text-red-400` (errors) | `text-ember-500` |  |

## Don't replace — keep as-is

- The 🌴 emoji in the Easter egg overlay. It's the one exception.
- `EGG-EXEGGCUTE` claim code text.
- `font-mono` class — still valid; it now resolves to JetBrains Mono.
- `font-sans` — still valid; resolves to DM Sans.

## Add to elements that lost contrast

Dark surfaces hid weak shadows. On cream, some elements need help:

| Element | Add |
|---|---|
| Primary CTA buttons | `shadow-sm` (or `shadow-md` for hero CTA) |
| Feature/open cards | `shadow-xs` resting, `hover:shadow-md` |
| Step numbered badges | `shadow-md` |
| Hero code block | `shadow-md` |
| Modal panels | `shadow-xl` |

---

## Quick sed (preview only — review every diff)

If you want to draft the sweep mechanically before hand-tuning, the
following one-liner covers the unambiguous cases. **Always review the
diff** — some `bg-zinc-900` instances are correct on cream once you add a
shadow, and a few `text-white` instances are inside dark-bg components
that you may want to keep dark (the easter egg overlay, for example).

```bash
cd web/src
rg -l 'bg-zinc-950|bg-blue-|text-zinc-' \
  | xargs sed -i '' \
    -e 's/bg-zinc-950/bg-sand-50/g' \
    -e 's/bg-zinc-900/bg-white/g' \
    -e 's/bg-zinc-800/bg-sand-200/g' \
    -e 's/border-zinc-800/border-sand-300/g' \
    -e 's/border-zinc-700/border-sand-400/g' \
    -e 's/text-zinc-100/text-coconut-700/g' \
    -e 's/text-zinc-200/text-coconut-600/g' \
    -e 's/text-zinc-300/text-coconut-500/g' \
    -e 's/text-zinc-400/text-coconut-400/g' \
    -e 's/text-zinc-500/text-sand-500/g' \
    -e 's/bg-blue-600/bg-sun-300/g' \
    -e 's/bg-blue-500/bg-sun-300/g' \
    -e 's/hover:bg-blue-500/hover:bg-sun-400/g' \
    -e 's/text-blue-400/text-palm-500/g' \
    -e 's/text-green-400/text-palm-500/g'
```

(macOS `sed -i ''`; Linux drop the `''`.)
