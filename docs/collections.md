# Collections

A **collection** is a user-named bucket of cards you want to keep around across lookup runs — think "binder candidates", "Charizard masters", or "show pickups". It's the third slice of [ADR-0013](adr/0013-sqlite-persistence-for-runs-collections-wishlists.md): a flat list of matched cards pinned by their verbatim payload, so card identity survives even if the upstream source ([pokemontcg.io](https://pokemontcg.io) / TCGdex) renames or removes the row.

Collections live alongside runs (per-pipeline history) and wishlists (next slice). They don't change pricing or lookup behavior — they're just a place to remember matched cards you care about.

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
| `POST` | `/collections/{id}/items` | Add a card. Body: `{ "card": {...}, "notes": null }`. The `card` payload is the verbatim matched-card JSON from a lookup row. |
| `DELETE` | `/collections/{id}/items/{item_id}` | Remove one card from the collection. |

Missing collections / items return `404`. The two destructive endpoints return `204` on success.

## Schema

Two tables, both keyed on `user_id`:

| Table | Columns |
|-------|---------|
| `collections` | `id`, `user_id`, `name`, `description`, `created_at` |
| `collection_items` | `id`, `collection_id`, `card_json`, `notes`, `added_at` |

`card_json` carries the matched payload verbatim — same shape the lookup pipeline produces. The next slice ([wishlists](https://github.com/mgzwarrior/mgz-pkmn/issues/245)) mirrors this shape with an extra `max_price` column for alert thresholds; sharing a polymorphic `lists` table buys nothing per ADR-0013.

## Out of scope (for now)

- **Sharing / exporting collections** — follow-up.
- **Multi-user identity** — every collection currently belongs to the sentinel `default` user; real per-user routing arrives with [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61).
- **Wishlist behavior** — separate slice ([#245](https://github.com/mgzwarrior/mgz-pkmn/issues/245)).
