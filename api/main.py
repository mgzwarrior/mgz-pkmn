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
from mgz_pkmn.lookup import warm_cards, warm_concepts, warm_set_cards
from mgz_pkmn.set_cards import warm_set_images
from mgz_pkmn.sources import TCGClient, TCGDexClient

# Import the module (not the names) so tests can monkeypatch
# `migrate.run_migrations_with_lock` / `migrate.automigrate_enabled` and
# have the lifespan see the patched values.
from .db import migrate
from .db.session import get_engine
from .routes import (
    cache as cache_route,
)
from .routes import (
    changelog,
    export,
    lookup,
    overrides,
    parse,
    runs,
    set_cards,
    sets,
)

# Configure logging so our `_log.info(...)` calls actually reach
# stdout/stderr. Without this, Python's default behavior is to only emit
# WARNING and above through the "last resort" handler — every
# `_log.info("... warm complete: ...")` from the warm bootstraps gets
# silently dropped, which is why Render's log stream showed no signal
# even when the warmers were running successfully. uvicorn doesn't help:
# it configures its own `uvicorn.*` loggers but leaves the root
# untouched.
#
# Two distinct cases to handle, explicitly:
#
# 1. **Fresh root** (production: a clean uvicorn boot has no root
#    handlers). Run `basicConfig` to add a StreamHandler at INFO so our
#    messages reach stderr. Format mirrors uvicorn's own log line so the
#    streams interleave cleanly in Render. The explicit
#    `hasHandlers()` guard is equivalent to `basicConfig`'s internal
#    no-op-when-handlers-exist behavior, but spelling it out makes the
#    two-case story readable.
#
# 2. **Pre-configured root** (pytest's log capture, custom uvicorn
#    `--log-config`, or any parent process that touched logging first).
#    Root already has a handler — but it almost certainly has the
#    default WARNING level, so a `_log.info(...)` against that root
#    would still drop. Explicit `_log.setLevel(INFO)` on the
#    `api.main` logger rescues this without disturbing whatever the
#    caller set up for root. Runs unconditionally because it's the
#    load-bearing line for both cases.
if not logging.getLogger().hasHandlers():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

_log = logging.getLogger(__name__)
_log.setLevel(logging.INFO)

_WARM_ON_STARTUP_ENV = "MGZ_PKMN_WARM_ON_STARTUP"
# Separate env var for the per-card structural warm pass (Phase 1 of #368)
# because it's much heavier than the existing three — a full pass writes
# ~18,000 per-card cache entries. Opt-in only; default off so a generic
# `MGZ_PKMN_WARM_ON_STARTUP=1` deploy doesn't accidentally trip it.
_WARM_CARDS_ON_STARTUP_ENV = "MGZ_PKMN_WARM_CARDS_ON_STARTUP"


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


def _warm_sets_in_background() -> None:
    """Run the set-image (logos + symbols) warm pass on a daemon thread.

    Mirrors the concept and set-cards warmers. Gated by the on-disk
    `sets_warm.json` freshness manifest — if a warm pass landed within
    the last week, skip and log "already fresh". Errors are logged and
    swallowed so a failed warm doesn't crash the service.

    This bootstrap is what replaces the build-time `pkmn cache warm-sets`
    step that used to live in the Dockerfile. With #369 dropping the
    bake, set logos and symbols are warmed at runtime onto the persistent
    disk — meaning a single warm pass after the first deploy serves
    every subsequent deploy until the manifest's TTL expires."""
    if disk_cache.sets_warm_is_fresh():
        _log.info("sets cache fresh; skipping startup warm")
        return

    def _run() -> None:
        try:
            pkmn = TCGClient(api_key=os.environ.get("POKEMONTCG_IO_API_KEY"))
            result = warm_set_images(pkmn)
            disk_cache.write_sets_warm(
                sets_warmed=result.sets,
                logos_cached=result.logos_cached,
                symbols_cached=result.symbols_cached,
                failures=result.failures,
            )
            _log.info(
                "sets warm complete: %d sets · %d logos · %d symbols · %d failures",
                result.sets,
                result.logos_cached,
                result.symbols_cached,
                result.failures,
            )
        except Exception:
            _log.exception("sets warm failed; service running without primed set images")

    threading.Thread(target=_run, name="sets-warm", daemon=True).start()


