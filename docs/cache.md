# Cache

The CLI keeps a small disk cache under `$XDG_CACHE_HOME/mgz-pkmn`
(`~/.cache/mgz-pkmn` by default) so consecutive runs over the same card
list don't keep re-spending API quota. Two stores live there:

| Path | What it holds | TTL |
|---|---|---|
| `api/<sha1>.json` | One file per pokemontcg.io request URL. | 7 days (mtime-based). |
| `url_overrides.json` | `(name, set_hint)` → PriceCharting URL, recorded whenever you paste a PC URL on a line. | None — sticky until you overwrite or delete. |

## Behavior

- **API responses** are cached after every successful HTTP 200
  (including empty result lists) and consulted before each network
  fetch. A cold run (~30 s for the sample input) becomes ~1 s on a
  warm cache. With `-v` the log shows `cached <url>` for hits and
  `GET <url>` for misses.
- **URL overrides** turn one-shot manual lookups into permanent ones.
  Paste a PriceCharting URL on a line once; on the next run, drop the
  URL and the card still resolves via PriceCharting (matched on
  `(name, set)`, case-insensitive). Lookups happen between the
  explicit-URL path and the pokemontcg.io path so a saved override
  behaves exactly like a re-pasted URL would.
- **`--no-cache`** disables both stores for the run (sets
  `MGZ_PKMN_NO_CACHE=1` internally — see [Environment variables](#environment-variables)).
  Reads miss, writes are no-ops; the on-disk cache is unchanged. Use it
  for an ephemeral clean run that shouldn't pollute or refresh the cache.
- **`--clear-cache`** wipes the API response cache *before* the run,
  then proceeds normally so fresh data is fetched and re-cached. URL
  overrides are preserved (they take real effort to set; API responses
  are regenerable). Use this after a normalizer/schema change in the
  code (a new card field, an updated language detector) when stale
  cached payloads no longer reflect what the code expects.
- **Manual nuke** — `rm -rf ~/.cache/mgz-pkmn` removes everything
  including URL overrides. There's no LRU eviction; the cache stays
  small (a few MB after a typical run).
- **Soft-warn at startup** — `pkmn lookup` stats the cache directory
  at run start and prints a yellow `⚠` to stderr if total size exceeds
  50 MB. The threshold is overridable via
  [`MGZ_PKMN_CACHE_WARN_BYTES`](#environment-variables); set it to `0`
  to silence the warning entirely. The check is stat-only (no payload
  reads) so it adds negligible startup cost.

## Inspecting the cache

`pkmn cache path` prints the cache root as a single bare line for shell
composition:

```bash
cd "$(pkmn cache path)"
du -sh "$(pkmn cache path)"
```

`pkmn cache stats` prints a one-screen summary of on-disk usage —
useful for spotting a runaway cache or a stale `url_overrides.json`
without `du`-ing the directory by hand.

```text
▸ Cache stats
  Location:      /Users/you/.cache/mgz-pkmn
  Total size:    8.8 MB
  API responses: 175 entries · 8.8 MB · oldest 5d ago
  URL overrides: 20 entries · 2.2 KB
```

The command reports on-disk state directly, so it runs even when
`MGZ_PKMN_NO_CACHE=1` is set — the disable flag suppresses reads and
writes during normal lookups, but inspecting real files should still
show what's there. Combine with [`--clear-cache`](#behavior) on the next
`pkmn lookup` if the API cache has grown stale relative to the code.

`pkmn cache clear` wipes the API response cache without forcing you to
run a lookup. URL overrides and the indefinite-TTL image cache are left
in place — the same trade-off the in-line `--clear-cache` flag makes:

```text
▸ Clearing API response cache
  ✓ 175 entries cleared · 8.8 MB freed (overrides + images preserved)
```

The command runs even when `MGZ_PKMN_NO_CACHE=1` is set — the explicit
wipe wins over the implicit skip, same as
[`--clear-cache`](#behavior). There's no confirmation prompt: the wipe
is recoverable (the next lookup re-fetches) and a prompt would
complicate scripted use. Wipe images explicitly with
`rm -rf "$(pkmn cache path)/images"` when you want to evict warmed
artwork too.

Use `pkmn cache stats --json` for scripts and monitoring. It emits the
same snapshot with snake_case keys:

```json
{
  "root": "/Users/you/.cache/mgz-pkmn",
  "api_entry_count": 175,
  "api_bytes": 9227468,
  "api_oldest_mtime": 1789400000.0,
  "override_count": 20,
  "override_bytes": 2253
}
```

## Warm passes

Four CLI commands pre-populate slices of the cache so first-use lookups
land on a warm disk instead of paying upstream latency:

| Command | What it warms | Manifest | Stale window |
|---|---|---|---|
| `pkmn cache warm-concepts` | Concept-name → card-id lookups (~200 names) | `concept_warm.json` | 24 h |
| `pkmn cache warm-set-cards` | Per-set card-list JSON for every set | `set_cards_warm.json` | 7 d |
| `pkmn cache warm-sets` | Set logo + symbol images | `sets_warm.json` | 7 d |
| `pkmn cache warm-cards` | Full per-card structural payload (~18,000 cards) | `card_warm.json` | 7 d |
| `pkmn cache warm-card-images` | `large` + `small` image bytes for every English card (~40,000 files / ~17 GB) | `card_images_warm.json` | 7 d |

Each manifest records `timestamp` + a count of what was warmed; the
freshness gate (`*_warm_is_fresh()`) reads it to skip a re-walk when a
recent pass is still within the staleness window. The on-startup
bootstrap in [`api/main.py`](../api/main.py) fires the first three when
`MGZ_PKMN_WARM_ON_STARTUP=1`. The per-card warm has its own opt-in
(`MGZ_PKMN_WARM_CARDS_ON_STARTUP=1`) because it's heavier — a fresh
pass writes one cache entry per card across the full English catalog.
The per-card *image* warm has yet another opt-in
(`MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP=1`) because it's the heaviest of
the four — a completed pass on the deployed instance reports
`card-images warm complete: 40088 images warmed (17904440414 bytes)
across 173 sets`, so plan disk size and first-deploy duration
accordingly. Subsequent boots within the 1-week freshness window skip
the re-walk.

`warm-cards` is Phase 1 of the pre-Scrydex catalog-warm epic
([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)). Reuses the
data each set's `search_all` already returns — zero extra HTTP calls
vs `warm-set-cards`, just one extra disk entry per card so the lookup
path can resolve directly by card-id once the Phase 3 refactor
([#372](https://github.com/mgzwarrior/mgz-pkmn/issues/372)) wires it in.

```bash
# Full English-catalog warm; ~18k entries written, throttled politely.
pkmn cache warm-cards --throttle-ms 250

# Stage a single new set after a release.
pkmn cache warm-cards --set sv11 -v

# Bound a partial run on a tight upstream budget.
pkmn cache warm-cards --max-cards 1000
```

## Environment variables

| Variable | Effect |
|---|---|
| `MGZ_PKMN_NO_CACHE` | When set to a truthy value (anything other than empty, `0`, `false`, `False`), disables both the API response cache and URL-override lookups for the current process. Reads always miss; writes are no-ops; the on-disk cache is left untouched. The CLI's [`--no-cache`](cli.md#pkmn-lookup-options) flag sets this internally — set it directly when running the FastAPI service or invoking the library from another process where the flag isn't available. `--clear-cache` still wipes the API cache even when this is set; the explicit wipe wins over the implicit skip. |
| `MGZ_PKMN_CACHE_WARN_BYTES` | Integer byte count for the cache-size soft-warn threshold checked at `pkmn lookup` startup. Defaults to `52428800` (50 MB). Set to `0` (or any non-positive value) to disable the warning entirely. Unparseable values fall back to the default. |
| `MGZ_PKMN_WARM_ON_STARTUP` | Truthy (`1`, `true`, `True`) enables the runtime warm bootstrap in the FastAPI lifespan for the concept, set-cards, and sets slices. Each slice is gated by its own freshness manifest so containers starting within the staleness window skip the re-walk. Set in `render.yaml` by default on the deployed instance. |
| `MGZ_PKMN_WARM_CARDS_ON_STARTUP` | Truthy enables the runtime per-card warm bootstrap. Independent env var because the per-card pass is heavyweight (~18,000 cache entries on a fresh disk), but with the persistent disk in place a single first pass after deploy serves every subsequent deploy via the 1-week `card_warm.json` freshness gate. Also set in `render.yaml` by default. |
| `MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP` | Truthy enables the runtime per-card *image* warm bootstrap (Phase 2 of [#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)). Heaviest of the warm slices — a completed pass on the deployed instance lands ~40,000 image files / ~17 GB across ~170 sets, so it ships on its own env var (not the umbrella `MGZ_PKMN_WARM_ON_STARTUP`) and a separate `card_images_warm.json` freshness gate. Set in `render.yaml` by default. |
| `XDG_CACHE_HOME` | Overrides the cache root. The store lives at `$XDG_CACHE_HOME/mgz-pkmn` when set, falling back to `~/.cache/mgz-pkmn` otherwise. Standard XDG semantics — no mgz-pkmn-specific behavior. |
