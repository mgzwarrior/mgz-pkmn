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
# The cache root is seeded from the committed cassette (web/e2e/fixtures/cassette)
# so card-dependent flows resolve the warmed set from a disk-cache HIT — the
# SPA↔API seam stays real, only the external pokemontcg.io call is short-circuited.
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
# Pin the API offline. The cassette covers the cards the specs touch, but the
# Swipe deck (the default surface) samples a random set from the bundled
# catalog on load — one outside the cassette would otherwise fetch
# pokemontcg.io live via /api/v1/sets/{id}/cards. cache_only degrades a disk
# miss to an empty result, so a run makes zero outbound calls regardless of
# which set the deck picks. See api/cache_mode.py and docs/e2e.md.
export MGZ_PKMN_CACHE_ONLY=1

# Seed the cassette into this run's cache root. The structural slice is no-TTL,
# so it always HITs; `touch` brings the 24h pricing slice's mtime to now so it
# HITs too — together that means a run makes zero outbound pokemontcg.io calls.
# See web/e2e/fixtures/README.md.
CASSETTE="$ROOT/web/e2e/fixtures/cassette"
if [ -d "$CASSETTE" ]; then
  mkdir -p "$XDG_CACHE_HOME/mgz-pkmn"
  cp -R "$CASSETTE/." "$XDG_CACHE_HOME/mgz-pkmn/"
  find "$XDG_CACHE_HOME/mgz-pkmn" -type f -exec touch {} +
  echo "e2e: seeded cache cassette from $CASSETTE" >&2
fi

echo "e2e: applying migrations to $MGZ_PKMN_DATABASE_URL" >&2
uv run alembic -c api/alembic.ini upgrade head >&2

# A dedicated default port keeps the suite off :8000, where `make dev-api` /
# `make dev` may already be serving the developer's real DB.
echo "e2e: starting uvicorn on :${E2E_PORT:-8123}" >&2
# Run uvicorn as a child (not `exec`) so the EXIT trap above survives to tear
# down $STATE_DIR. Forward termination so Playwright's stop shuts uvicorn down,
# then wait for it to actually exit before cleanup releases the temp DB.
uv run uvicorn api.main:app --port "${E2E_PORT:-8123}" &
UVICORN_PID=$!
trap 'kill -TERM "$UVICORN_PID" 2>/dev/null || true' INT TERM
while kill -0 "$UVICORN_PID" 2>/dev/null; do
  wait "$UVICORN_PID" 2>/dev/null || true
done
