# Accessibility

The mgz-pkmn web UI ([api/](../api/) + [web/](../web/)) is built to be
usable with a keyboard, a screen reader, or low-vision settings. This
page describes what we commit to, how the commitment is enforced, and
where to file a regression.

The CLI is a separate surface — color output is opt-out via standard
terminal conventions (`NO_COLOR=1` honored by [Click][click-no-color]).
The rest of this page is web-UI only.

[click-no-color]: https://click.palletsprojects.com/en/stable/api/#click.echo

## What we commit to

- **No critical or serious axe-core violations** on the rendered UI.
  This is enforced in CI — see [How we enforce it](#how-we-enforce-it).
- **WCAG 2.1 AA color contrast** on every piece of text the user is
  expected to read. Helper copy, section headings, the footer, and the
  empty-state messages all clear 4.5:1 against their background.
- **Full keyboard reach.** Every interactive control is reachable via
  Tab in a sensible order. No keyboard traps. Modal dialogs close on
  `Esc` and return focus to the trigger that opened them.
- **Accessible names on every interactive.** Icon-only buttons (Help,
  Settings, close buttons, the empty results-table action column) all
  carry an `aria-label` or an `sr-only` label so a screen reader
  announces what they do.
- **Landmark structure.** The page has exactly one `<h1>` (visually
  hidden but present in the accessibility tree) inside the `<header>`
  landmark, plus `<main>` and `<footer>` landmarks.
- **Visible focus indicators.** Every focusable element shows a focus
  ring when reached via keyboard.

## How we enforce it

Two layers.

**1. Per-component axe-core assertions** in
[`web/src/components/a11y.test.tsx`](../web/src/components/a11y.test.tsx).
The test mounts each top-level component in its common states (closed
and open for modals, empty and populated for the results table) and
asserts no axe violations. The matcher fails on **any** violation, not
just critical — so the regression bar is stricter than the policy
statement above. Runs as part of `npm test` and CI's `web` job.

**2. Live-browser scan.** During the original audit ([#62][issue-62] /
[PR #220][pr-220]), axe-core 4.10 was injected into the running dev
server and re-run against every UI state — including states JSDOM
can't fully model (modal portals, real color contrast computation,
scrollable region detection). Use this when adding new UI surfaces:

```bash
make dev-api & make dev-web
# open http://localhost:5173, then in the browser console:
const s = document.createElement('script')
s.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
s.onload = async () => console.table((await axe.run(document)).violations)
document.head.appendChild(s)
```

[issue-62]: https://github.com/mgzwarrior/mgz-pkmn/issues/62
[pr-220]: https://github.com/mgzwarrior/mgz-pkmn/pull/220

## Color-coded progress stages

While a bulk lookup runs, the per-line progress panel
([`ProcessingQueue`](../web/src/components/ProcessingQueue.tsx)) renders
each line's current pipeline stage as a color-coded chip. Color is never
the *only* signal — every chip also carries a text label and a hover
tooltip — but the colors still clear WCAG 2.1 AA contrast (≥ 4.5:1)
against the app background (`bg-zinc-950`, `#09090b`). All are Tailwind
`*-400` shades:

| Stage | Class | Meaning |
|---|---|---|
| Parsed | `text-zinc-400` | Line accepted by the parser; queued for lookup |
| Looking up | `text-blue-400` | Querying the first source (pokemontcg.io) |
| Fallback | `text-indigo-400` | First source missed; trying TCGdex |
| URL hint | `text-violet-400` | URL-based scrape (PriceCharting) |
| Pricing | `text-cyan-400` | Card resolved; building the pricing snapshot |
| Image | `text-teal-400` | Downloading + thumbnailing the image (CLI only) |
| Resolved | `text-green-400` | Done, matched |
| No match | `text-amber-400` | Done, no card found |
| Error | `text-red-400` | Hard failure (network, parse, etc.) |

The `Image` stage is part of the shared vocabulary but the web app runs
image-free, so it never appears in the SPA. A **Legend** toggle in the
panel header (collapsed by default) maps the colors back to their labels.
When adding or recoloring a stage, keep it a `*-400`-or-lighter shade and
re-run the live-browser contrast scan below.

## Keyboard reference

| Where | Key | Effect |
|---|---|---|
| Anywhere | `Tab` / `Shift+Tab` | Move focus to the next / previous interactive |
| Card-list textarea | `Cmd/Ctrl + Enter` | Run the lookup (same as the **Look up** button) |
| Help / Settings modal | `Esc` | Close the modal; focus returns to the trigger button |
| Help modal body | `↑` / `↓` / `PageUp` / `PageDown` | Scroll the modal body (it's a focusable region) |
| Results table column header | `Enter` / `Space` | Cycle sort: asc → desc → off |
| Filter toggle | `Enter` / `Space` | Show / hide the per-column filter row |

The `Cmd+Enter` shortcut is the only application-specific binding; the
rest are standard browser / Radix UI defaults.

## Adding new UI

When you add a new component or interactive surface:

1. Add an `expectNoViolations` assertion for the new component to
   `a11y.test.tsx`. If the component has meaningfully different states
   (closed vs. open, empty vs. populated), cover each. The
   `ResultsTable` block is the most complete example.
2. Run the live-browser scan above against the new surface — JSDOM
   doesn't compute color, so contrast regressions don't show up in CI.
3. If the new component is rendered into a portal (Radix Dialog,
   Tooltip, DropdownMenu) and the test mounts a closed trigger, scan
   `document.body` rather than the mount `container` so the portal
   content is included.

## Filing a regression

Open a bug report with the
[bug template](https://github.com/mgzwarrior/mgz-pkmn/issues/new?template=bug.md)
and tag it `area:web`. If the issue is reproducible with
keyboard-only navigation or a specific assistive technology, please
note which — that makes the fix much faster.
