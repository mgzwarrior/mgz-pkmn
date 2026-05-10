# ADR 0004: On-disk response cache with mtime TTL + sticky URL overrides

- **Status:** Accepted
- **Date:** 2026-05-09
- **Tags:** cache, network, persistence

## Context

A single invocation against the example input list issues hundreds of
pokemontcg.io requests — every name search, every wildcard fallback,
every flavor-text retry. Without caching, iterating on input lists
spends the user's API quota (or worse, hits the unauthenticated rate
cap of 30 rpm) on requests that produced the same answer a minute ago.

PriceCharting URLs add another dimension: pasting one is a manual,
disambiguating act. Once the user has decided "this card maps to that
URL," they shouldn't have to keep pasting it on every future run.

## Decision

Two stores under `$XDG_CACHE_HOME/mgz-pkmn` (default
`~/.cache/mgz-pkmn`), backed by plain JSON files:

| Path | Holds | TTL |
|---|---|---|
| `api/<sha1>.json` | One file per pokemontcg.io request URL — keyed by SHA-1 of the URL. | 7 days, mtime-based. |
| `url_overrides.json` | `(name, set_hint)` → PriceCharting URL, recorded whenever a PC URL appears on a line. | None — sticky until overwritten or deleted. |

Behavior knobs at the CLI:

- `--no-cache` disables both reads and writes for the run (sets
  `MGZ_PKMN_NO_CACHE=1` internally so the shape is testable).
- `--clear-cache` wipes the API response cache before the run, then
  proceeds normally. URL overrides are preserved — they take real
  effort to set; API responses are regenerable.

## Consequences

- A cold run (~30s for the example input) becomes ~1s on a warm cache.
  Iterating on input formatting is essentially free.
- URL overrides turn one-time disambiguation into a permanent
  preference — paste a PC URL once, it works forever.
- The mtime TTL is intentionally simple: 7 days, no LRU eviction, no
  size cap. Mitigated by the fact that the cache stays small (a few MB
  after a typical run); a manual `rm -rf` is the escape hatch.
- Cache entries are pokemontcg.io-only. TCGdex and PriceCharting
  responses aren't cached — TCGdex because it's a fallback that fires
  rarely, PriceCharting because the URL itself is the cache key in
  effect (the user paid for the disambiguation).
- Schema changes to the cached response shape (new card field, updated
  language detector) require `--clear-cache` to discard stale data.
  Documented as the intended use case for that flag.

## Alternatives considered

- **No cache.** Burns API quota, slow iteration, makes `-v` log spam
  redundant on the second run.
- **In-memory cache only.** Doesn't survive across invocations. Pointless
  for a CLI that's typically launched fresh for each show-prep session.
- **SQLite.** Heavier dependency, queryable, supports LRU. Overkill for
  a few hundred request-keyed JSON blobs; the directory-of-files shape
  makes it trivial to inspect entries by hand.
- **HTTP-level cache (e.g. requests-cache).** Tighter integration with
  the requests library, but obscures the on-disk format and makes the
  override store harder to layer in.
