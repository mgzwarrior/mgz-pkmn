"""FastAPI service for mgz-pkmn card lookup.

Run with:
    uvicorn api.main:app --reload --port 8000

Or from inside the api/ directory:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routes import export, lookup, overrides, parse, sets

app = FastAPI(
    title="mgz-pkmn API",
    description="Browser-accessible API for the mgz-pkmn Pokémon card lookup tool.",
    version="0.1.0",
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
app.include_router(overrides.router, prefix="/api/v1", tags=["overrides"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# Serve the built SPA when present (single-unit production deploy). The mount
# lives below the API routes so /api/* and /health continue to win.
_web_dist = Path(__file__).resolve().parent.parent / "web" / "dist"
if _web_dist.is_dir():
    app.mount("/", StaticFiles(directory=_web_dist, html=True), name="web")
