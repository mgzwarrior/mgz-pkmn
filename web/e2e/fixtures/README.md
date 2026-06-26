# e2e fixtures

## `cassette/` — the card-data cache cassette (#757 / #807)

The end-to-end suite drives the real SPA↔FastAPI↔SQLite seam, but card data normally comes from live pokemontcg.io — too slow and flaky to hit in CI. This cassette is a committed slice of the API disk cache for one small set, so card-dependent flows resolve from a cache **hit** while the SPA↔API path stays completely real. Only the external HTTP call is short-circuited.

[`../boot-api.sh`](../boot-api.sh) copies this directory into the run's throwaway cache root (`$XDG_CACHE_HOME/mgz-pkmn/`) and `touch`es the files so their mtime is current — that keeps the 24h-TTL pricing slice fresh and means a run makes **zero** outbound calls.

### What's here

- **Set:** `mcd19` — McDonald's Collection 2019, 12 cards (Caterpie, Pikachu, Eevee, …). Chosen as the smallest recognizable English set, to keep the fixture small and reviewable.
- **`sets.json`** — the trimmed set catalog the `/api/sets` endpoint caches (`api/routes/sets.py`). Browse's set list renders from this, so the test can walk to the McDonald's set tile without a live catalog fetch. 1-week TTL (refreshed to "now" by the seed).
- **`api_structural/<sha1>.json`** — the no-TTL structural slice (which cards are in the set). This is what makes the browse view render from a permanent cache hit. See the split-cache design in `src/mgz_pkmn/cache.py` (#372 / ADR-0018).
- **`api_pricing/<sha1>.json`** — the 24h-TTL pricing overlay for the same cards.

The `<sha1>` filename is the cache key — a sha1 of the upstream request URL (`set.id:"mcd19"`), computed deep in `TCGClient._fetch_page`. **Do not rename these files**; the name is the lookup key, so a rename turns the hit into a miss.

### Regenerating

```bash
# Card slices for the set:
rm -rf /tmp/cassette-gen
XDG_CACHE_HOME=/tmp/cassette-gen uv run pkmn cache warm-set-cards --set mcd19
cp /tmp/cassette-gen/mgz-pkmn/api_structural/*.json web/e2e/fixtures/cassette/api_structural/
cp /tmp/cassette-gen/mgz-pkmn/api_pricing/*.json    web/e2e/fixtures/cassette/api_pricing/

# Set catalog (same trim as api/routes/sets.py:_fetch_sets):
curl -s "https://api.pokemontcg.io/v2/sets?orderBy=releaseDate&pageSize=250" | python3 -c "
import sys, json
raw = json.load(sys.stdin).get('data', [])
keep = ('id', 'name', 'series', 'total', 'releaseDate')
print(json.dumps([{k: s.get(k) for k in keep} for s in raw], indent=2))
" > web/e2e/fixtures/cassette/sets.json
```

Only regenerate if the upstream payload shape changes or the chosen set is retired upstream; the structural data is otherwise stable once a set ships.
