# mgz-pkmn API

FastAPI service that exposes the `mgz_pkmn` card-lookup pipeline over HTTP.
Every route delegates to the same parser, lookup, pricing, and export code
the CLI uses — no logic is duplicated here.

Pairs with the React frontend in [`../web/`](../web/), but works fine as a
standalone JSON API (point `curl`, Postman, or your own client at it).

## Quick start

From the **repository root** (recommended — shares the existing `uv` virtual
environment with the CLI and the rest of the project):

```bash
make install-api          # uv sync --extra api
make dev-api              # uv run uvicorn api.main:app --reload --port 8000
```

`make install-api` pulls in `fastapi` + `uvicorn[standard]` as an opt-in
extra (not in the default CLI dependencies) so `pip install mgz-pkmn` stays
lightweight for users who only want the CLI.

Override the port with `PORT_API=`:

```bash
PORT_API=8001 make dev-api
```

Or, from inside `api/` (uses the package's own `pyproject.toml`, which
editable-installs `mgz_pkmn` from the parent directory and depends on
fastapi/uvicorn directly):

```bash
uv sync
uvicorn main:app --reload --port 8000
```

The API runs at <http://localhost:8000>. Interactive Swagger docs (try
endpoints from the browser) are at <http://localhost:8000/docs>; the OpenAPI
schema is at <http://localhost:8000/openapi.json>.

> If `uv` isn't on your `PATH`, install it (`brew install uv` on macOS, or
> `curl -LsSf https://astral.sh/uv/install.sh | sh`). As a last resort you
> can substitute `python -m uv …` for `uv …` after `python -m pip install --user uv`.

## Docker

The Dockerfile in the repository root builds a production image with the API
and built SPA. The image includes a `HEALTHCHECK` that probes the `/health`
endpoint every 30 seconds (with a 10-second startup grace period). This allows
orchestrators (Kubernetes, Docker Compose, Render, etc.) to detect when the
app is ready and healthy.

```bash
docker build -t mgz-pkmn .
docker run -p 8000:8000 mgz-pkmn
docker ps  # shows (healthy) after ~10 seconds
```

The healthcheck respects the `$PORT` environment variable (Render injects it;
defaults to 8000).

## Running with the web frontend

In a second terminal, start the Vite dev server:

```bash
make install-web          # one-time
make dev-web
```

Open <http://localhost:5173>. Vite proxies `/api/*` → `http://localhost:8000`
(see [web/vite.config.ts](../web/vite.config.ts)), so the SPA hits the API
without CORS gymnastics. CORS is also pre-allowed for `localhost:5173` and
`localhost:4173` (Vite preview) — see [api/main.py](main.py).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Liveness probe — returns `{"status": "ok"}` |
| `POST` | `/api/v1/parse` | Parse one card-list line → `CardQuery` |
| `POST` | `/api/v1/lookup` | Resolve one card line → array of rows |
| `POST` | `/api/v1/bulk` | Resolve many lines, streaming each row as SSE |
| `POST` | `/api/v1/export` | Build an `.xlsx` or PDF binder from rows |
| `GET`  | `/api/v1/sets` | Cached list of Pokémon TCG sets (weekly TTL) |
| `POST` | `/api/v1/overrides` | Record a sticky PriceCharting URL override |
| `GET`  | `/api/v1/overrides` | List all recorded URL overrides |
| `GET`  | `/api/v1/set-cards.pdf` | Printable set identification cards PDF (no input needed) |

The full schema (request models, response shapes) is in Swagger — the
examples below are just the bits worth calling out.

### POST `/api/v1/parse`

```json
{ "line": "Charizard | Base Set | 4/102" }
```

Returns `{ "query": { "name": "Charizard", "set_hint": "Base Set", ... } }`
or `{ "query": null }` for blank / comment lines. Used by the web UI to
preview parsing as the user types (350 ms debounce).

### POST `/api/v1/lookup`

```json
{
  "line": "top:5 Charizard",
  "settings": { "api_key": null, "max_price": null, "tag": "" }
}
```

Returns `{ "rows": [...] }`. A bulk line (`top:N …`) expands into N rows; a
regular line returns one row (matched or unmatched). For multi-line input,
prefer `/bulk` — it streams progress instead of waiting for all rows.

### POST `/api/v1/bulk` (SSE)

```json
{
  "lines": ["Charizard | Base Set", "Pikachu | Jungle"],
  "settings": {
    "api_key": "optional-pokemontcg-key",
    "max_price": 50.0,
    "no_images": true,
    "tag": "binder1"
  }
}
```

Returns `text/event-stream`. Each event is a JSON object:

