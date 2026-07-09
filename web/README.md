# mgz-pkmn Web Frontend

React + Vite + TypeScript SPA for the mgz-pkmn card-lookup tool. Talks to
the FastAPI backend in [`../api/`](../api/).

## Prerequisites

- **Node.js 20+** (Vite 8 / React 19 — older Node will fail on
  `npm install` or build).
- The API server running at `http://localhost:8000`. Start it first:

  ```bash
  # from the repo root
  make install-api
  make dev-api
  ```

  Full instructions in [../api/README.md](../api/README.md).

## Quick start

```bash
# from the repo root
make install-web          # one-time — runs `npm install` in web/
make dev-web              # starts the Vite dev server
```

Or, if you'd rather run npm directly from `web/`:

```bash
cd web
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api/*` to
`http://localhost:8000` (see [vite.config.ts](vite.config.ts)), so the SPA
hits the backend without any CORS / origin gymnastics.

## Scripts

Run from the repo root via Make, or directly with `npm` from inside `web/`:

| Make (repo root) | npm (in `web/`) | What it does |
|---|---|---|
| `make dev-web` | `npm run dev` | Vite dev server with HMR on `:5173`. |
| `make build-web` | `npm run build` | Type-check (`tsc -b`) then produce a production bundle in `dist/`. |
| `make lint-web` | `npm run lint` | Run ESLint over `src/`. |
| — | `npm run preview` | Serve the built `dist/` locally on `:4173` (also CORS-allowed by the API). |

## Tech stack

| Concern | Library |
|---|---|
| Bundler | Vite + `@vitejs/plugin-react` |
| UI framework | React 19 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`) |
| Component primitives | Radix UI (`dialog`, `label`, `slider`, `switch`, `tooltip`) |
| Icons | lucide-react |
| Server state | TanStack Query |
| Client state | Zustand (with `persist` middleware) |
| Language | TypeScript |

## Architecture

```
web/src/
├── App.tsx                    # top-level layout + run/stop/rerun handlers
├── main.tsx                   # React root
├── index.css                  # Tailwind entry
├── types.ts                   # shared TS types (CardQuery, Pricing, BulkEvent, …)
├── api/
│   └── client.ts              # fetch wrappers around /api/v1/*
├── components/
│   ├── InputEditor.tsx        # textarea + parse-preview + ⌘↵
│   ├── ResultsTable.tsx       # streaming row table
│   ├── ExportBar.tsx          # xlsx / PDF download buttons
│   └── SettingsDrawer.tsx     # API key, max price, condition, dedupe, tag
├── store/
│   └── index.ts               # Zustand store (rows, settings, isRunning, progress)
└── assets/                    # static images
```

### Data flow

1. User edits the textarea in `InputEditor`.
2. **As they type**: `client.parseLine` POSTs to `/api/v1/parse` (350 ms debounce)
   to render a parse preview underneath the active line.
3. **On ⌘↵ / Run**: `App.handleRun` opens an SSE connection via
   `client.bulkLookup` to `/api/v1/bulk`. Each event is appended to the
   Zustand store via `appendRow`, which flows into `ResultsTable`.
4. **On Export**: `ExportBar` applies the current condition multipliers to
   each row, POSTs the enriched rows to `/api/v1/export`, and triggers a
   browser download of the returned `.xlsx` or `.pdf`.
5. **On unmatched row → "Add PriceCharting URL"**: POST to `/api/v1/overrides`
   to record the mapping, then re-runs that single line via `lookupLine`.

Settings (`api_key`, `tag`, `max_price`, `condition`, condition multipliers,
`dedupe`, `no_images`, `density`) are persisted to `localStorage` via Zustand
`persist`, so they survive reloads. Row-level condition overrides are
session-only and survive re-lookups until the editor is explicitly cleared.
Density has two modes: comfortable (the default) and compact, which tightens
the results table, Backpack, and header to roughly two-thirds of the
comfortable rhythm for working through long lists.

## Pointing at a non-default API URL

The dev proxy is hard-coded to `http://localhost:8000` in
[vite.config.ts](vite.config.ts). If the API runs elsewhere (different
port, remote dev box), edit the `target` in that file. For production
deployments, build with `npm run build` and serve `dist/` behind whatever
gateway/CDN routes `/api/*` to the FastAPI server.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| All requests return 404 / network errors | API isn't running. Start it (`uv run uvicorn api.main:app --reload`) before `npm run dev`. |
| `npm install` fails on dependency resolution | Node version too old. Vite 8 + React 19 need Node 20+. `node -v` to check. |
| Port 5173 already taken | Another Vite instance is running, or set the port: `npm run dev -- --port 5174`. (You'll also need to add that origin to the CORS allowlist in [../api/main.py](../api/main.py).) |
| CORS error when hitting the API directly | Don't fetch `http://localhost:8000` from the browser — go through the Vite proxy at `/api/...`. The proxy strips origin issues. |
| Settings drawer is empty after clearing site data | Expected — Zustand `persist` lost its key. Re-enter your settings; they'll re-persist. |
| Results table stuck "running" with no rows | The SSE connection hung mid-stream. Hit **Stop**, check the API logs, retry. The abort controller in `App.tsx` cleans up. |

## Dev tips

- The contract between API and frontend lives in two files:
  [src/types.ts](src/types.ts) (what the frontend expects to receive) and
  [src/api/client.ts](src/api/client.ts) (the fetch wrappers). When changing
  a route signature on the backend, update both.
- The streaming SSE consumer is hand-rolled in `client.ts` — `EventSource`
  doesn't support POST bodies, so we use `fetch` + a manual line reader.
- Tailwind v4 doesn't need a `tailwind.config.js`; the `@tailwindcss/vite`
  plugin discovers utility classes from JSX automatically.
