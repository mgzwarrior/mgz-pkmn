"""FastAPI service for mgz-pkmn card lookup.

Run with:
    uvicorn api.main:app --reload --port 8000

Or from inside the api/ directory:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from mgz_pkmn import __version__
from mgz_pkmn import cache as disk_cache
from mgz_pkmn.lookup import warm_concepts, warm_set_cards
from mgz_pkmn.sources import TCGClient, TCGDexClient

# Import the module (not the names) so tests can monkeypatch
# `migrate.run_migrations_with_lock` / `migrate.automigrate_enabled` and
# have the lifespan see the patched values.
from .db import migrate
from .db.session import get_engine
from .routes import changelog, export, lookup, overrides, parse, runs, set_cards, sets

_log = logging.getLogger(__name__)

_WARM_ON_STARTUP_ENV = "MGZ_PKMN_WARM_ON_STARTUP"


def _warm_concepts_in_background() -> None:
    """Run the concept warm pass on a daemon thread so FastAPI startup
    isn't blocked by ~200 upstream HTTP requests.

    Gated by the on-disk freshness manifest — if a warm pass landed within
    the last 24 h, skip and log "already fresh". Errors are logged and
    swallowed: a failed warm should not crash the service, only leave the
    cache cold for this run."""
    if disk_cache.concept_warm_is_fresh():
        _log.info("concept cache fresh; skipping startup warm")
        return

    def _run() -> None:
        try:
            pkmn = TCGClient(api_key=os.environ.get("POKEMONTCG_IO_API_KEY"))
            tcgdex = TCGDexClient()
            result = warm_concepts(pkmn, tcgdex, source="all")
            disk_cache.write_concept_warm(
                names_warmed=result.names_warmed,
                names_failed=result.names_failed,
                source="all",
            )
            _log.info(
                "concept warm complete: %d names attempted, %d warmed, %d missed",
                result.names_attempted,
                result.names_warmed,
                len(result.names_failed),
            )
        except Exception:
            _log.exception("concept warm failed; service running with cold cache")

    threading.Thread(target=_run, name="concept-warm", daemon=True).start()


def _warm_set_cards_in_background() -> None:
    """Run the set-cards warm pass on a daemon thread so FastAPI startup
    isn't blocked by ~500 upstream HTTP requests.

    Gated by the on-disk freshness manifest — if a warm pass landed
    within the last week, skip and log "already fresh". Errors are
    logged and swallowed: a failed warm should not crash the service,
    only leave the per-set card lists cold for this run. Sets card
    data effectively doesn't change once a set ships (only market
    prices drift, and that's already covered by the 1-day browser
    cache on the endpoint), so the weekly cadence is generous."""
    if disk_cache.set_cards_warm_is_fresh():
        _log.info("set-cards cache fresh; skipping startup warm")
        return

    def _run() -> None:
        try:
            pkmn = TCGClient(api_key=os.environ.get("POKEMONTCG_IO_API_KEY"))
            result = warm_set_cards(pkmn)
            disk_cache.write_set_cards_warm(
                sets_warmed=result.sets_warmed,
                sets_failed=result.sets_failed,
            )
            _log.info(
                "set-cards warm complete: %d sets attempted, %d warmed, %d missed",
                result.sets_attempted,
                result.sets_warmed,
                len(result.sets_failed),
            )
        except Exception:
            _log.exception("set-cards warm failed; service running with cold cache")

    threading.Thread(target=_run, name="set-cards-warm", daemon=True).start()


class SPAStaticFiles(StaticFiles):
    """StaticFiles that disables browser caching for ``index.html``.

    Vite emits content-hashed filenames for JS/CSS, so those are safe to cache
    aggressively. But ``index.html`` points at the current hashed bundle names,
    and a stale copy will load the old assets after a redeploy. Forcing
    revalidation on ``index.html`` keeps deploys visible without a hard reload.
    """

    def file_response(
        self,
        full_path: Any,
        stat_result: os.stat_result,
        scope: Any,
        status_code: int = 200,
    ) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        if os.path.basename(os.fspath(full_path)) == "index.html":
            response.headers["Cache-Control"] = "no-cache"
        return response


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Startup/shutdown hook.

    On startup, runs `alembic upgrade head` against the configured DB under
    a cross-worker lock (see ADR-0013 and `api.db.migrate`). Set
    `MGZ_PKMN_AUTOMIGRATE=0` to skip — useful when migrations are run as a
    prestart step instead (init containers, Render pre-deploy, etc.).
    """
    if migrate.automigrate_enabled():
        try:
            migrate.run_migrations_with_lock(get_engine())
        except Exception:
            _log.exception("Alembic upgrade failed during startup")
            raise
    else:
        _log.info("MGZ_PKMN_AUTOMIGRATE=0 — skipping startup migrations")
    yield


app = FastAPI(
    title="mgz-pkmn API",
    description="Browser-accessible API for the mgz-pkmn Pokémon card lookup tool.",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow the Vite dev server (and any localhost port) to call the API.
# In production, restrict this to your actual frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Opt-in startup hook: when MGZ_PKMN_WARM_ON_STARTUP=1, kick off both the
# concept warm and the set-cards warm in the background so first-use
# lookups served by this process are cache hits. Each warmer has its own
# freshness manifest (24 h for concepts, 1 week for set cards) so the
# heavier one doesn't re-thrash on every `uvicorn --reload` cycle.
if os.environ.get(_WARM_ON_STARTUP_ENV, "").strip() in ("1", "true", "True"):

    @app.on_event("startup")
    def _startup_warm() -> None:
        _warm_concepts_in_background()
        _warm_set_cards_in_background()


app.include_router(parse.router, prefix="/api/v1", tags=["parse"])
app.include_router(lookup.router, prefix="/api/v1", tags=["lookup"])
app.include_router(export.router, prefix="/api/v1", tags=["export"])
app.include_router(sets.router, prefix="/api/v1", tags=["sets"])
app.include_router(set_cards.router, prefix="/api/v1", tags=["set-cards"])
app.include_router(overrides.router, prefix="/api/v1", tags=["overrides"])
app.include_router(changelog.router, prefix="/api/v1", tags=["changelog"])
app.include_router(runs.router, prefix="/api/v1", tags=["runs"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/version")
def version() -> dict[str, str]:
    return {"version": __version__}


# Serve the built SPA when present (single-unit production deploy). The mount
# lives below the API routes so /api/* and /health continue to win.
_web_dist = Path(__file__).resolve().parent.parent / "web" / "dist"
if _web_dist.is_dir():
    app.mount("/", SPAStaticFiles(directory=_web_dist, html=True), name="web")
