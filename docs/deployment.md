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
| `MGZ_PKMN_DATABASE_URL` | API process env | SQLAlchemy URL for the persistence layer. Defaults to `sqlite:///<cache-root>/mgz-pkmn.db` (e.g. `sqlite:////home/me/.cache/mgz-pkmn/mgz-pkmn.db`). The API also runs against Postgres via a `postgresql+psycopg://…` URL, but no Postgres driver ships in the `api` extra — install one yourself (`pip install psycopg`) before pointing at Postgres. See [ADR-0013](adr/0013-sqlite-persistence-for-runs-collections-wishlists.md). |
| `MGZ_PKMN_AUTOMIGRATE` | API process env | Set to `0` (or `false`) to skip the automatic `alembic upgrade head` on API startup. Useful when migrations are run as a prestart step (init container, Render pre-deploy command, etc.). Default: enabled. |

## Database & migrations

The API persists run history (and, in follow-up slices, collections + wishlists) to a SQLite file at `$XDG_CACHE_HOME/mgz-pkmn/mgz-pkmn.db` by default — same cache root as the existing disk cache, so `rm -rf ~/.cache/mgz-pkmn` wipes both stores together. The schema is managed by Alembic; configuration lives in [`api/alembic.ini`](../api/alembic.ini) and migrations in [`api/migrations/`](../api/migrations/).

On startup, the API runs `alembic upgrade head` automatically, gated by a cross-worker lock (`fcntl.flock` on SQLite, `pg_advisory_lock` on Postgres) so multiple `uvicorn --workers N` processes don't race the upgrade. Set `MGZ_PKMN_AUTOMIGRATE=0` to skip the auto-run and migrate explicitly:

```bash
make migrate                           # apply pending migrations against MGZ_PKMN_DATABASE_URL
# or:
uv run alembic -c api/alembic.ini upgrade head
```

To downgrade (during rehearsal or rollback), use Alembic directly:

```bash
uv run alembic -c api/alembic.ini downgrade -1     # one revision back
uv run alembic -c api/alembic.ini downgrade base   # back to empty
```

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

## Deploy to Render (Starter)

The repo ships a [`render.yaml`](../render.yaml) blueprint with
**auto-deploy on**: every push to `main` rebuilds and redeploys
automatically. The blueprint declares `plan: starter` because the
persistent disk required by the pre-Scrydex catalog warm
([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368)) isn't
available on Render's free tier — Render's validator rejects
`disks are not supported for free tier services` for any blueprint
that pairs a `disk:` block with `plan: free`.

One-time setup:

1. **Create the service** — in the Render dashboard,
   *New → Blueprint*, point it at this repo. It picks up `render.yaml`
   and creates a Docker web service on the Starter plan with `autoDeploy`
   on and a 10 GB persistent disk attached at `/var/cache`.
2. **Set the API key** — in the service's *Environment* tab, set
   `POKEMONTCG_IO_API_KEY`.
3. **(Optional) Capture the deploy hook** — *Settings → Deploy Hook*,
   copy the URL, save it as a GitHub repo secret named
   `RENDER_DEPLOY_HOOK`. This enables the manual *Deploy* GitHub
   Action for forced rebuilds (see below). Not required for routine
   deployment, since auto-deploy handles that.

If you ever switch the blueprint's `plan:` (e.g. downgrading for
testing), the next blueprint sync may fail validation; flip
`plan: starter` back and trigger *Manual sync* to recover.

### Forced rebuilds (when needed)

Auto-deploy handles every commit that lands on `main`, so most
deploys happen without thinking. The manual workflow is for the
edge cases:

- **Clear the build cache** before deploying (e.g., a stale layer
  cached a bad dep).
