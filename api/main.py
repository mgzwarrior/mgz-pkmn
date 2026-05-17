"""FastAPI service for mgz-pkmn card lookup.

Run with:
    uvicorn api.main:app --reload --port 8000

Or from inside the api/ directory:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from mgz_pkmn import __version__

from .routes import export, lookup, overrides, parse, set_cards, sets


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


app = FastAPI(
    title="mgz-pkmn API",
    description="Browser-accessible API for the mgz-pkmn Pokémon card lookup tool.",
    version="1.0.0",
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
