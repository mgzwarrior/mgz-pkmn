# ADR 0013: SQLite + Alembic persistent store for runs, collections, and wishlists

- **Status:** Proposed
- **Date:** 2026-05-20
- **Tags:** persistence, api, web, schema

## Context

The CLI is stateless across invocations and the API is stateless across
requests. The Web SPA persists *settings* to `localStorage` (Zustand
`persist` middleware), but every lookup result evaporates on reload —
there's no way to re-open last week's run, diff two runs, or re-export
yesterday's pricing without re-running the full pipeline. Two open
roadmap issues call for the same underlying capability:

- **#58 Persistent run history with sidebar** — server-side run
  storage, a sidebar timeline of recent runs in the SPA, click-to-load
  and re-export actions.
- **#57 Multi-user persistent collections** — per-user collections,
  wishlists, and run history, with a `/collections` API surface; the
  single-user CLI must keep its filesystem flow.

Both want the same thing: a real, queryable, schema-aware store
sitting behind the API. The existing on-disk cache (ADR-0004) is the
wrong shape — it's a directory of opaque JSON blobs keyed by request
URL, fine for caching HTTP responses, useless for asking "show me the
last 20 runs" or "list every card in this collection priced above
$50."

Constraints worth naming up front:

- The CLI's filesystem-only flow is load-bearing for the
  single-user-on-a-laptop story. A new dependency or DB requirement
  for `pkmn lookup` would be a regression.
- The API already opts in to its own dependency set via `uv sync
  --extra api`. New API-only deps belong there.
