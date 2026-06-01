# ADR 0018: split lookup cache into structural + volatile slices with stale-while-revalidate on pricing

- **Status:** Accepted
- **Date:** 2026-06-01
- **Tags:** cache, lookup, performance, ADR

## Context

mgz-pkmn's lookup cache stores card payloads from `pokemontcg.io` as
one JSON blob per upstream URL, hashed to `cache/api/<sha1>.json`. A
single 7-day mtime-based TTL governs the whole blob. Each cached card
carries both structural fields (name, set, number, rarity, attacks,
images) and volatile pricing fields (`tcgplayer.prices`,
`cardmarket.prices`) side-by-side.

The pre-Scrydex catalog-warm epic ([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368))
landed Phases 1 + 2 ([#370](https://github.com/mgzwarrior/mgz-pkmn/issues/370),
[#371](https://github.com/mgzwarrior/mgz-pkmn/issues/371)): a runtime
warm pass pre-populates the cache across the entire English catalog.
But under the existing single-TTL model, those entries still expire
every 7 days and re-fetch as if they were volatile — wasting Scrydex
credits (after the eventual cutover in Phase 4) re-fetching fields
that haven't changed since the card was printed.

A second pain point: there's no observable signal for *whether* a
given request hit the cache. The lookup timer ([#297](https://github.com/mgzwarrior/mgz-pkmn/issues/297))
reports user-felt latency, but a 200 ms response could equally be a
warm-cache hit or a fast network day.

This ADR records the architectural shift that resolves both issues.

## Decision

Split the lookup cache by **freshness semantics**, not by source:

- **Structural slice** (`cache/api_structural/<sha1>.json`) carries
  every card field except the four price-y keys
  (`tcgplayer`, `cardmarket`, `_pc_prices`, `_pc_url`). **No TTL.**
  Reads return regardless of mtime. Cards don't change once printed.
- **Pricing slice** (`cache/api_pricing/<sha1>.json`) carries those
  four keys plus the card `id` for re-merge. **24 h mtime-based TTL.**
  Past the TTL, reads return the stale value and a background daemon
  thread re-fetches the upstream URL to write a fresh pricing slice.
  This is **stale-while-revalidate** (SWR).

The split lives in `src/mgz_pkmn/cache.py` (the JSON blob store
already knows about other payload shapes — `_extract_overrides`,
the warm manifests). Producers (`TCGClient._fetch_page`,
`warm_cards`) call new functions: `read_api_split(key) → (cards,
status)` and `write_api_split(key, cards)`. The status is one of
`HIT` / `STALE` / `MISS` and threads up through `MatchResult` /
`find_card` / `_do_lookup` to an **`X-Cache`** response header on
`/api/v1/lookup`.

SWR coalescing uses a module-level `set[str]` of in-flight keys
guarded by a single `threading.Lock`. The first concurrent stale
read on a key adds it to the set and spawns a daemon refresh thread;
subsequent stale reads see the key already in-flight and skip
spawning. The thread always discards the key on exit via `finally`.

Legacy `cache/api/<sha1>.json` entries are migrated **lazily and
eagerly** on first read: parse the legacy JSON, split each card,
write both new files atomically, preserve the pricing file's mtime
via `os.utime` (so a 9-day-old legacy entry stays correctly STALE
after migration), unlink the legacy file. One extra read+write per
legacy key, amortized once per machine.

## Consequences

### Positive

- **Structural reads serve from disk forever.** Phase 1/2 warm
  passes are no longer wasted on the 7-day TTL clock — once a card
  ships, its non-price metadata never re-fetches.
- **Upstream traffic collapses to the price-refresh cadence Scrydex
  actually expects** (Phase 4, [#351](https://github.com/mgzwarrior/mgz-pkmn/issues/351)).
  The 24 h pricing TTL is the only thing that drives upstream calls
  on a warmed catalog.
- **`X-Cache` header gives an observable signal** so operators and
  contributors can tell cache hits from upstream fetches without
  guessing from the timer. Closes the backend half of
  [#310](https://github.com/mgzwarrior/mgz-pkmn/issues/310).
- **SWR keeps user-facing latency tight** — stale pricing returns
  immediately rather than blocking on a fresh upstream fetch. The
  next request after the refresh lands sees the new value.
- **Lazy migration preserves on-disk pricing.** Legacy entries land
  in the split form on first read without throwing away the price
  data that was already cached, and without forcing a network call.

### Negative

- **Two files instead of one** per cached entry doubles directory
  entries (still well below filesystem limits for the catalog
  scale). Stat-only `pkmn cache stats` cost scales linearly with
  entry count regardless.
- **Refresh starvation** is possible: if pricing keeps failing to
  refetch (flaky upstream), every stale read spawns a new thread,
  each fails, the key stays STALE forever. The current design
  accepts this; a 5-minute negative-cache marker
  (`_recent_refresh_failures`) is documented as a follow-up if it
  materializes in practice.
- **Multi-process refresh coalescing isn't attempted.** Two CLI
  invocations on the same key can both decide it's STALE and both
  spawn a refresh. Atomic rename keeps files uncorrupted; we
  tolerate at most 2× upstream cost for the affected key. A
  file-lock would add complexity disproportionate to the win.
- **Counter semantics drift slightly.** Pre-split, `_api_fetches`
  meant "one successful upstream fetch = one write". The split
  writes two files per fetch, so we keep `_api_fetches` at one bump
  per `write_api_split` call. Background refreshes go into a new
  pair `pricing_counters()` instead.

### Neutral

- **`/api/v1/sets/{set_id}/cards` and the SSE `/bulk` route** keep
  using `read_api` / `write_api` against the legacy `cache/api/`
  directory for now. Migrating them to the split form (plus
  surfacing `X-Cache` on those endpoints and rendering an SPA chip)
  is the [#310](https://github.com/mgzwarrior/mgz-pkmn/issues/310)
  follow-up.
- **TCGdex / PriceCharting clients** stay in-memory-only. Pricing
  on those sources isn't durable across runs today; adding disk
  persistence + SWR there is its own issue.

## Alternatives considered

- **Schema-level split inside the client layer.** Put `_split_card`
  inside `TCGClient._fetch_page` rather than `cache.py`. Rejected
  because multiple producers (`warm_cards`, future Phase 4 client)
  would duplicate the split rule. The schema-bound logic belongs
  beside the other format helpers in `cache.py`.
- **`ContextVar` / `threading.local` for the cache-status signal.**
  Rejected as too implicit. `run_in_threadpool` does propagate
  `ContextVar` on recent Starlette, but reasoning about a hidden
  global through an async/threadpool boundary is harder than just
  returning a tuple. The explicit return value also makes the
  signal trivially testable.
- **Per-key `dict[str, threading.Lock]` for SWR coalescing.**
  Rejected — adds cleanup complexity (when does a lock get
  removed?) and solves nothing the single-set-plus-Lock model
  doesn't. The thing we want to coalesce is *spawning the thread*,
  not *running it*, and a `set.add` under a held lock is
  nanoseconds.
- **Eager migration on startup.** Rejected — would force a
  potentially long-running scan during deploy lifespan, and the
  lazy path already amortizes the cost to one extra read+write
  per legacy key on the first hit.