- **Re-deploy without a code change** (e.g., after rotating an env
  var that doesn't trigger a redeploy on its own).

GitHub → *Actions* → *Deploy* → *Run workflow*, optionally toggling
*Clear build cache before deploying*. The job POSTs to the deploy
hook and Render starts a fresh build from `main`.

> **Plan note:** The Starter plan stays up between requests (no
> idle-spin-down), so demo links don't show a 30s cold start. The
> persistent disk + always-on service is also what makes the
> [pre-Scrydex catalog warm epic](https://github.com/mgzwarrior/mgz-pkmn/issues/368)
> viable — every redeploy reuses what previous deploys warmed.

## Persistent disk + cache location

The deployment provisions a Render persistent disk mounted at
`/var/cache` (declared in [`render.yaml`](../render.yaml)). `XDG_CACHE_HOME`
is set to that same mount path, and [`src/mgz_pkmn/cache.py::_cache_root_path`](../src/mgz_pkmn/cache.py)
reads `XDG_CACHE_HOME` as the *parent* directory and appends `mgz-pkmn`,
so the project cache root resolves to `/var/cache/mgz-pkmn` on the
deployed instance. Everything under that path — API response cache,
image cache (set logos/symbols, card art), URL overrides, the run-history
SQLite file, the three warm-pass manifests — persists across redeploys.

If you change the mount path in Render, update `XDG_CACHE_HOME` to match
in the same edit. The cache module appends `mgz-pkmn` itself, so always
point the env var at the *parent* directory; pointing it at
`/var/cache/mgz-pkmn` would produce `/var/cache/mgz-pkmn/mgz-pkmn`.

### Cache warming

Five runtime warm passes can fire on startup, gated by three env vars
so the lighter passes can run independently of the two heaviest. Each
writes its own freshness manifest so container restarts within the
freshness window skip the re-walk:

| Pass | Env var | Manifest | Freshness window | Walks |
|---|---|---|---|---|
| Concepts | `MGZ_PKMN_WARM_ON_STARTUP=1` | `concept_warm.json` | 24 h | ~200 concept-name → card-id lookups |
| Set cards | `MGZ_PKMN_WARM_ON_STARTUP=1` | `set_cards_warm.json` | 7 d | Per-set card-list JSON (~170 sets) |
| Sets (images) | `MGZ_PKMN_WARM_ON_STARTUP=1` | `sets_warm.json` | 7 d | Set logo + symbol images (~200 × 2) |
| Per-card structural | `MGZ_PKMN_WARM_CARDS_ON_STARTUP=1` | `card_warm.json` | 7 d | Full per-card structural payload (~18,000 cards) |
| Per-card images | `MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP=1` | `card_images_warm.json` | 7 d | `large` + `small` image bytes per card (~40,000 files / ~17 GB) |

The two per-card passes get their own opt-in env vars (separate from
the umbrella `MGZ_PKMN_WARM_ON_STARTUP`) because they're heavyweight —
the image warm in particular needs ~17 GB of persistent disk. All three
env vars are set in `render.yaml` by default.

The set-image warm previously lived as a Dockerfile build-time step.
With the persistent disk in place all five passes run at runtime onto
durable storage — a single warm after the first deploy serves every
subsequent deploy until the relevant manifest's freshness window
expires.

See [Cache → Warm passes](cache.md#warm-passes) for the per-pass
mechanics, and [Cache → Entries vs. API calls](cache.md#entries-vs-api-calls)
for why a 20k-entry cache typically represents well under 1k API calls.

## Inspecting deployed cache state

`pkmn cache stats` reads `~/.cache/mgz-pkmn` on the local filesystem, so
it can't see what's warmed on a remote deploy. The API surfaces the same
snapshot at `GET /api/v1/cache/stats`:

```bash
curl -s https://mgz-pkmn.onrender.com/api/v1/cache/stats | jq
```

Same field names as `pkmn cache stats --json`, so the two surfaces are
pipe-compatible. Use it to confirm the warm
env vars actually landed (`concept_warm_timestamp` /
`set_cards_warm_timestamp` / `sets_warm_timestamp` /
`card_warm_timestamp` / `card_images_warm_timestamp` are non-null after
a successful warm pass) and to spot drift between the entry counts you
expected and what's actually on disk. The response is served with `Cache-Control: no-store` because the
underlying state changes on every warm pass and cache write.