- Real authentication (#61) is *not* on this milestone. Whatever
  schema we ship has to be migratable to a multi-tenant world without
  rewriting the wire format.
- The project's existing `Row` dataclass (ADR-0006) is the natural unit
  to persist — every output writer already speaks it.

## Decision

Add a single SQLite database file at
`$XDG_CACHE_HOME/mgz-pkmn/mgz-pkmn.db` (default
`~/.cache/mgz-pkmn/mgz-pkmn.db`), managed by SQLAlchemy 2.x ORM with
schema migrations under `api/migrations/` driven by Alembic. The
persistence layer is an API-only concern — the CLI is local-only and
stays on its filesystem flow — so the Alembic config (`api/alembic.ini`)
and migrations tree live under `api/` alongside the routes and models
they describe.

**Tables (v1 schema):**

| Table | Holds |
|---|---|
| `users` | One row per logical user. v1 ships a single sentinel row (`id=1`, `name="default"`). The `user_id` FK is already present on every per-user table so #61 (auth) becomes a contained backfill — no wire-format rewrite, no rows-moved-between-tables dance — though the auth feature itself will of course add its own auth-specific columns (email, etc.) via Alembic. |
| `runs` | One row per completed lookup pipeline: `id`, `user_id`, `created_at`, `elapsed_seconds`, `input_text`, `summary_json` (the `build_json_report` document minus the `rows` array — kept for cheap sidebar listing). |
| `run_rows` | One row per resolved `Row`: `id`, `run_id`, `position`, `tag`, `market_price` (NUMERIC, NULL on miss), `currency` (TEXT, NULL on miss), `image_path`, plus opaque sub-payloads `query_json` (parsed `CardQuery`), `card_json` (matched pokemontcg/TCGdex/PriceCharting payload, NULL on miss), and `pricing_json` (variant, url, raw provider response). `market_price` and `currency` are promoted out of `pricing_json` because they're the only fields likely to drive list filters (the existing `--max-price` flag, future "above-cap" highlighting); everything else stays in the JSON columns so source-side shape drift doesn't force schema changes. |
| `collections` | `id`, `user_id`, `name`, `description`, `created_at`. A user-named bucket of cards. |
| `collection_items` | `id`, `collection_id`, `card_json`, `notes`, `added_at`. Pinned card identity is stored verbatim from the matched payload — that's the only stable handle across re-lookups. |
| `wishlists` | Same shape as `collections`. Separate table so list semantics ("I own these" vs "I want these") stay distinct; sharing a polymorphic `lists` table buys us nothing. |
| `wishlist_items` | Same shape as `collection_items`, plus `max_price` (optional alert threshold for future work). |

`user_id` is **non-NULL with a default of 1** on every per-user table
in v1, pointing at the sentinel `default` user. When #61 lands, the
auth layer creates real `users` rows and rewrites the FK on existing
data in a single backfill migration.

**Tooling:**

- `sqlalchemy>=2.0` and `alembic` will land under the `[api]` optional
  dependency group. The CLI install (`uv sync` / `make install-cli`)
  picks up nothing.
- `api/migrations/` will hold the standard Alembic layout (`env.py`,
  `versions/`), with `api/alembic.ini` next to it. A new `make migrate`
  target will apply pending migrations against the configured DB URL
  for ad-hoc use.
- The API will run `alembic upgrade head` automatically on startup so
  every contributor and every deploy gets a schema-current DB without
  remembering to migrate. `make migrate` exists for the explicit case
  (CI smoke checks, manual repair, downgrade rehearsals via
  `alembic downgrade`).
- **Concurrent migrations across workers** (`gunicorn -w N` /
  `uvicorn --workers N`) are gated by a cross-process lock so only
  one worker actually runs the upgrade:
  - **SQLite** (default): a `fcntl.flock` on a sibling lockfile
    (`<db-path>.migrate.lock`). Trivially portable; the lock is
    held only for the duration of `alembic upgrade head`, which is
    a no-op on already-current schemas, so the overhead is bounded
    by one stat + one version-table read per worker boot.
  - **Postgres**: a `pg_try_advisory_lock(<fixed bigint>)` taken
    inside the upgrade transaction. Standard pattern; the lock is
    automatically released when the connection closes.
  - Either way, a stricter deployment is welcome to disable
    auto-migrate (`MGZ_PKMN_AUTOMIGRATE=0`) and run `make migrate`
    as a prestart step — Kubernetes init-container, Render
    pre-deploy command, etc. The flag exists for exactly this
    "I want migrations out of the hot path" preference.
- The default DB URL is built at app-start by resolving the cache
  root through the same `cache_root()` helper today's disk cache
  uses (it honours `XDG_CACHE_HOME`, falls back to `~/.cache`), then
  prepending `sqlite:///` to the absolute path — e.g.
  `sqlite:////home/mgz/.cache/mgz-pkmn/mgz-pkmn.db`. SQLAlchemy
  receives a fully-resolved path; the env var is never embedded
  literally in the URL. `MGZ_PKMN_DATABASE_URL` overrides the
  computed default end-to-end — same env-var convention as the
  existing cache knobs, and makes Postgres a drop-in replacement
  for hosted instances later (e.g.
  `postgresql+psycopg://user:pw@host/db`).

**Behavior surface:**

- **CLI**: filesystem flow unchanged. `pkmn lookup` never touches the
  database. A future opt-in flag (`--save-run`) can write runs to the
  DB; out of scope for the v1 ADR-implementation slice.
- **API**: `/api/v1/bulk` writes a `runs` + `run_rows` record on
  completion. Failures don't write. New endpoints:
  - `GET /api/v1/runs` — paginated list, lightweight (summary only).
  - `GET /api/v1/runs/{id}` — full run including all `run_rows`.
  - `POST /api/v1/runs/{id}/export` — re-export with a different
    format/flags; reuses the existing `/export` machinery.
  - `GET/POST/DELETE /api/v1/collections[/{id}[/items[/{item_id}]]]`
    and the analogous `/wishlists` tree.
- **Web SPA**: a collapsible left sidebar lists recent runs, clicking
  one populates `rows` + `inputText` from the stored payload, and an
  Export action re-runs the export pipeline against the loaded run.

## Consequences

- The API gains real state — a regression risk we mitigate by keeping
  every write idempotent (a run completes once, end of story) and
  making reads observe-only. No background workers, no async writes,
  no consistency story to defend.
- Web SPA gets the sidebar #58 asks for, plus a re-export path that
  bypasses re-fetching from pokemontcg.io entirely — yesterday's run
  re-exports in milliseconds.
- Collections + wishlists give #57 its full surface, gated on a
  single anonymous tenant until #61 lands. The schema is auth-ready;
  we don't have to ship auth to start writing user data.
- `Row` shape changes (ADR-0006) become migration concerns. The
  opaque sub-payloads (`query_json`, `card_json`, `pricing_json`) are
  stored as JSON, so adding or removing a field inside any of them
  is read-tolerant — no migration. Promoting a sub-field to a
  top-level column (as v1 already does for `market_price` and
  `currency`) is a real migration, handled by Alembic. Documented as
  the cost of a queryable history.
- Auto-migrate on API startup means a fresh checkout has a working
  DB after the first `uv run uvicorn …` — no separate setup step.
  Trade-offs:
  - A broken migration on a deployed instance fails the startup
    probe instead of running stale schema. Mitigated by CI-side
    `alembic upgrade head` on every PR.
  - Concurrent workers won't race: the SQLite-flock /
    Postgres-advisory-lock gate ensures exactly one worker
    actually runs the upgrade; the rest see schema-current and
    proceed.
  - Operators who want migrations out of the request path
    entirely can set `MGZ_PKMN_AUTOMIGRATE=0` and run
    `make migrate` as a prestart step (init container, Render
    pre-deploy, etc.).
- One new file alongside the existing cache: contributors who already
  reach for `rm -rf ~/.cache/mgz-pkmn` to "start fresh" get the same
  semantics for free; the DB is recreated on next API start.
- `make uninstall` already removes the `.venv` but leaves user data
  alone — the new DB is correctly classified as user data and stays
  put. No change needed.
- Alembic adds a real migration story for *future* schema changes —
  the project hasn't needed one before, but the moment we ship
  persistent user data, we need one.
- Footgun: any client with API access today reads everyone's data.
  Acceptable while we're single-tenant; #61 will introduce the
  per-user filter.

## Alternatives considered

- **Extend ADR-0004's JSON-files-per-record pattern.** Works for runs
  (one file per run, mtime is the timeline). Falls over for
  collections/wishlists — listing items in a collection means walking
  the directory, opening every file, filtering. No migration story
  for schema drift. Doesn't compose to multi-tenant.
- **PostgreSQL from day one.** Real multi-user concurrency, but
  doubles local-dev complexity (every contributor needs a running
  Postgres, or we ship docker-compose), and the multi-user payoff
  doesn't materialize until #61 anyway. Keep Postgres as a future
  swap via the `MGZ_PKMN_DATABASE_URL` knob.
- **TinyDB / shelve / pickled-dict.** Single-file like SQLite, but
  none give us migrations, queries, or transactions. We'd rebuild
  half of them by hand.
- **JSON column in a single `state` table.** Maximally flexible,
  minimally useful — every list view becomes a custom SQL JSON
  traversal. Burns the schema-as-documentation benefit.
- **Defer until #61 auth lands.** Stalls #57 and #58 indefinitely
  for an auth model that the maintainer hasn't scoped yet. The
  sentinel-user pattern unblocks both today without painting us into
  a corner.
