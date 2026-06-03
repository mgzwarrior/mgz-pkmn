# ADR 0022: Structured query DSL with dual-mode + smart auto-detect

- **Status:** Proposed
- **Date:** 2026-06-03
- **Tags:** parser, lookup, web, epic-query-dsl

## Context

mgz-pkmn's input parser today is a **flavor-text** parser: it tokenizes
free-form lines like `top 5 Charizard from Surging Sparks under $50`
into a `CardQuery` dataclass by recognizing keywords (`top`, `from`,
`under`, `over`), bracketed variants (`[holo]`), URLs, and a few
shorthand markers. It's friendly for first-time users and matches the
"talking about cards out loud" cadence.

[Issue #39](https://github.com/mgzwarrior/mgz-pkmn/issues/39) proposed
replacing this with a **structured DSL** like
`top:N subtype:V,VMAX in "Surging Sparks" rarity:rare>=$50` to enable
precise, composable queries (boolean combinations, range predicates,
multi-field intersection) that the flavor parser can't express
reliably.

The maintainer's read after live use: **both modes have a real
audience**. The flavor parser stays welcoming for casual users; the
DSL unlocks power-user workflows (filtering wishlists, vendor pulls,
analytics). Forcing one or the other regresses one population.

## Decision

Ship **both modes**, with a frontend toggle and a smart auto-detect
default:

1. **`QueryMode` strategy interface.** A small interface in the parser
   layer that accepts a raw line and returns a `CardQuery`. Two
   implementations: `FlavorMode` (the current parser, unchanged
   behavior) and `DslMode` (the new Lark/PEG grammar).

2. **DSL grammar.** Documented in `docs/query-dsl.md`. Key tokens:
   - `key:value` predicates (`subtype:VMAX`, `rarity:rare`,
     `type:Fire`, `set:"Surging Sparks"`).
   - Range predicates with comparators (`price>=50`, `hp<100`).
   - Boolean combinators (`AND`, `OR`, `NOT`; `AND` is implicit).
   - Top-N selector (`top:N`) as a query-level modifier.
   - Quoted strings for multi-word values (`set:"Surging Sparks"`).
   - Backwards-compatible: an input that parses cleanly under
     `FlavorMode` continues to work in flavor mode without change.

3. **Frontend toggle.** A mode switch in the SPA (in Settings + an
   inline switcher above the query box) sets the per-user default mode.
   Persists in the user record when signed in; in localStorage when
   anonymous.

4. **Smart auto-detect.** Regardless of the toggle, if input contains
   any **unambiguous DSL token** (e.g. `key:value` where `key` is a
   known DSL key, or a `>=$` / `<=$` comparator), the line is parsed
   as DSL. The toggle only resolves the ambiguous middle. An inline
   hint ("interpreted as DSL — switch?") surfaces the auto-detect so
   users can learn the mode boundary.

5. **Lookup planner.** A new planner in `src/mgz_pkmn/lookup/` walks
   the DSL AST and pushes predicates to the appropriate source API
   (e.g. `subtype:` and `type:` become pokemontcg.io `types:` /
   `subtypes:` filters; `price>=` is applied client-side after the
   fetch since no source exposes a server-side price filter).

## Consequences

Positive:

- Casual users keep the input shape they already know.
- Power users get composable predicates and Top-N over filtered sets.
- Auto-detect lets users learn the DSL by typing one token at a time,
  without flipping a setting first.

Negative:

- Two grammars to maintain. Mitigated by sharing the post-parse
  `CardQuery` shape — only the parsing stage differs.
- "Interpreted as DSL" surprise on flavor-mode input that happens to
  contain a `:`. Mitigated by restricting auto-detect to *known* DSL
  keys (`subtype:`, `rarity:`, etc.), not any token with a colon.
- Documentation effort: `docs/query-dsl.md` with worked examples and a
  cheat sheet drawer in the SPA. Worth the cost.

Neutral:

- Closes #39 once the dual-mode contract ships. The original "DSL
  replaces flavor" framing is explicitly rejected in favor of this
  dual approach.

## Alternatives considered

- **DSL only; deprecate flavor.** Cleaner maintenance but regresses
  the casual audience that the project was designed for.
- **Single auto-detect, no toggle.** Simpler UX but harder to teach;
  users can't see the rules. Rejected — we keep auto-detect *and* a
  visible mode setting so the system is legible.
- **Server-side query planner only (no DSL on the CLI).** Forecloses
  power-user CLI workflows (`pkmn lookup -e 'top:5 subtype:VMAX'`).
  Rejected.
