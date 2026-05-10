# ADR 0008: Two-pass stable sort for compound row ordering

- **Status:** Accepted
- **Date:** 2026-05-09
- **Tags:** sorting, algorithms

## Context

`--sort` accepts six modes: `number` (default), `number-desc`,
`price-asc`, `price-desc`, `release-date`, `alpha`. Whatever mode the
user picks, the output has to also satisfy two structural invariants:

1. **Tag is the outermost group.** The binder paginates per-tag, the
   spreadsheet groups by Source column, and the checklist is
   per-section-per-tag. Tag order must be preserved (first-appearance
   wins) regardless of the inner sort.
2. **Matched rows precede unmatched rows within each tag.** Unmatched
   lines have no card / price data; they sink to the bottom of their
   group.

Single-tuple sort keys can express asc-mode compound orderings cleanly
(e.g., `key = (tag_rank, number_key)`). They get awkward when the
inner direction is *descending* — Python's `sorted(reverse=True)`
inverts the *whole* tuple, including the outer tag rank, which would
re-order tags. Negating numeric inner fields manually works for
`price-desc` but doesn't generalize to `number-desc` where the inner
key has alphanumeric components (`SWSH286`, `TG01`) that aren't
trivially negatable.

## Decision

Use a two-pass stable sort in
[`src/mgz_pkmn/sorting.py`](../../src/mgz_pkmn/sorting.py):

1. **Pass 1:** sort by the inner mode key alone (potentially with
   `reverse=True` for the desc modes).
2. **Pass 2:** stable-sort by `(tag_rank, has_card)`. Because Python's
   `list.sort()` is stable, equal `(tag_rank, has_card)` keys preserve
   the relative order from pass 1 — yielding the desired compound
   ordering with mixed asc/desc directions.

For modes where everything is asc (`number`, `release-date`, `alpha`,
`price-asc`), the two passes could collapse to one, but we run both
unconditionally for uniformity. The cost is negligible (`list.sort()`
on already-mostly-sorted data is O(n)).

## Consequences

- All six sort modes share one shape. The implementation has six
  small `if mode == "X"` branches, each setting up the pass-1 key,
  followed by one universal pass-2 sort.
- Mixed asc/desc compound orderings work correctly without inventing
  inverted compare keys for alphanumeric strings.
- Tag grouping and matched-vs-unmatched grouping are guaranteed by
  pass 2, so individual mode branches don't have to remember to
  include them in their key.
- New modes are localized to a single `if mode == ...` branch in the
  pass-1 dispatch. The invariants are enforced by pass 2.
- The two-pass approach is a tiny constant factor slower than a
  one-pass tuple sort. Not a problem at our row counts; would matter
  at millions of rows.

## Alternatives considered

- **Single tuple sort with negation tricks.** Workable for purely
  numeric inner keys, but `number-desc` mixes integers and arbitrary
  strings (alphanumeric card numbers). String negation isn't
  expressible cleanly, and even with codepoint negation the pattern
  becomes opaque.
- **Custom comparator with `functools.cmp_to_key`.** Conceptually
  flexible, but Python comparators are slow and harder to maintain
  than tuple keys. The two-pass approach is simpler to understand
  and verify.
- **Per-mode bespoke sort functions.** Six separate functions, each
  re-deriving tag rank and grouping. Lots of duplication; the
  invariants would inevitably drift between modes.
