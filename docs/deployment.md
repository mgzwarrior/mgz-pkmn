# Deployment

The web UI (FastAPI backend + React frontend) can be self-hosted
anywhere that runs Python 3.11+ and Node.js 20+. Below is a minimal
production recipe.

## 1 — Build the frontend

```bash
make build-web        # produces web/dist/ (runs `tsc -b && vite build`)
```

The compiled static files in `web/dist/` can be served by any static
host (Nginx, Caddy, S3 + CloudFront, Netlify, etc.).

## 2 — Start the API

```bash
make install-api
uv run uvicorn api.main:app --host 0.0.0.0 --port 8000
```

(`make dev-api` is the local-development variant — it adds `--reload`
and binds to localhost only.)

For production, swap `--reload` for a proper process manager (e.g.
systemd, Docker, or Gunicorn in front of uvicorn):

```bash
uv run gunicorn api.main:app -k uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 --workers 2
```

## 3 — Wire the frontend to the API

In production the Vite proxy is gone. Two options:

**Option A — Reverse proxy (recommended).** Point your gateway (Nginx,
Caddy, etc.) at the same domain, routing `/api/*` to
`http://localhost:8000` and everything else to `web/dist/`. No CORS
changes needed.

```nginx
location /api/ { proxy_pass http://localhost:8000; }
location /     { root /srv/mgz-pkmn/web/dist; try_files $uri /index.html; }
```

**Option B — Separate origins.** Build the frontend with the API URL
baked in:

```bash
VITE_API_BASE=https://api.example.com npm run build
```

Then update `allow_origins` in [`api/main.py`](../api/main.py) to
include your frontend origin.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `POKEMONTCG_IO_API_KEY` | API process env | Raises rate limit to 20k req/day |
| `VITE_API_BASE` | Frontend build-time | Override API URL (default: empty → same origin) |

## Docker (single-unit)

A multi-stage [`Dockerfile`](../Dockerfile) at the repo root builds the
SPA and the API into one image. FastAPI serves both: `/api/*` and
`/health` for the backend, everything else from the built `web/dist/`.
CORS is unused in this mode (same origin).

```bash
make docker-build
POKEMONTCG_IO_API_KEY=your-key make docker-run
# open http://localhost:8000
```

## Deploy to Render (free tier)

The repo ships a [`render.yaml`](../render.yaml) blueprint and a manual
deploy workflow. One-time setup:

1. **Create the service** — in the Render dashboard,
   *New → Blueprint*, point it at this repo. It picks up `render.yaml`
   and creates a Docker web service on the free plan with `autoDeploy`
   off.
2. **Set the API key** — in the service's *Environment* tab, set
   `POKEMONTCG_IO_API_KEY`.
3. **Capture the deploy hook** — *Settings → Deploy Hook*, copy the
   URL, save it as a GitHub repo secret named `RENDER_DEPLOY_HOOK`.

Once set up, deploys are manual: GitHub → *Actions* → *Deploy* →
*Run workflow*. The job POSTs to the deploy hook and Render rebuilds
from `main`.

> **Free-tier caveat:** Render's free web service spins down after
> ~15 min of idle traffic; the next request takes ~30s to wake it.
> Fine for hobby use. Upgrade to *Starter* (or move to Fly.io) if cold
> starts hurt.
