# mgz-pkmn Web Frontend

React + Vite + TypeScript SPA for the mgz-pkmn card-lookup tool.

## Quick start

```bash
# From the web/ directory
npm install
npm run dev
```

The app is served at <http://localhost:5173>. The Vite dev server proxies
`/api/*` requests to the FastAPI backend at `http://localhost:8000` (start
that first — see `../api/README.md`).

## Tech stack

| Concern | Library |
|---------|---------|
| Bundler | Vite + `@vitejs/plugin-react` |
| UI framework | React 18 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`) |
| Component primitives | Radix UI |
| Icons | lucide-react |
| Server state | TanStack Query |
| Client state | Zustand (persisted settings) |
| Language | TypeScript |

## Screens

### Card list editor (`InputEditor`)
- Multi-line textarea accepting the same grammar as the CLI (`name | set | number`).
- Inline parse-preview: calls `/api/v1/parse` on the current line as the user
  types (350 ms debounce) and displays extracted name / set / number.
- **⌘↵** (or Ctrl+Enter) triggers a lookup run.

### Live results table (`ResultsTable`)
- Rows stream in via SSE from `/api/v1/bulk` as the backend resolves them.
- Progress bar shows _n of total_ lines done.
- Each row: card name, set, rarity, market price, comp tiers (80/85/90/95%),
  price source, external listing link.
- Unmatched rows show an amber alert with an "Add PriceCharting URL" inline
  action that POSTs to `/api/v1/overrides` and re-runs that line.

### Export bar (`ExportBar`)
- **Download .xlsx** / **Download PDF binder** buttons hit `/api/v1/export`
  and trigger a browser download.

### Settings drawer (`SettingsDrawer`)
- pokemontcg.io API key (optional, raises rate limit)
- Source tag (labels rows in the export)
- Max price cap
- Deduplicate toggle
- Hide images toggle

Settings are persisted to `localStorage` via Zustand `persist` middleware.

## Build

```bash
npm run build   # production build → dist/
npm run preview # serve dist/ locally
```
