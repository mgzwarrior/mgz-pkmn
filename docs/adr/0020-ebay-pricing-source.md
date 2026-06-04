# ADR 0020: eBay as a first-class pricing source

- **Status:** Proposed
- **Date:** 2026-06-03
- **Tags:** sources, pricing, auth, epic-ebay

## Context

mgz-pkmn currently resolves pricing from three sources, layered in the
order defined by [ADR-0002](0002-multi-source-lookup-priority.md):
pokemontcg.io (embedded `tcgplayer` and `cardmarket` blocks), TCGdex
(structural only — no pricing), and PriceCharting (when a user pastes
a URL). The hosted demo will shortly cut over to Scrydex
([#351](https://github.com/mgzwarrior/mgz-pkmn/issues/351)) for the
pokemontcg.io path, but none of these surfaces give us **sold-listings
distribution**, which is the single most useful signal for setting a
realistic asking price at a card show.

eBay's Developer API exposes both `findCompletedItems` (sold) and
`findItemsAdvanced` (active) endpoints, with OAuth client credentials
and rate limits that are workable for our scale (one listing-set
fetched per resolved card, cached aggressively).

The `epic:ebay` umbrella tracks the implementation; this ADR records
the source-layering decision and the contract.

## Decision

Add **eBay** as a new source in the lookup pipeline, contributing
**sold-listings median + active-listings floor** as independent
pricing data points. Per
[ADR-0023](0023-source-ensemble-pricing.md), pricing is computed as an
ensemble across all configured sources rather than first-source-wins;
this ADR records the eBay-specific contract (auth, caching, display)
that the ensemble layer consumes.

For **card-object resolution** (structural fields), eBay is *not* a
source — listing titles are too unreliable for structural data. eBay
only contributes to the pricing ensemble.

The eBay source contributes two new `Pricing.source` enum values:
`"ebay_sold"` and `"ebay_active"`. Both flow through the existing
`Pricing` dataclass; consumers (spreadsheet, JSON report, web UI) treat
them as additional price tiers rather than replacing existing values.

Authentication uses the eBay Developer **OAuth client-credentials
flow** for application-level reads. The token is stored as an env var
(`MGZ_PKMN_EBAY_TOKEN`) on the hosted demo and refreshed via a
background task; no per-user OAuth (no per-user eBay account is
required to consume public listing data). User-scoped eBay flows
(e.g. "list this card to my eBay") are out of scope here and would
require a separate ADR.

Caching policy: eBay results live under
`api_pricing/<sha1>.json` like all other pricing data, with a
**source-specific TTL**: sold listings carry a **7-day TTL** (sales
data is more stable; backfill comps from the past week are equally
useful day-to-day), active listings carry a **6-hour TTL** (more
volatile, more sensitive to user expectations of freshness). This
extends [ADR-0018](0018-structural-vs-volatile-cache-with-swr.md)'s
single-TTL pricing model.

## Consequences

Positive:

- Sold-listings comps give a real price-discovery signal, complementing
  TCGPlayer's spread-based market price.
- Plugs into the ensemble model from
  [ADR-0023](0023-source-ensemble-pricing.md) — sold and active are
  separate `Pricing.source` enum values so users can toggle them
  independently in the Settings drawer.
- Per-source TTL paves the way for the same treatment in
  [ADR-0021](0021-tcgplayer-first-class-pricing.md) (TCGPlayer market
  price is intermediate-volatility).

Negative:

- eBay's API has rate limits (5000 calls/day on the default tier)
  that will eventually bound how many cards we can comp per warm pass.
  Mitigated by the 7-day sold TTL.
- A new third-party service to monitor (token rotation, ToS changes,
  API deprecations).
- Sold-listing data includes outliers (mis-listings, condition
  mismatches) that need filtering before display. Median-of-N comps
  rather than raw last-sale.

Neutral:

- Adds an opt-in `--ebay` CLI flag for parity with the existing
  `--no-cache` / `--clear-cache` style. Default is on for the hosted
  demo, off for the CLI when no token is configured.

## Alternatives considered

- **Skip eBay; rely on TCGPlayer market price as the comp signal.**
  Loses the sold-distribution signal, which is qualitatively different
  from market price. Rejected — see the original framing in #40 (now
  closed in favor of the [`epic:ebay`](https://github.com/mgzwarrior/mgz-pkmn/labels/epic%3Aebay)
  umbrella).
- **Use only sold listings, skip active.** Active listings are useful
  as a "what's the floor right now" signal at a show. Cheap to fetch;
  worth including.
- **Run the eBay fetch entirely client-side from the SPA.** Would
  eliminate the server-side rate limit but exposes the API key and
  prevents caching. Rejected.
