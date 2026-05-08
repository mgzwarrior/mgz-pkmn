# mgz-pkmn API

FastAPI service that puts a browser-accessible HTTP interface in front of the
`mgz_pkmn` card-lookup library.

## Quick start

From the **repository root** (recommended — shares the existing `uv` virtual
environment):

```bash
# Install dependencies (if you haven't already)
python -m uv sync

# Start the API server
python -m uv run uvicorn api.main:app --reload --port 8000
```

Or, from inside the `api/` directory:

```bash
uv sync
uvicorn main:app --reload --port 8000
```

The API will be available at <http://localhost:8000>.

Interactive docs (Swagger UI): <http://localhost:8000/docs>

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Liveness check |
| `POST` | `/api/v1/parse` | Parse a single card-list line → `CardQuery` |
| `POST` | `/api/v1/lookup` | Look up a single card line → resolved rows |
| `POST` | `/api/v1/bulk` | Stream bulk lookup results via **SSE** |
| `POST` | `/api/v1/export` | Generate `.xlsx` or PDF binder from rows |
| `GET`  | `/api/v1/sets` | Return cached list of TCG set names |
| `POST` | `/api/v1/overrides` | Record a sticky PriceCharting URL override |
| `GET`  | `/api/v1/overrides` | List all recorded URL overrides |

### POST /api/v1/parse

```json
{ "line": "Charizard | Base Set | 4/102" }
```

Returns `{ "query": { "name": "Charizard", "set_hint": "Base Set", ... } }` or
`{ "query": null }` for blank/comment lines.

### POST /api/v1/bulk (SSE)

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

Streams `text/event-stream` SSE events. Each event is a JSON object:

```json
{
  "index": 0,
  "total": 2,
  "query": { "raw": "Charizard | Base Set", ... },
  "card": { "name": "Charizard", "set": { "name": "Base Set" }, ... },
  "pricing": { "market": 450.0, "currency": "USD", ... },
  "tag": "binder1",
  "matched": true,
  "reason": "matched"
}
```

A final `{ "done": true, "total": 2 }` event marks the end of the stream.

### POST /api/v1/export

```json
{
  "rows": [ ... ],   // array of row objects from the bulk SSE stream
  "format": "xlsx",  // or "pdf"
  "max_price": null,
  "title": "binder1"
}
```

Returns the file as an octet-stream (`application/vnd.openxmlformats-…` for
xlsx or `application/pdf`).

---

## Development

The API lives in `api/` and imports `mgz_pkmn` from the parent package (editable
install via `tool.uv.sources`). No duplication of parser / lookup logic.

Running the Vite dev server alongside the API:

```bash
# Terminal 1
python -m uv run uvicorn api.main:app --reload --port 8000

# Terminal 2
cd web && npm run dev
```

Vite proxies `/api/*` → `http://localhost:8000` (see `web/vite.config.ts`).
