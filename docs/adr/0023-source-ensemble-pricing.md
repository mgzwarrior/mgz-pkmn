# ADR 0023: Source ensemble for pricing display (with user-selectable preferences)

- **Status:** Proposed
- **Date:** 2026-06-03
- **Tags:** sources, pricing, web, supersedes-aspects-of-0002

## Context

[ADR-0002](0002-multi-source-lookup-priority.md) established a strict
**priority order** across three sources: pokemontcg.io → TCGdex →
PriceCharting. Each row's pricing was set by the first source that
returned a usable value. That contract was right for v1, when the
project had one source per data shape (catalog from pokemontcg.io,
multilingual fallback from TCGdex, explicit URL paste from
PriceCharting), and it kept the lookup pipeline simple.

The picture is changing as we add eBay (ADR-0020) and a first-class
TCGPlayer client (ADR-0021):

1. **Several sources will overlap meaningfully on the same data
   shape.** TCGPlayer market price, eBay last-sold median, pokemontcg.io's
   embedded `tcgplayer` block, and PriceCharting's "loose" price are all
   plausible candidates for "the Market Price" of a given card.
2. **Ordering by source hides useful signal.** A strict
   first-source-wins resolution treats the also-rans as wasted work; a
   user looking at the row never sees that two sources agreed within
   $2 and a third was an outlier, which is exactly the read a vendor or
   collector wants.
3. **User preference varies.** A vendor pricing a binder for a card
   show wants eBay sold-listings as the primary anchor. A collector
   checking value before sealing a wishlist wants TCGPlayer market.
   A casual user wants whatever's reasonable without configuring
   anything. One ordering can't serve all three.

## Decision

Replace the **pricing display** aspect of ADR-0002 with a **source
ensemble model**. ADR-0002 still governs which source's **card object**
wins for structural fields (name, set, number, art) — that resolution
problem is unchanged. What changes is how pricing values are surfaced.

**The model:**

1. **Every configured source contributes its pricing as an independent
   data point.** The lookup pipeline calls every applicable source for
   each card, in parallel, and collects whichever values come back.
2. **The displayed Market Price is an aggregate** — by default a
   **trimmed mean** (drop the highest and lowest if ≥4 values, plain
   mean otherwise) across the user-enabled pricing sources. Less
   sensitive to a single outlier than a plain mean, lighter to compute
   than a full distribution.
3. **The card detail drawer shows the breakdown** — per-source value,
   freshness, and any drift flag.
4. **Per-user source preferences live in the SPA Settings drawer** as a
   feature-flag-style toggle per source. Anonymous users get a sensible
   default set (TCGPlayer + pokemontcg.io's embedded block); signed-in
   users persist their choices to the new persistence layer (ADR-0013).
5. **A "primary anchor" preference** lets users tag one source as the
   one they want to see as the headline Market Price; the aggregate
   still computes, but the displayed value can favor the anchor when
   it disagrees with the aggregate by more than a configurable
   threshold (logged but not auto-resolved).
6. **The CLI keeps a default deterministic ordering** for non-interactive
   use — the same default the SPA shows for anonymous users — so
   `pkmn lookup` runs are reproducible without a settings layer.

**What ADR-0002 still owns:**

- Card-object resolution: which source's card metadata is the
  authoritative shape (name, set, number, attacks, art URLs). The
  priority order there is preserved unchanged.
- Fallback chain when *no* pricing comes back from the enabled
  sources: TCGdex's structural-only fallback continues to mean "no
  price available," not "use TCGdex's $0".

**Out of scope:**

- Time-series pricing or historical comps. Each source provides a
  current snapshot; trends are a v3 concern.
- Per-condition pricing (NM / LP / MP / HP). Tracked separately in
  #270; the ensemble model is condition-agnostic at the contract
  level.

## Consequences

Positive:

- A pricing row now reflects market consensus across multiple sources,
  not a single source's read. Outlier sources show up in the breakdown
  rather than silently winning.
- The user-preference layer lets vendor and collector audiences each
  configure the tool for their own primary signal without the
  defaults arguing about who's right.
- Ensemble computation is independent of source layering, so adding a
  sixth or seventh source later (CardMarket direct, Scrydex, …) is a
  config change, not a re-ranking exercise.

Negative:

- N sources called per card vs. 1-2 today. The cache (ADR-0018 split,
  per-source TTLs from ADR-0020) absorbs most of the cost on warm
  runs, but cold-cache performance degrades linearly with sources
  enabled. Mitigation: parallel fetches; a budget that caps
  concurrent upstream calls.
- Aggregate-display means the user can't always point at a single
  source as "where this number came from." The drawer breakdown
  mitigates the trust hit; users who want a single source can pin
  one as primary anchor.
- ADR-0002 is partially superseded — the load-bearing
  *priority-for-pricing* claim no longer holds. The ADR file gets a
  Status amendment pointing here.

Neutral:

- The ensemble lives behind a feature flag (`MGZ_PKMN_PRICING_ENSEMBLE`)
  during rollout. Default `0` initially; flips to `1` once the SPA
  Settings drawer ships the source-selection UI. Old behavior
  (first-source-wins) remains available via the flag for a
  deprecation window.

## Alternatives considered

- **Keep strict priority ordering; add a "show breakdown" toggle.**
  Cheapest implementation but loses the consensus benefit — users
  see one number as canonical and the breakdown as decoration.
- **Auto-detect "primary source" per card based on confidence.** Too
  much magic; freshness and rate-limit considerations vary by source
  in ways the planner can't reliably score.
- **Pure user choice (no default aggregate).** Forces every user to
  configure preferences before getting useful output. Bad casual-user
  experience.
