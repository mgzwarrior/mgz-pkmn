# ADR 0025: Collections data model rework — separate-but-linked wishlists, promoted card identity, lifecycle as data, first-class snapshots

- **Status:** Accepted
- **Date:** 2026-06-09
- **Tags:** persistence, api, web, schema, collections

## Context

[ADR-0013](0013-sqlite-persistence-for-runs-collections-wishlists.md) landed the original `collections`, `collection_items`, `wishlists`, and `wishlist_items` tables. The premise — durable per-user buckets of cards, identified by the verbatim matched payload (`card_json`) — has held up. The shape it landed in has not.

The RFC in [#501](https://github.com/mgzwarrior/mgz-pkmn/issues/501) gathered seven downstream feature asks that all hit the same schema in different ways:

- **Have-vs-chasing as first-class state on a card** (#505).
- **Wishlist → collection golden path** (#504).
- **Static (set-based) vs dynamic (rule-based) collections** (#506).
- **Binder presentation** with progress tracking over time (#503, #508).
- **Cross-collection ownership badges** on search / browse / swipe (#576).
- **Library-aware swipe exclusion** (#581).
- **Aggregate insights dashboard** (#575).

Each of those, attempted in isolation, was either blocked by `card_json` being an opaque JSON blob or kept tripping over the wishlist/collection semantic boundary. Two crosscutting issues surfaced:

1. **Where does "chasing" live?** As a `status` flag on a collection card? On the wishlist row? As a separate "intent" table? Each child issue re-litigated this.
2. **What gets queried, and how?** Every interesting cross-surface feature (ownership badge, set completion, value over time, "show me cards I already own") needs to filter or join on card identity. Today every one of those requires a JSON scan over `card_json` because `set.id` and `number` live inside the blob.

The user's mental model, which this rework adopts: **runs → wishlists → collections** is a lifecycle, not a polymorphism. Runs are iterative search work. Wishlists are the goal-oriented "I'm chasing these for the show" list. Collections are durable inventory with vendor multiples. Each is its own surface with its own bones.

Constraints worth naming:

- **SQLite first** (per ADR-0013). Migrations must be batch-mode compatible. JSON columns are allowed but indexed-column queries beat them on every dimension that matters here.
- **`card_json` stays as source of truth** for the long tail of payload fields. Source-side drift (pokemontcg.io, TCGdex) must not force a migration. The rework is additive — we promote a small, stable subset of card-identity fields into typed columns and keep the rest in JSON.
- **Backwards compatible at the API surface.** Existing callers must not break; new fields land as additive response elements with safe defaults.

## Decision

Land one foundational migration (`c01ec71011a7`, child issue #574) that makes four structural changes:

1. **Keep wishlists and collections as separate tables**, with explicit lifecycle plumbing between them. A wishlist `acquired_at` timestamp + `acquired_collection_item_id` FK records the wishlist → collection transition without flattening either surface.
2. **Promote a small set of card-identity columns** out of `card_json` onto both `collection_items` and `wishlist_items`: `card_set_id`, `card_number`, `card_name`, `card_rarity`, `card_types_json`, `card_image_url`, `price_snapshot`, `priced_at`. Indexed on `(card_set_id, card_number)`. Extracted at insert by a single shared helper (`api/db/card_payload.py`).
3. **Add `quantity` + `added_via`** to `collection_items` — vendor multiples and provenance. `collections.kind` (manual / set / dynamic) + nullable `source_set_id` and `rule_json` create the schema shape that set-based (#506) and dynamic collections (#506) ride on without further migration.
4. **Introduce `collection_snapshots`** as a first-class append-only table — `(collection_id, captured_at, unique_cards, total_quantity, est_value_cents, set_completion_pct, payload_json)`. Backs progress-over-time (#508) and the aggregate insights dashboard (#575).

Existing rows are backfilled by the migration itself, reading each `card_json` through the same extractor the routes use. Price snapshot is deliberately left null on backfill — we have no trustworthy historical price for those rows and emitting a wrong number would poison the value-over-time chart.

This ADR amends ADR-0013 — it does not supersede it. The persistence premise (SQLite, Alembic, per-user FK on every table, opaque `card_json` as source of truth) is unchanged. The shape of two of its tables is broadened.

## Consequences

### Positive

- **Cross-surface features become real SQL.** Cross-collection ownership badges (#576), library-aware swipe exclusion (#581), set-completion progress (#508), per-rarity/per-type insights (#575), and the "cards you're chasing that you already own" check are all single indexed queries on `(card_set_id, card_number)` instead of `card_json` scans.
- **Lifecycle is data, not flag.** `acquired_at` + `acquired_collection_item_id` records both *when* a chase completed and *which* collection item it became. The wishlist row stays as historical "I was hunting this and got it." Future "wishlist retrospective" UIs come for free.
- **`kind` + `source_set_id` + `rule_json` foreclose a second migration** for the set-based and dynamic-collection children (#506). The columns exist now, nullable, with `kind='manual'` as the safe default; the route surface lights up when those children land.
- **`quantity` separates vendor multiples from condition (NM/LP/MP/HP/DM)** — explicit decision to model condition as a future per-copy breakdown rather than collapsing it into `quantity` now.
- **Snapshots as a table, not a recomputation.** Every chart on the insights dashboard either reads from it or appends to it; the dashboard PR can be a frontend slice instead of carrying a snapshot scheme.

### Negative

- **Denormalization invites drift.** The promoted columns are derived from `card_json`; if `card_json` is updated in place (today nothing does this), the columns won't follow. Mitigation: `card_json` is treated as immutable at the row level. Re-extraction is a single helper call away if that ever changes.
- **The extractor is the new shared assumption.** Every payload shape we want to support must round-trip through `api/db/card_payload.py`. A pokemontcg.io shape drift is now a one-file change with one test file, but it *is* a required change.
- **Two item-table shapes to keep symmetric.** `collection_items` and `wishlist_items` share the promoted-column shape so cross-surface queries can ignore which table a card sits in. Adding a column to one without the other is a footgun a reviewer has to catch.

### Neutral but worth noting

- The original "have-vs-chasing as a flag on a collection card" framing (#505) is closed and folded into #504 — the lifecycle is the transition, not a status field.
- The migration's backfill runs inside the upgrade itself rather than as a separate script. SQLite tolerates this at the table sizes we're at; if a future deployment is large enough that an in-migration `UPDATE` over every row is a concern, the backfill can be split into a deferred job without changing the schema.
- `collection_snapshots` has no writer in this slice. The writer (item-mutation hook + nightly cron) is a follow-up child; the table exists now so the dashboard slice doesn't need a migration.

## Alternatives considered

- **Unify wishlists and collections under one table with a `kind` enum.** Would make the lifecycle a status flip and the wishlist→collection promote a single `UPDATE`. Rejected: the two surfaces have different semantics (chasing vs owning), different lifespans (finite vs durable), different cardinalities (one vs many copies), and different downstream consumers. A `kind` column would have to fan back out into per-kind validation everywhere a query touches it, paying twice for what shared bones nominally save.
- **Status flag on `collection_items` instead of separate wishlist surface.** Same problem in reverse — would conflate "I want this" with "I have this" at the data layer and force every reader to filter on status. Also breaks the user's actual mental model (chasing isn't a sub-mode of owning).
- **Materialize dynamic-collection membership as `collection_items` rows.** Rejected for #506: rule-based membership recomputes from upstream catalog state; materializing it means every catalog change forces a backfill or risks staleness. Lazy evaluation against the indexed promoted columns is cheap.
- **Per-condition quantity (NM/LP/MP/HP/DM) inline on `collection_items`.** Rejected for v1: collapses too much detail into the row and pre-commits to a condition vocabulary. Deferred to a future child as a separate `collection_item_copies` table or column-set; today's `quantity` is raw count.
- **Defer snapshots until the dashboard ships.** Rejected: snapshots are append-only and cheap, and putting the table in the foundation migration means the dashboard PR is purely frontend + read queries. The marginal cost of adding the table now is one table; the cost of *not* having it is splitting the dashboard into two PRs.
