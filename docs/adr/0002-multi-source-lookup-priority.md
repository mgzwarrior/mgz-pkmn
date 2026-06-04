# ADR 0002: Layer three open data sources with explicit priority order

- **Status:** Accepted (pricing-priority aspect partially superseded by [ADR-0023](0023-source-ensemble-pricing.md))
- **Date:** 2026-05-09
- **Tags:** lookup, sources, data

> **Amendment (2026-06-03):** The *pricing display* part of this ADR —
> "the first source that produces a usable match wins" — is superseded
> by [ADR-0023](0023-source-ensemble-pricing.md), which switches
> pricing to a multi-source ensemble with user-selectable preferences.
> This ADR continues to govern **card-object resolution** (which
> source's metadata is authoritative for structural fields like name,
> set, number, art) and the failure-message contract.

## Context

A single Pokemon TCG database doesn't cover every product a real
collector might list:

- **pokemontcg.io** has excellent English / international English coverage
  but doesn't index Japanese-only promos, regional Chinese products, or
  many sealed/box products.
- **TCGdex** has multilingual coverage (Japanese, Korean, Chinese, French,
  German, Spanish, Italian, Portuguese, Polish, Dutch, …) but its
  English coverage trails pokemontcg.io and its pricing is Cardmarket-only.
- **PriceCharting** has strong coverage of region-exclusive products
  (Chinese Gem Pack, Japanese collector boxes, etc.) but its search is
  ambiguous for similarly-named cards across regions and its API
  surface is basically "scrape this product page."

Auto-merging or auto-fanning across all three for every line burns API
quota, slows down lookups, and produces wrong answers when a card has
near-namesakes in multiple regions.

## Decision

Try sources in a fixed priority order, with the first usable match
winning:

1. **PriceCharting URL** if the line has one (explicit or via a sticky
   override from a previous run). The user has already disambiguated.
2. **pokemontcg.io** for everything else. Best signal-to-noise for the
   majority of cards.
3. **TCGdex** as a multilingual fallback. The locale chain is driven by
   per-line keywords (`Cubone Chinese SIR …`), the global `--lang` flag,
   then `en`.

Failure produces a structured `MatchResult` with a `reason`
(`set_mismatch`, `no_candidates`) so the caller can render an
appropriate message.

## Consequences

- Lookup is deterministic — the same input produces the same source
  attribution across runs.
- Adding a fourth source is a bounded change: drop a module under
  [`src/mgz_pkmn/sources/`](../../src/mgz_pkmn/sources/) that returns
  the normalized card shape, then slot it into `lookup.find_card`.
- PriceCharting matches require the user to paste a URL. That's
  friction, but it's the price of correctness for region-exclusive
  products.
- Some Japanese promos that *do* exist in pokemontcg.io get matched
  there before TCGdex even gets consulted — that's intentional, since
  pokemontcg.io's data is generally cleaner, but it does mean TCGdex
  language banners only appear when pokemontcg.io misses.

## Alternatives considered

- **Single source.** Rejected because none of the three covers every
  card the tool needs to handle.
- **Parallel fan-out across all three.** Multiplies API calls,
  complicates result merging, and doesn't actually help (the user
  doesn't want three rows for the same card — they want the canonical
  one). The chained-priority shape collapses to one network call per
  line on the happy path.
- **Auto-search PriceCharting.** Too noisy: searching "Charizard" on
  PriceCharting returns dozens of products across regions and the
  algorithm has no good way to pick the right one. Pasting a URL is
  the explicit fix.
