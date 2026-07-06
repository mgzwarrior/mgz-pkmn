# Competitive analysis: TCG Codex

Prepared 2026-07-06. Sources: [tcgcodex.com/premium](https://tcgcodex.com/premium) (subscription tiers, fetched live) and the inline OpenAPI 3.1 spec served at [tcgcodex.com/api](https://tcgcodex.com/api) (Stoplight Elements page; the spec document is embedded directly in the page's `<script>` tag as `docs.apiDescriptionDocument`, not a separate JSON file — a raw copy is archived at the bottom of this doc for future reference since the live page requires JS rendering to view). Codebase claims below are grounded in file:line references gathered from this repo at the same commit as this doc.

## 1. Who TCG Codex is

TCG Codex is a multi-TCG collection tracker: the OpenAPI spec's `Variant` enum alone carries prefixes for `pkmn_` (Pokemon), `lor_` (Lorcana), `mtg_` (Magic), `optcg_` (One Piece), and `swu_` (Star Wars: Unlimited), and `GameResource`/metadata resources exist per-game (`PokemonMetadataResourceV2`, `LorcanaMetadataResourceV2`, `MagicTheGatheringMetadataResourceV2`, `OnePieceMetadataResourceV1`, `StarWarsUnlimitedMetadataResourceV1`). Its core product is a collection/wishlist/price-tracker web app with a public API, monetized through a four-tier subscription (Free / Premium / Elite / Enterprise).

Its pricing is quoted in **euros** and its primary pricing/marketplace integration is **Cardmarket** (a European secondary-market platform) — not TCGPlayer or eBay. Combined with the site's positioning copy ("we don't care if you're a casual collector or a dedicated enthusiast"), this reads as a EU-first product with no visible American-market-specific messaging, no USD-denominated pricing, and no mention of TCGPlayer or eBay anywhere in the subscription or API surface. This is the clearest opening for mgz-pkmn's stated American-audience focus — see §5.

## 2. Subscription tier breakdown

| Feature | Free | Premium (€2.99/mo · €29.99/yr) | Elite (€4.99/mo · €49.99/yr) | Enterprise (€249.99/yr) |
|---|---|---|---|---|
| Cards | Standard info only | Cardmarket links (default variant) | Cardmarket links (all variants) + condition/language/seller-country filters | — |
| Collections | Max 3, non-sharable | Unlimited | Unlimited | — |
| Card variants tracked | Max 2 per card | Unlimited | Unlimited | — |
| Price history | None | 30 days | Full history | — |
| Trackers | Max 5 | Unlimited | Unlimited | — |
| Custom lists | Max 3 | Unlimited | Unlimited | — |
| FairTrade listings | 6 cards | 20 cards | 50 cards | — |
| API pricing access | No pricing data | Basic variants | All variants + 14-day history | — |

Enterprise's feature rows weren't broken out on the public page beyond the price point — it reads as a developer/business API tier gated behind a much higher annual-only price, consistent with high-volume API access being a separate product motion (a pattern mgz-pkmn already knows well from the TCGPlayer/eBay developer-access gates noted in [docs/roadmap.md](../../roadmap.md)).

Two things stand out about the monetization shape:

- **Every meaningful limit is a count cap, not a capability cap.** Free users get the same *kind* of feature as paid users (collections, variants, price history, lists) — just fewer of them. Nothing is feature-gated outright except pricing data and the Cardmarket marketplace filters. This is a soft funnel: casual users hit a wall (3 collections, 5 trackers) after real usage, not on day one.
- **Variant tracking and price history are themselves premium-priced.** The "variants problem" isn't just an engineering problem for them — unlimited variant tracking is literally one of the two hard caps that convert Free → Premium. That's a strong signal the underlying capability (see §3) is core, not decorative.

## 3. The variants problem — how they actually solved it

This is the most transferable finding. TCG Codex models a physical card variant as a **flat controlled-vocabulary enum**, not a set of booleans or free text. The `Variant` schema in their OpenAPI spec has **164 enum values** across all five games. For Pokemon alone (`pkmn_*` prefix) it covers, in rough categories:

- **Printing/finish variants**: `pkmn_regular`, `pkmn_foil`, `pkmn_first_ed`, `pkmn_rev_holo`, `pkmn_cosmos_holo`, `pkmn_cracked_ice_holo`, `pkmn_tinsel_holo`, `pkmn_mirror_reverse_holo` (and three more mirror sub-variants: pokeball / masterball / friend-ball reverse), `pkmn_shadowless`, `pkmn_energy_reverse_holo`, and a dozen more finish-specific holo patterns.
- **Tournament/event stamps**: an extensive, near-exhaustive list of regional and world championship variants — `pkmn_regional_championship(_staff)`, `pkmn_national_championship(_staff)`, `pkmn_worlds` through `pkmn_worlds_champion` (with top32/top16/quarter/semi/final sub-tiers), and per-region international variants (EU, Oceania, LatAm, NA, Singapore, Malaysia, Philippines, Hong Kong) each with promo/staff/top8/champion sub-variants.
- **Distribution-channel promos**: `pkmn_game_stop`, `pkmn_toys_r_us`, `pkmn_build_a_bear`, `pkmn_eb_games`, `pkmn_711`, `pkmn_burger_king`, `pkmn_sdcc`, `pkmn_gencon`, `pkmn_e3`, `pkmn_nintendo_world`, `pkmn_wizard_world`, `pkmn_kraft` — real-world retailer/event exclusives that a naive "holo/reverse-holo/1st-ed" model would silently drop.

Each **card** carries a `variants` array (its attribute schema shows an example: `['pkmn_foil', 'pkmn_rev_holo']`) enumerating which of the 164 possible variants that specific printing actually has. Each **set** (`SetResource`) carries both `card_printed_total` and `card_total` — the base print-run count vs. the variant-inclusive count — which is exactly the numerator/denominator pair a master-set completion tracker needs. A user's owned copy is a `Collectible` (not a bare card reference): `card_id` + `variant` (from the enum) + `quality` (an 8-value condition enum: `mt/nm/ex/vg/gd/lp/pl/po`) + `language` + `amount` + a `properties` array (`signed`, `graded`, `altered`) + freeform `notes`. Price data is fetched **per variant**: `CardPriceResource` keys on `variant_raw` (the enum key) with `variant` as the human label, alongside `trend7`/`trend30` deltas and a `priced_at` date — so a reverse holo and a 1st-edition holo of the same card+number carry independent prices and independent trend lines, not one blended number.

The design lesson isn't "have more variant strings than us" — it's the **shape**: a bounded enum owned centrally (not free text, not a boolean flag per finish), attached at three points (card → which variants exist; collectible → which variant + condition + language a specific owned copy is; price → which variant a quoted number describes), with the set's two totals doing double duty as both catalog metadata and completion-tracker denominator/numerator.

## 4. Where this lands relative to mgz-pkmn today

A background codebase survey (this session, read-only) confirms mgz-pkmn has **no equivalent model** today, and — notably — the project has already identified this gap itself:

- **No variant field exists anywhere in the data model.** The word "variant" appears only as (a) the pokemontcg.io/TCGPlayer price-tier key inside opaque JSON blobs (`normal`, `holofoil`, `reverseHolofoil`, `1stEditionHolofoil` — [src/mgz_pkmn/pricing.py:24-32](../../../src/mgz_pkmn/pricing.py)), used to pick *which number to display*, or (b) the `Pricing.variant` dataclass field ([pricing.py:41](../../../src/mgz_pkmn/pricing.py)), which records which price-tier produced a comp — not which physical printing a collector owns. [src/mgz_pkmn/sources/ebay_client.py:297](../../../src/mgz_pkmn/sources/ebay_client.py) even reuses that same field to stash the eBay listing's condition string, confirming it's a loose "price context" label today, not a collectible attribute.
- **[#776](https://github.com/mgzwarrior/mgz-pkmn/issues/776) already names this exact gap.** The "Targeting the master set (every variant)" checkbox on a binder is persisted and echoed back by the API, but nothing reads it — confirmed by the issue's own grep across every read path. Its own text: *"We don't track variants today, so checking the box has zero effect on the cards saved."*
- **Master-set/set-completion *infrastructure* already exists and is more mature than the variant gap suggests.** `Collection.kind = "set"` anchored on `source_set_id`, `CollectionSnapshot.set_completion_pct`, and a binder-level `is_master_set` flag are all shipped ([api/db/models.py](../../../api/db/models.py), migration `c01ec71011a7`). The plumbing for "X of Y owned" is real — it's just computing Y (and matching X) against the *base* card count, because there's no variant enumeration to expand against.
- **Condition/quality tracking was explicitly deferred, not overlooked.** [ADR-0025](../../adr/0025-collections-data-model-rework.md) (§Alternatives) records a direct decision: *"Per-condition quantity (NM/LP/MP/HP/DM) inline on `collection_items`... Rejected for v1... Deferred to a future child as a separate `collection_item_copies` table or column-set."* The only condition field that exists today is free-text, sourced from eBay listing text for reference pricing ([web/src/types.ts:25](../../../web/src/types.ts)) — not a collector-facing enum on owned cards.
- **Source coverage for variant-level pricing is uneven.** pokemontcg.io returns keyed variant pricing (normal/holofoil/reverseHolofoil/1st-ed) that mgz-pkmn already parses for comps. TCGdex passes through whatever variant-keyed pricing its upstream has, with no additional modeling. PriceCharting returns only condition tiers (used/new/graded), no holo/reverse/1st-ed distinction at all. None of the three exposes anything like TCG Codex's 164-value promo/tournament-stamp vocabulary — that part of TCG Codex's catalog is very likely user-submitted/curated, not pulled from a public aggregator, since neither pokemontcg.io nor TCGdex track event-exclusive stamps at that granularity.

**Bottom line:** mgz-pkmn's own architecture already anticipated this exact deferred work and its own open issue already states the "master set" toggle is a no-op for lack of it. TCG Codex's shipped `Variant`/`Quality`/`Property` schema is a validated reference design mgz-pkmn can adapt rather than invent from scratch — see recommendation R1.

## 5. American-audience & kid/parent differentiation

Two structural gaps in TCG Codex line up directly with the stated goal:

- **Marketplace/currency mismatch.** TCG Codex's paid tiers are built around Cardmarket links, EUR pricing, and "seller country" filters — infrastructure for a European buyer. mgz-pkmn's pricing stack is already USD-first (TCGPlayer + eBay affiliate buy-links, PriceCharting USD, pokemontcg.io's TCGPlayer-sourced comps) with Cardmarket/TCGdex EUR as the secondary/multilingual fallback. This is already the right shape for an American audience — the gap is in *saying so*, not building it. Nothing in TCG Codex's premium page, API, or metadata resources references TCGPlayer, eBay, or USD at all.
- **No kid/parent surface of any kind.** Nothing in the subscription tiers, the API's `UserResource` (`is_verified`/`is_premium`/`is_elite`/`is_enterprise` flags, a `stats` block, one `default_collection`), or any endpoint suggests multi-profile, parent/child, or simplified-mode support. mgz-pkmn already has this queued as [#765](https://github.com/mgzwarrior/mgz-pkmn/issues/765) ("RFC: kid profiles inside a parent account") in the v1.9 milestone — this is a wide-open differentiator with zero visible competitive pressure, not a race to catch up on.

## 6. Other feature-shape observations worth knowing about (lower priority)

- **FairTrade listings** (6/20/50 cards by tier) appear to be an in-house buy/sell/trade board bundled into the *consumer* subscription — not a separate vendor product. mgz-pkmn's closest equivalent ideas (marketplace integrations, trade-matching) currently live in the V3/vendor-vision speculative band per [ADR-0012](../../adr/0012-open-core-architecture.md), gated to a private repo as a paid vendor surface. Worth a future discussion thread on whether a *lightweight*, free-tier trade-list-sharing feature (distinct from the vendor portal) belongs in the open-core product — TCG Codex treats it as a core collector feature, not a vendor one.
- **Elite-tier condition/language/seller-country filtering on Cardmarket links** reinforces that language is a first-class collector dimension for them (multi-language collecting is common in the EU market). mgz-pkmn already threads a `language` field through the TCGdex source payload ([docs/languages.md](../../languages.md)) but doesn't promote it onto `CollectionItem`/`WishlistItem` today — worth folding into the variant/condition model work in R1 rather than a separate migration.
- **Price history is a paid feature for them** (30 days Premium, full history Elite) — mgz-pkmn doesn't currently persist historical price snapshots at all (the "30-day price-trend sparkline" is tracked as unbuilt, [#269](https://github.com/mgzwarrior/mgz-pkmn/issues/269), v1.12). Not urgent relative to R1, but worth noting that TCG Codex treats trend data as monetizable, which supports keeping mgz-pkmn's version free as a differentiator if/when it ships.

## 7. Recommendations

### R1 — Ship a real card-variant + condition data model (highest priority)

This is the one finding worth acting on immediately; everything else in this doc is context. Concretely:

1. Add a bounded `variant` vocabulary (start with a Pokemon-scoped subset covering finish variants — regular/holo/reverse-holo/1st-edition/cosmos-holo — deferring the long tail of tournament-stamp/promo variants until there's a data source for them; pokemontcg.io/TCGdex don't carry that granularity today, so it would need manual curation or a new source).
2. Add a `quality`/condition enum (NM/LP/MP/HP or similar — the ADR-0025 alternative already names this) as the deferred `collection_item_copies` table, replacing the current free-text condition field.
3. Wire both into `CollectionItem`/`WishlistItem` so [#776](https://github.com/mgzwarrior/mgz-pkmn/issues/776)'s master-set toggle has something real to expand membership against, using `SetResource`-style `card_printed_total` vs. variant-inclusive `card_total` as the completion denominator pair.
4. Promote the already-present-but-unused `language` field onto the same rows while the migration is open, since TCG Codex's Elite-tier filtering shows it's a real collector axis.

I've filed this as a new tracking issue and left a comment on #776 pointing at it — see §8.

### R2 — Lead with the USD/TCGPlayer-eBay marketplace angle in positioning

No code change — a copy/positioning opportunity for the in-flight marketing-site accuracy pass ([#794](https://github.com/mgzwarrior/mgz-pkmn/issues/794)) and the maker-story piece ([#800](https://github.com/mgzwarrior/mgz-pkmn/issues/800)). TCG Codex's entire paid pricing/marketplace stack is EUR/Cardmarket; mgz-pkmn's is already USD/TCGPlayer/eBay. That's a real, already-shipped advantage for the American-audience goal that isn't being said anywhere on the marketing site today.

### R3 — Keep pushing kid/parent profiles ([#765](https://github.com/mgzwarrior/mgz-pkmn/issues/765)) — no competitive pressure, pure opportunity

Confirmed nothing in TCG Codex's product touches multi-profile or parent/kid use cases. This is queued and `needs-discussion` in v1.9 already; this research is a data point in favor of not deprioritizing it, not a reason to change its design.

### R4 — Table for later: a free-tier trade-list-sharing feature, distinct from the vendor portal

Not urgent, but worth a future discussion thread (see §6) on whether "share a want/trade list with a link" belongs as a free collector feature rather than only living in the paid vendor-vision track.

## 8. GitHub issue actions taken

- **Commented on [#776](https://github.com/mgzwarrior/mgz-pkmn/issues/776)** ("Make the master-set toggle functional") with the TCG Codex `Variant`/`Quality`/`Collectible` reference design and a pointer to the new tracking issue below.
- **Filed a new issue**, "epic: card variant + condition data model (unblocks master-set completion)" — captures R1 above as a scoped, actionable epic, parented under the same `epic:library` track as #776/#501 since it directly unblocks that toggle.
- **Commented on [#765](https://github.com/mgzwarrior/mgz-pkmn/issues/765)** (kid profiles RFC) noting the competitive research found zero parent/kid surface anywhere in TCG Codex's product, as a data point supporting the existing plan rather than a reason to change it.

No other issues were changed. This doc itself is not yet committed to a branch/PR — see the wrap-up note in chat.

---

## Appendix: TCG Codex OpenAPI surface (reference)

Captured from the live inline spec at `tcgcodex.com/api` (v1, `openapi: 3.1.0`). 17 endpoints across 7 resource tags:

| Method | Path | Tag |
|---|---|---|
| GET | `/cards` | Card |
| GET | `/cards/{card}` | Card |
| GET | `/cards/{card}/prices` | Card |
| GET | `/cards/{card}/price-history` | Card |
| GET | `/cards/{card}/external-links` | Card |
| GET, POST | `/collectibles` | Collectible |
| PATCH, DELETE | `/collectibles/{collectible}` | Collectible |
| GET, POST | `/collections` | Collection |
| GET, PATCH, DELETE | `/collections/{collection}` | Collection |
| POST, DELETE | `/custom-list-items` | CustomListItem |
| GET | `/games`, `/games/{game}` | Game |
| GET | `/rarities`, `/rarities/{rarity}` | Rarity |
| GET | `/sets`, `/sets/{set}` | Set |
| GET, PATCH | `/me` | User |

Auth is a single bearer-token HTTP security scheme (no OAuth flows). The `/cards/{card}/prices` endpoint's own spec documents a 403 case with the message *"Access to card prices is restricted to Elite & Enterprise members only"* — confirming the paywall is enforced at the API layer, not just the UI.

Key schemas referenced throughout this doc: `CardResource` (card + nested set/game/rarity + per-game `metadata` union + `variants: string[]`), `Variant` (164-value enum, `pkmn_*`/`lor_*`/`mtg_*`/`optcg_*`/`swu_*` prefixed), `Quality` (`mt/nm/ex/vg/gd/lp/pl/po`), `Property` (`signed/graded/altered`), `CollectibleResource` (owned-copy record: card + collection + amount + quality + variant + language + properties + notes), `CardPriceResource` (per-variant price + `trend7`/`trend30` + `priced_at`), `SetResource` (`card_printed_total` vs. `card_total`).

A full local copy of the extracted spec (parsed from the page's inline `<script>` tag) was saved during this research to the session scratchpad for verification; it is not committed to the repo since it's third-party API documentation, not mgz-pkmn source.
