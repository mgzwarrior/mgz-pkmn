# ADR 0029: Sealed items as parallel tables, condition as per-copy rows

- **Status:** Accepted
- **Date:** 2026-07-07
- **Tags:** data, collections, wishlists, sealed-product, grading

## Context

Every layer of the persistence model is card-shaped: `collection_items` / `wishlist_items` store a verbatim `card_json` plus promoted `(card_set_id, card_number)` identity, and pricing extraction reads per-variant TCGPlayer/Cardmarket blocks. A booster box or elite trainer box has no card number, no rarity, and no per-variant price — it doesn't fit that shape, and today it can only be awkwardly coerced into a card row (`number: None`) via the PriceCharting URL path.

Separately, [ADR-0025](0025-collections-data-model-rework.md) deliberately deferred per-condition quantity (NM/LP/MP/HP/DM) rather than bolting a `condition` column onto `collection_items`: *"Deferred to a future child as a separate `collection_item_copies` table."* The sealed-product epic ([#881](https://github.com/mgzwarrior/mgz-pkmn/issues/881)) is the moment both land together, because sealed product needs condition semantics (sealed/opened/resealed/damaged) from day one and grading (PSA/BGS/CGC/SGC slabs) applies to cards and sealed product alike.

## Decision

Three linked schema decisions, shipped as one migration ([#882](https://github.com/mgzwarrior/mgz-pkmn/issues/882)) so the parallel-table symmetry can't drift between PRs:

**Sealed product rides parallel tables, not a polymorphic `kind` column.** `collection_sealed_items` and `wishlist_sealed_items` mirror the card-item pattern — verbatim `product_json` as source of truth plus promoted identity columns (`product_set_id`, `product_name`, `product_type`, `product_language`, `product_image_url`) — inside the existing `collections` / `wishlists` containers. `product_type` draws from a small vocabulary (`booster-pack`, `booster-box`, `elite-trainer-box`, `tin`, `blister`, `bundle`, `collection-box`, `other`) validated at the API layer. There is no sealed-product catalog table: like cards, identity is captured per-item from whatever source resolved it (PriceCharting scrape or manual entry).

**Condition is a per-copy breakdown, not a column on the item row.** `collection_item_copies` / `collection_sealed_item_copies` let a stack of 3 copies be 2 raw-NM + 1 PSA 9 — something a single column can't represent. A copies row carries `quantity`, `condition` (card vocabulary NM/LP/MP/HP/DM; sealed vocabulary sealed/opened/resealed/damaged), shared grading fields (`grading_company`, `grade`, `cert_number` — null company means raw), and a copy-level `price_snapshot`/`priced_at` because a slab prices differently from its raw siblings. Copies are opt-in detail: an item with no copies rows just uses its aggregate `quantity`, and copies are not required to sum to it.

**Wishlists get target columns, not copies.** You don't own physical copies of a chase target, so `wishlist_items` and `wishlist_sealed_items` get nullable `target_condition` / `target_grading_company` / `target_min_grade` instead — null means "any condition".

## Consequences

- Positive: the epic's API/web/export children (#883–#888) build on a stable schema; cards and sealed stay queryable with symmetric promoted columns and no discriminator; existing card rows and API responses are untouched (everything is additive).
- Negative: two more table pairs to keep symmetric — the same foot-gun ADR-0025 flagged for wishlists/collections, now doubled. Mitigated by shipping the whole surface in one migration and keeping the extractor (`api/db/product_payload.py`) as the single place that knows the payload shape.
- Negative: aggregate `quantity` and copies rows can disagree; consumers must treat copies as detail, not the count of record.
- Neutral: binder pockets, dynamic rules, set-completion, and Swipe/Browse deliberately exclude sealed product in v1 (see #881's anti-goals).

## Alternatives considered

- **Polymorphic `kind` column on `collection_items`** — rejected for the same reason ADR-0025 kept wishlists and collections apart: cards and sealed product have different semantics, lifespans, and consumers, and a discriminator turns every card query into a filtered one.
- **`condition` column on the item row** — can't represent mixed stacks (2 NM + 1 PSA 9); ADR-0025 already rejected it prospectively.
- **Copies on wishlist items too** — a chase target has no physical copies; target columns express intent ("PSA 9 or better") more directly.
- **Sealed-product catalog table** — no free structured sealed-product API exists (pokemontcg.io / TCGdex are cards-only), so a catalog would be hand-maintained; per-item capture matches how cards already work.