def _warm_cards_in_background() -> None:
    """Run the per-card structural warm pass on a daemon thread.

    Phase 1 of the pre-Scrydex catalog-warm epic (#368). Gated by the
    on-disk `card_warm.json` freshness manifest — if a warm pass landed
    within the last week, skip and log "already fresh". Errors are
    logged and swallowed so a failed warm doesn't crash the service.

    Heavyweight relative to the other three warmers: a fresh pass writes
    one cache entry per card across the full English catalog
    (~18,000 entries). Always opt-in via the separate
    `MGZ_PKMN_WARM_CARDS_ON_STARTUP` env var so a generic
    `MGZ_PKMN_WARM_ON_STARTUP=1` flag doesn't accidentally trigger it."""
    if disk_cache.card_warm_is_fresh():
        _log.info("card cache fresh; skipping startup warm")
        return

    # Throttle the startup warm so a no-API-key deploy doesn't burst
    # through pokemontcg.io's 30-rpm free-tier ceiling, hit 429s, end up
    # with mostly-empty pages, and write a partially-warmed manifest
    # that the freshness gate then trusts for a week. With an API key
    # the throttle is harmless overhead; without one, it's the
    # difference between a successful pass and a poisoned manifest.
    # 500 ms x ~170 sets ~= 1.5 minutes of throttle overhead per fresh
    # pass — negligible against the 1-week stale window.
    _DEFAULT_STARTUP_THROTTLE_MS = 500

    def _run() -> None:
        try:
            pkmn = TCGClient(api_key=os.environ.get("POKEMONTCG_IO_API_KEY"))
            result = warm_cards(pkmn, throttle_ms=_DEFAULT_STARTUP_THROTTLE_MS)
            disk_cache.write_card_warm(
                cards_warmed=result.cards_warmed,
                cards_failed=result.cards_failed,
                sets_attempted=result.sets_attempted,
                sets_failed=result.sets_failed,
            )
            _log.info(
                "card warm complete: %d cards warmed across %d sets "
                "(%d cards failed, %d sets missed)",
                result.cards_warmed,
                result.sets_attempted,
                result.cards_failed,
                len(result.sets_failed),
            )
        except Exception:
            _log.exception("card warm failed; service running without primed per-card entries")

    threading.Thread(target=_run, name="card-warm", daemon=True).start()


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


def _warm_on_startup_enabled() -> bool:
    """True when `MGZ_PKMN_WARM_ON_STARTUP` is set to a truthy value.

    Centralised so the lifespan hook and any future caller (tests, an
    admin endpoint) share the same parse rules instead of re-implementing
    them inline.
    """
    return os.environ.get(_WARM_ON_STARTUP_ENV, "").strip() in ("1", "true", "True")


def _warm_cards_on_startup_enabled() -> bool:
    """True when `MGZ_PKMN_WARM_CARDS_ON_STARTUP` is set to a truthy value.

    Same parse rules as `_warm_on_startup_enabled`. Separate env var (and
    default-off) because the per-card warm pass is heavyweight (~18,000
    cache entries on a fresh disk) and we don't want it firing implicitly
    every time someone flips on the standard `MGZ_PKMN_WARM_ON_STARTUP`."""
    return os.environ.get(_WARM_CARDS_ON_STARTUP_ENV, "").strip() in ("1", "true", "True")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Startup/shutdown hook.

    On startup, in order:

    1. Runs `alembic upgrade head` against the configured DB under a
       cross-worker lock (see ADR-0013 and `api.db.migrate`). Set
       `MGZ_PKMN_AUTOMIGRATE=0` to skip — useful when migrations are run
       as a prestart step instead (init containers, Render pre-deploy,
       etc.).
    2. If `MGZ_PKMN_WARM_ON_STARTUP` is truthy (`1`, `true`, or `True`
       — see `_warm_on_startup_enabled`), kicks off the concept,
       set-cards, and set-image warm passes on background daemon threads
       so first-use lookups land on a warm cache. Each warmer has its
       own freshness manifest (24 h concepts / 1 week set-cards / 1
       week sets), so containers starting within the window skip the
       re-walk and log "already fresh". These were previously wired via
       `@app.on_event("startup")` but Starlette silently drops
       `on_event` handlers when a custom `lifespan` is provided (see
       #367), so the warm pass never fired on a deployed instance —
       visible as `concept_warm_timestamp` / `set_cards_warm_timestamp`
       staying `null` on `GET /api/v1/cache/stats` despite the env var
       being set. The sets-warm slice was added in #369 to replace the
       Dockerfile's build-time `pkmn cache warm-sets` step.
    3. If `MGZ_PKMN_WARM_CARDS_ON_STARTUP` is truthy (see
       `_warm_cards_on_startup_enabled`), additionally kicks off the
       per-card structural warm pass on a background daemon thread.
       Separate env var because it's heavier than the other three
       (~18k cache entries on a fresh disk) and we don't want it
       implicitly enabled by the standard `MGZ_PKMN_WARM_ON_STARTUP`
       flag. Phase 1 of the pre-Scrydex catalog-warm epic (#368).
    """
    if migrate.automigrate_enabled():
        try:
            migrate.run_migrations_with_lock(get_engine())
        except Exception:
            _log.exception("Alembic upgrade failed during startup")
            raise
    else:
        _log.info("MGZ_PKMN_AUTOMIGRATE=0 — skipping startup migrations")

    if _warm_on_startup_enabled():
        _warm_concepts_in_background()
        _warm_set_cards_in_background()
        _warm_sets_in_background()

    # Independent opt-in: the per-card structural warm is heavy enough
    # (~18k cache entries on a fresh disk) that it gets its own env var
    # rather than riding the standard MGZ_PKMN_WARM_ON_STARTUP flag.
    if _warm_cards_on_startup_enabled():
        _warm_cards_in_background()

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

app.include_router(parse.router, prefix="/api/v1", tags=["parse"])
app.include_router(lookup.router, prefix="/api/v1", tags=["lookup"])
app.include_router(export.router, prefix="/api/v1", tags=["export"])
app.include_router(sets.router, prefix="/api/v1", tags=["sets"])
app.include_router(set_cards.router, prefix="/api/v1", tags=["set-cards"])
app.include_router(overrides.router, prefix="/api/v1", tags=["overrides"])
app.include_router(changelog.router, prefix="/api/v1", tags=["changelog"])
app.include_router(runs.router, prefix="/api/v1", tags=["runs"])
app.include_router(cache_route.router, prefix="/api/v1", tags=["cache"])


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
