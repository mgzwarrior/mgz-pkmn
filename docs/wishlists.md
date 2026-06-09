# Wishlists

A **wishlist** is a user-named list of cards you're hunting — same shape as a [collection](collections.md) but with the opposite semantics ("I want these" vs "I own these"). Fourth slice of [ADR-0013](adr/0013-sqlite-persistence-for-runs-collections-wishlists.md). With this slice the ADR is fully implemented and [#57 (multi-user persistent collections)](https://github.com/mgzwarrior/mgz-pkmn/issues/57) closes.

Wishlist items carry one extra field that collection items don't: an optional `max_price` cap, the price at which you'd want to be alerted. The cap is persisted today but not wired to alerting yet — that's a separate feature to be filed when scoped.

## In the SPA

- **Add to a wishlist** — every matched row in the results table has a small heart icon next to the bookmark. Clicking it opens a picker listing your existing wishlists plus an inline "New wishlist…" form with an optional cap input. Picking one adds the card to it; the picker confirms with a checkmark, then closes.
- **Browse wishlists** — the header has a **Wishlists** chip that opens a modal listing every wishlist you've made, with each one's card count.

V1 stops at add + browse. Renaming, editing the cap on an existing item, drilling into items, and deleting are wired through the API and will land in follow-up iterations.

## API

All endpoints live under `/api/v1/wishlists` and operate on the sentinel `default` user until [#61 hosted-demo auth](https://github.com/mgzwarrior/mgz-pkmn/issues/61) lands. Bodies are JSON.

| Method | Path | What it does |
|-------|------|--------------|
| `GET` | `/wishlists` | List the user's wishlists (name, description, `item_count`, `created_at`). |
| `POST` | `/wishlists` | Create a new wishlist. Body: `{ "name": "...", "description": null }`. |
| `GET` | `/wishlists/{id}` | Full wishlist record including every item in `added_at` order. |
| `PATCH` | `/wishlists/{id}` | Rename or edit description. Omit a key to leave it untouched; pass `null` to clear. |
| `DELETE` | `/wishlists/{id}` | Drop the wishlist and cascade-delete its items. |
| `POST` | `/wishlists/{id}/items` | Add a card. Body: `{ "card": {...}, "notes": null, "max_price": null }`. `max_price` must be `>= 0` if provided. |
| `DELETE` | `/wishlists/{id}/items/{item_id}` | Remove one card from the wishlist. |

Missing wishlists / items return `404`. The two destructive endpoints return `204` on success. Negative `max_price` is rejected with `422`.

### Item response shape

Every item returned by `GET /wishlists/{id}` or `POST /wishlists/{id}/items` carries the verbatim `card_json` plus a set of **promoted card-identity fields** extracted at insert from the payload, matching the shape on `collection_items` so cross-surface queries (e.g. "is this card already chased *or* owned?") hit a single indexed shape. All promoted fields are nullable.

```json
{
  "id": 1,
  "card": { ... verbatim card_json ... },
  "notes": "near-mint",
  "max_price": 75.50,
  "added_at": "2026-06-09T12:34:56+00:00",
  "card_set_id": "swsh1",
  "card_number": "25",
  "card_name": "Charizard V",
  "card_rarity": "Ultra Rare",
  "card_types": ["Fire"],
  "card_image_url": "https://images.pokemontcg.io/swsh1/25.png",
  "price_snapshot": 18.50,
  "priced_at": "2026-06-09T12:34:56+00:00",
  "acquired_at": null,
  "acquired_collection_item_id": null
}
```

`acquired_at` + `acquired_collection_item_id` are non-null once the user has promoted the chase into a collection (see the wishlist → collection golden path in [#504](https://github.com/mgzwarrior/mgz-pkmn/issues/504)). The wishlist row is preserved as historical "I was chasing this and got it" rather than deleted. See [ADR-0025](adr/0025-collections-data-model-rework.md) for the design rationale.

## Schema

Two tables, both keyed on `user_id`:

| Table | Columns |
|-------|---------|
| `wishlists` | `id`, `user_id`, `name`, `description`, `created_at`, `target_date` |
| `wishlist_items` | `id`, `wishlist_id`, `card_json`, `notes`, `max_price`, `added_at`, `card_set_id`, `card_number`, `card_name`, `card_rarity`, `card_types_json`, `card_image_url`, `price_snapshot`, `priced_at`, `acquired_at`, `acquired_collection_item_id` |

`max_price` uses the same `Numeric(12, 2)` precision as `run_rows.market_price` so future alerting can join the two without type coercion. `card_json` carries the matched payload verbatim — same shape the lookup pipeline produces and the same shape collections use. The promoted card-identity columns are extracted at insert by `api/db/card_payload.py` (shared with `collection_items`) and indexed on `(card_set_id, card_number)`. `wishlists.target_date` is the optional "for the Allentown show on June 14" anchor — route plumbing rides [#504](https://github.com/mgzwarrior/mgz-pkmn/issues/504). `acquired_collection_item_id` is an FK to `collection_items.id` with `ON DELETE SET NULL` so deleting the resulting collection item doesn't cascade through and orphan the historical wishlist row.

## Out of scope (for now)

- **Price-drop alerting on `max_price`** — separate feature, file when scoped.
- **Sharing / exporting wishlists** — follow-up.
- **Multi-user identity** — every wishlist currently belongs to the sentinel `default` user; real per-user routing arrives with [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61).
