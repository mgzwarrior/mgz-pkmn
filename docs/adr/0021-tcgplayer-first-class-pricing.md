# ADR 0021: First-class TCGPlayer pricing via the TCGPlayer API

- **Status:** Proposed
- **Date:** 2026-06-03
- **Tags:** sources, pricing, auth, epic-tcgplayer

## Context

Today, every pokemontcg.io card response embeds a `tcgplayer` block
with market, low, mid, and high prices that pokemontcg.io has scraped
or licensed from TCGPlayer. That block has been the de facto
"canonical" market price in mgz-pkmn since v1, but it has three
limitations:

1. **Lag.** Refresh cadence is whatever pokemontcg.io chooses; we have
   no contract for it.
2. **Opacity.** We can't ask follow-up questions of the data (sales
   history, sealed-product prices, condition spread).
3. **No write path.** We can't link out to or auto-list against a
   specific TCGPlayer SKU.

TCGPlayer's developer API
([docs](https://docs.tcgplayer.com/reference/app_authorizeapplication))
exposes per-SKU pricing, market history, and (via the seller endpoints)
a per-user authorize-application flow that lets sellers connect their
TCGPlayer account to a third-party app for listing and inventory
operations. The `epic:tcgplayer` umbrella tracks the implementation;
this ADR records the **direct-source** decision and the **token
storage** contract.

## Decision

Treat TCGPlayer as a **first-class pricing source** when credentials
are present:

- A new `TCGPlayerClient` adapter in `src/mgz_pkmn/sources/` implements
  the existing source contract, returning a `Pricing` entry with
  `source="tcgplayer_api"`.
- When the client is configured, the embedded `tcgplayer` block from
  pokemontcg.io is **superseded** for display purposes: the live API
  data wins. The embedded block is still kept in the structural cache
  for offline fallback and remains the default when no credentials are
  configured.
- Per-user **OAuth tokens** (TCGPlayer `app/authorizeApplication`) are
  stored in the new persistence layer
  ([ADR-0013](0013-sqlite-persistence-for-runs-collections-wishlists.md)).
  Tokens are scoped per `user_id` in a new `tcgplayer_tokens` table,
  encrypted at rest with the same session-secret key used by
  [ADR-0019](0019-hosted-demo-identity-and-auth.md).
- App-level (no user) reads use a **single shared application token**
  configured via `MGZ_PKMN_TCGPLAYER_APP_TOKEN`. Sufficient for the
  read-only "what's the market price" path; required for the
  write-path features (out of scope for this ADR — captured under V3
  vendor track).

Caching: per ADR-0020's pattern, TCGPlayer market price carries an
**intermediate TTL of 12 hours**, between the 6-hour active-listings
window and the 7-day sold-listings window. The split-cache structural
slice (ADR-0018) is unaffected.

## Consequences

Positive:

- Real-time market price unhitched from pokemontcg.io's refresh
  cadence.
- Foundation for the V3 vendor write path (auto-list, inventory sync).
- Per-user tokens land cleanly on the new persistence layer; no
  separate keystore needed.

Forward-looking note:

- **TCGPlayer may become the *default* pricing path** if pokemontcg.io
  is sunset or the [Scrydex cutover (#351)](https://github.com/mgzwarrior/mgz-pkmn/issues/351)
  turns out cost-prohibitive after Phase 4 lands. Under
  [ADR-0023](0023-source-ensemble-pricing.md) the ensemble model is
  source-agnostic, so the "default" change is just a re-weight of the
  user-preference defaults rather than an architectural shift. The
  TCGPlayer adapter is built with that downstream reuse in mind:
  per-SKU pricing, sealed-product support, and condition-aware
  pricing are all on the API surface even when we don't show them
  in v1.6's MVP, so an upgrade to "TCGPlayer + cardmarket only" later
  doesn't require new adapter work.

Negative:

- TCGPlayer's OAuth flow requires app review and approval. The hosted
  demo will need a published privacy policy + ToS page; reflect in the
  v1.6 launch checklist.
- Token encryption requires the persistence layer (ADR-0013) to be
  live. Pairs the v1.6 ship with V2 timing.
- Two source-of-truth blocks for the same data (embedded
  pokemontcg.io's `tcgplayer` block + the live API) creates a
  divergence-monitoring question. We mitigate by logging when they
  drift past a configurable threshold and surfacing it as an
  observability signal, not a user-facing one.

Neutral:

- A `Connect TCGPlayer` settings panel in the SPA (see the epic's
  frontend task) introduces a new auth-status UX pattern that the eBay
  user-OAuth path (deferred to V3) will reuse.

## Alternatives considered

- **Keep the embedded `tcgplayer` block; skip the API.** Cheapest path,
  but forecloses the write-path features the V3 vendor track depends
  on. Rejected.
- **Use the API only for sealed product, leave singles on
  pokemontcg.io.** Plausible but inverts the priority — singles are
  what users want freshest. Rejected.
- **Anonymous (no-OAuth) read access only.** Available via the public
  catalog endpoints but the SKU-level pricing requires authentication.
  Would limit us to coarse data.