```json
{
  "index": 0,
  "total": 2,
  "query": { "raw": "Charizard | Base Set", "name": "Charizard", ... },
  "card": { "id": "base1-4", "name": "Charizard", "set": { "name": "Base" }, ... },
  "pricing": { "market": 450.0, "currency": "USD", "source": "tcgplayer", ... },
  "tag": "binder1",
  "matched": true,
  "reason": "matched"
}
```

A final `{ "done": true, "total": 2 }` event closes the stream. `index` is
the index in the **input lines** array — bulk top-N expansions reuse the
same index across multiple events.

The browser-side consumer is `bulkLookup(...)` in
[web/src/api/client.ts](../web/src/api/client.ts).

### POST `/api/v1/export`

```json
{
  "rows": [ /* row objects from the bulk stream */ ],
  "format": "xlsx",
  "max_price": null,
  "title": "binder1"
}
```

Returns the file as an attachment (`application/vnd.openxmlformats-…` for
xlsx, `application/pdf` for `format: "pdf"`). **Image thumbnails are not
embedded** in API exports — the request payload doesn't carry image bytes,
and re-downloading server-side would defeat the "fast and dependency-free"
goal. Run the CLI when you need image-embedded outputs.

### GET `/api/v1/sets`

Returns `{ "sets": [{ id, name, series, total, releaseDate }, ...] }`.
Cached on disk at `~/.cache/mgz-pkmn/sets.json` (7-day TTL). Pass
`?api_key=…` to authenticate the upstream refresh.

### POST `/api/v1/overrides`

```json
{ "name": "Cubone", "set": "Gem Pack Vol 3", "url": "https://www.pricecharting.com/..." }
```

Records a `(name, set) → URL` mapping in the same disk store the CLI
consults (`~/.cache/mgz-pkmn/url_overrides.json`). Future lookups for that
pair use PriceCharting automatically — no need to re-paste the URL.

## Architecture

```
api/
├── main.py            # FastAPI app + CORS + router wiring
├── routes/
│   ├── parse.py       # POST /parse
│   ├── lookup.py      # POST /lookup, POST /bulk (SSE)
│   ├── export.py      # POST /export
│   ├── sets.py        # GET /sets (with disk cache)
│   ├── set_cards.py   # GET /set-cards.pdf
│   └── overrides.py   # POST/GET /overrides
└── pyproject.toml     # editable-installs `mgz-pkmn` from ../
```

All blocking calls (`requests` to pokemontcg.io / TCGdex / PriceCharting,
`openpyxl` writes, `reportlab` PDF rendering) run via
`fastapi.concurrency.run_in_threadpool` so the event loop stays responsive
while a slow upstream resolves.

## Production notes

The default CORS allowlist only covers Vite dev / preview ports. Before
deploying anywhere real, edit the `allow_origins` list in
[api/main.py](main.py) to your actual frontend origin.

The disk cache (`~/.cache/mgz-pkmn/`) is shared with the CLI. If you run the
API as a different user than the CLI, give them a shared cache directory or
expect each to maintain its own.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `No module named uv` | You ran `python -m uv …`. Use plain `uv …` — see the install note in **Quick start**. |
| `address already in use` on port 8000 | Another `uvicorn` is running, or something else owns 8000. `lsof -i :8000` to find it, or pass `--port 8001`. |
| Web UI can't reach API (CORS or 404) | Make sure `uvicorn` is up on `:8000` *before* starting Vite, and that you opened the Vite URL (`:5173`), not the API URL. |
| `RequestException` on every lookup | Network down, or pokemontcg.io rate-limited you. Set `POKEMONTCG_IO_API_KEY` (raises the limit to 20k/day) and retry. |
| `/api/v1/sets` returns stale data | Delete `~/.cache/mgz-pkmn/sets.json` to force a refresh on the next request. |

## Dev workflow

API routes are covered by `tests/test_api_routes.py`, `tests/test_export_api.py`,
`tests/test_set_cards_api.py`, and `tests/test_spa_mount.py` at the repo root.
Run them with `make test` or `uv run python -m unittest discover -s tests`.
To smoke-test a route manually:

```bash
# Health
curl http://localhost:8000/health

# Parse
curl -X POST http://localhost:8000/api/v1/parse \
  -H 'Content-Type: application/json' \
  -d '{"line": "Charizard | Base | 4/102"}'

# Bulk SSE (curl will print events as they arrive)
curl -N -X POST http://localhost:8000/api/v1/bulk \
  -H 'Content-Type: application/json' \
  -d '{"lines": ["Pikachu | Base"], "settings": {"tag": "test"}}'
```

When changing route signatures, watch the corresponding TypeScript types in
[web/src/types.ts](../web/src/types.ts) and the client wrapper in
[web/src/api/client.ts](../web/src/api/client.ts) — those are the contract
the frontend assumes.
