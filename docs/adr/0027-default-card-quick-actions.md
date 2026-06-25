# ADR 0027: Default card quick actions for wanted and owned cards

- **Status:** Accepted
- **Date:** 2026-06-22
- **Tags:** web, product, collections, wishlists, binders

## Context

The library rethink in [#501](https://github.com/mgzwarrior/mgz-pkmn/issues/501)
settled on a lifecycle model: runs -> wishlists -> collections. ADR-0025
made that model concrete by keeping wishlists and collections as separate,
linked surfaces. Wishlists record cards a user is chasing; collections record
cards a user owns, with quantity and collection-specific metadata.

That distinction is still right, but the current web interaction asks too much
of the user at the moment they express intent. From search, browse, or swipe
surfaces, marking a card as wanted or owned can require choosing an existing
wishlist or collection, or creating one first. That turns "I like this" into an
organization task.

The product needs a lower-friction first action without reopening the
wishlists-vs-collections decision. Binders, collection purpose, named
wishlists, quantity, condition, trade piles, and show-specific organization are
valuable, but they should not block the basic act of saving intent.

## Decision

Adopt a default-target quick-action model:

- Every user has one default wishlist and one default personal collection.
- Card-level quick actions write to those defaults without requiring a picker
  or setup flow.
- The UI presents derived card state such as `Wanted` and `Owned`, but the
  canonical data remains `wishlist_items` and `collection_items`.
- Binders organize and present owned cards from collections. A binder is never
  required before a card can be owned. This sits alongside the existing
  set-based *target* collections ([#631](https://github.com/mgzwarrior/mgz-pkmn/issues/631)),
  whose `/chase` action seeds a wishlist with the cards you still need —
  targets drive chasing, binders present ownership, and neither is a gate in
  front of the quick action.
- Named wishlists, named collections, collection purpose, and binders remain
  available for later organization and power-user workflows.

The default rows should be ordinary wishlist and collection records, not a new
parallel storage model. Implementations may create them eagerly during user
provisioning or lazily on the first quick action, but writes must be idempotent
and deterministic for the acting user.

Default-row lifecycle: the default flag is the invariant, not the row. A user
may rename their default wishlist or collection freely and it stays the default.
Deleting a default is allowed, but the app immediately re-establishes one (the
next quick action recreates it lazily, or provisioning does), so a user is never
left without a write target. Promoting another list to default reassigns the
flag rather than duplicating storage.

The expected common-case UX is:

1. The user taps `Want`; the card is added to the default wishlist.
2. The user taps `Own` or `Add to collection`; the card is added to the
   default personal collection.
3. The UI confirms the new state immediately and offers a secondary path to
   organize, change target, add quantity, or move into a binder.

Wishlist -> collection promotion remains the lifecycle path. If a card already
exists in a wishlist and the user marks it owned, the app should preserve the
wishlist history by setting `acquired_at` and `acquired_collection_item_id`
when it can link the resulting collection item. A card may still be both wanted
and owned when the user intentionally keeps chasing another copy, variant, or
condition.

## Consequences

Positive:

- First-run users can save intent with one click or tap.
- Search, browse, and swipe flows can use the same simple actions.
- The data model stays aligned with ADR-0025: chasing and owning remain
  separate lifecycle surfaces, not a single polymorphic status flag.
- Binders become an organization and presentation layer instead of a gate in
  front of ownership.
- Multiple wishlists, collection purposes, and advanced binder organization can
  grow without burdening the common path.

Negative:

- The backend needs a reliable way to find or create each user's defaults.
- The default-row lifecycle rules above need clear UI affordances so a user
  understands that renaming keeps the default and deleting re-establishes one.
- Quick actions can hide the destination unless the UI gives clear feedback
  and a visible "organize" affordance.
- Duplicate ownership, quantity, and condition flows still need follow-up
  design; the quick action should not pretend those details do not exist.

Neutral but worth noting:

- This ADR does not require a new `card_status` table. Card status is a view
  model derived from promoted card identity across wishlist and collection
  item rows.
- A future migration may add explicit default markers or constraints to
  `wishlists` and `collections`, but that is an implementation detail as long
  as the one-default-per-user invariant is preserved.
- Existing named lists and collections remain valid. The quick-action defaults
  are a starting place, not the only place a card can live.

## Follow-up work

This ADR sets direction; the implementation is split into focused issues under
the library epic, tracked against the [#754](https://github.com/mgzwarrior/mgz-pkmn/issues/754)
RFC:

- [#759](https://github.com/mgzwarrior/mgz-pkmn/issues/759) — backend: provision
  a default wishlist and default collection per user, idempotently, with the
  one-default-per-user invariant and the lifecycle rules above.
- [#760](https://github.com/mgzwarrior/mgz-pkmn/issues/760) — API: card
  quick-action endpoints that write to the defaults and return derived
  `Wanted` / `Owned` state.
- [#761](https://github.com/mgzwarrior/mgz-pkmn/issues/761) — web: one-tap
  `Want` / `Own` quick actions on search, browse, and swipe.
- [#762](https://github.com/mgzwarrior/mgz-pkmn/issues/762) — web: the
  post-capture organize flow (change target, quantity, condition, move to a
  binder). This is the "smoother operating model" pass — the secondary organize
  step must stay light and optional so the old up-front friction never returns.

The primary want/own user journeys are also covered end-to-end by the Playwright
E2E epic ([#757](https://github.com/mgzwarrior/mgz-pkmn/issues/757)) so these
flows stay green across the SPA and API.

## Alternatives considered

- **Always show a list/collection picker.** This preserves explicit targeting,
  but it keeps the current friction in the highest-frequency interaction.
- **Remember the last selected target only.** This helps returning power users
  but still leaves first-run users with setup friction and unclear behavior
  when no prior target exists.
- **Make card-level `wanted` / `owned` status canonical.** This matches the
  surface interaction, but it conflicts with ADR-0025 by flattening chasing and
  owning into a shared state model. It would also force list and collection
  behavior to be reconstructed around the flag later.
- **Require binders before collection.** This makes physical organization feel
  concrete, but it makes ownership depend on a presentation choice. Binders are
  better treated as organization after capture.
