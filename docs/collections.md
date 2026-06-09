# Collections

A **collection** is a user-named bucket of cards you want to keep around across lookup runs — think "binder candidates", "Charizard masters", or "show pickups". It's the third slice of [ADR-0013](adr/0013-sqlite-persistence-for-runs-collections-wishlists.md): a flat list of matched cards pinned by their verbatim payload, so card identity survives even if the upstream source ([pokemontcg.io](https://pokemontcg.io) / TCGdex) renames or removes the row.

Collections live alongside runs (per-pipeline history) and [wishlists](wishlists.md) (the next slice — "I want these" instead of "I own these"). They don't change pricing or lookup behavior — they're just a place to remember matched cards you care about.

## In the SPA

- **Add to a collection** — every matched row in the results table has a small bookmark icon. Clicking it opens a picker listing your existing collections plus an inline "New collection…" form. Picking one adds the card to it; the picker confirms with a checkmark, then closes.
- **Browse collections** — the header has a **Collections** chip that opens a modal listing every collection you've made, with each one's card count.

The minimal V1 surface intentionally stops here. Renaming, editing notes, drilling into a collection's items, and deleting are wired through the API and will land in follow-up iterations.

## API

All endpoints live under `/api/v1/collections` and operate on the sentinel `default` user until [#61 hosted-demo auth](https://github.com/mgzwarrior/mgz-pkmn/issues/61) lands. Bodies are JSON.

| Method | Path | What it does |
|-------|------|--------------|
| `GET` | `/collections` | List the user's collections (name, description, `item_count`, `created_at`). |
| `POST` | `/collections` | Create a new collection. Body: `{ "name": "...", "description": null }`. |
| `GET` | `/collections/{id}` | Full collection record including every item in `added_at` order. |
| `PATCH` | `/collections/{id}` | Rename or edit description. Omit a key to leave it untouched; pass `null` to clear. |
| `DELETE` | `/collections/{id}` | Drop the collection and cascade-delete its items. |
| `POST` | `/collections/{id}/items` | Add a card. Body: `{ "card": {...}, "notes": null, "quantity": 1, "added_via": null }`. The `card` payload is the verbatim matched-card JSON from a lookup row. `quantity` defaults to `1` (must be `>= 1`); `added_via` is an optional provenance tag (`manual`, `wishlist_promote`, `haul`, `dynamic_match`, `swipe`) defaulting to `manual`. |
| `DELETE` | `/collections/{id}/items/{item_id}` | Remove one card from the collection. |

Missing collections / items return `404`. The two destructive endpoints return `204` on success. `quantity` of `0` is rejected with `422`.

### Item response shape

Every item returned by `GET /collections/{id}` or `POST /collections/{id}/items` carries the verbatim `card_json` plus a set of **promoted card-identity fields** extracted at insert from the payload so cross-collection queries and the insights dashboard don't have to scan JSON. All promoted fields are nullable — a malformed payload yields nulls and `card_json` stays the fallback source of truth.

```json
{
  "id": 1,
  "card": { ... verbatim card_json ... },
  "notes": "near-mint",
  "added_at": "2026-06-09T12:34:56+00:00",
  "quantity": 1,
  "card_set_id": "swsh1",
  "card_number": "25",
  "card_name": "Charizard V",
  "card_rarity": "Ultra Rare",
  "card_types": ["Fire"],
  "card_image_url": "https://images.pokemontcg.io/swsh1/25.png",
  "price_snapshot": 18.50,
  "priced_at": "2026-06-09T12:34:56+00:00",
  "added_via": "manual"
}
```

See [ADR-0025](adr/0025-collections-data-model-rework.md) for the design rationale.

## Schema

Two tables, both keyed on `user_id`, plus an append-only snapshot table for progress over time:

| Table | Columns |
|-------|---------|
| `collections` | `id`, `user_id`, `name`, `description`, `created_at`, `kind`, `source_set_id`, `rule_json` |
| `collection_items` | `id`, `collection_id`, `card_json`, `notes`, `added_at`, `quantity`, `card_set_id`, `card_number`, `card_name`, `card_rarity`, `card_types_json`, `card_image_url`, `price_snapshot`, `priced_at`, `added_via` |
| `collection_snapshots` | `id`, `collection_id`, `captured_at`, `unique_cards`, `total_quantity`, `est_value_cents`, `set_completion_pct`, `payload_json` |

`card_json` carries the matched payload verbatim — same shape the lookup pipeline produces. The promoted columns are extracted from it at insert by `api/db/card_payload.py` and indexed on `(card_set_id, card_number)` so cross-surface queries (ownership badges in search / browse / swipe, set-completion progress, value over time) stay cheap. `collections.kind` is one of `manual` (default), `set` (anchored to `source_set_id`), or `dynamic` (membership computed from `rule_json`); the set + dynamic kinds ride [#506](https://github.com/mgzwarrior/mgz-pkmn/issues/506). Wishlists mirror the same promoted-column shape plus the lifecycle plumbing (`acquired_at` + `acquired_collection_item_id`) for the wishlist → collection promote ([#504](https://github.com/mgzwarrior/mgz-pkmn/issues/504)).

## Out of scope (for now)

- **Sharing / exporting collections** — follow-up.
- **Multi-user identity** — every collection currently belongs to the sentinel `default` user; real per-user routing arrives with [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61).
- **Wishlist behavior** — separate surface ([wishlists.md](wishlists.md) / [#245](https://github.com/mgzwarrior/mgz-pkmn/issues/245)).
