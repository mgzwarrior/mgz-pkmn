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

## Environment variables

| Variable | Effect |
|---|---|
| `MGZ_PKMN_NO_CACHE` | When set to a truthy value (anything other than empty, `0`, `false`, `False`), disables both the API response cache and URL-override lookups for the current process. Reads always miss; writes are no-ops; the on-disk cache is left untouched. The CLI's [`--no-cache`](cli.md#pkmn-lookup-options) flag sets this internally — set it directly when running the FastAPI service or invoking the library from another process where the flag isn't available. `--clear-cache` still wipes the API cache even when this is set; the explicit wipe wins over the implicit skip. |
| `XDG_CACHE_HOME` | Overrides the cache root. The store lives at `$XDG_CACHE_HOME/mgz-pkmn` when set, falling back to `~/.cache/mgz-pkmn` otherwise. Standard XDG semantics — no mgz-pkmn-specific behavior. |
