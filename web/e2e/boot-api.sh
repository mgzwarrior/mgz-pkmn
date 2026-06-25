#!/usr/bin/env bash
#
# Boot the FastAPI service for the end-to-end suite (#757 / #758).
#
# Deterministic by construction: a throwaway SQLite DB + cache root under a
# fresh temp dir, auth OFF (the default) so every request resolves to the
# sentinel `default` user without a sign-in dance, and the built SPA served
# from `web/dist` at `/` so Playwright drives a single same-origin base URL.
# Nothing here touches the developer's real ~/.cache/mgz-pkmn or DB.
#
# Playwright's `webServer` runs this and waits for the URL to answer; the Make
# target and CI build the SPA first, but we build on demand too so a bare
# `npx playwright test` works locally.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# The API only mounts the SPA when web/dist exists (see api/main.py).
if [ ! -f web/dist/index.html ]; then
  echo "e2e: web/dist missing — building the SPA…" >&2
  (cd web && npm run build)
fi

STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mgz-pkmn-e2e.XXXXXX")"
trap 'rm -rf "$STATE_DIR"' EXIT

export MGZ_PKMN_DATABASE_URL="sqlite:///$STATE_DIR/e2e.db"
export XDG_CACHE_HOME="$STATE_DIR/cache"
# Auth scaffold stays off → sentinel default user, no cookies required.
unset MGZ_PKMN_AUTH_ENABLED 2>/dev/null || true

echo "e2e: applying migrations to $MGZ_PKMN_DATABASE_URL" >&2
uv run alembic -c api/alembic.ini upgrade head >&2

echo "e2e: starting uvicorn on :${E2E_PORT:-8000}" >&2
exec uv run uvicorn api.main:app --port "${E2E_PORT:-8000}"
