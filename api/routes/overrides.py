"""POST /api/v1/overrides — manage sticky PriceCharting URL overrides."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from mgz_pkmn import cache as disk_cache

router = APIRouter()


class OverrideRequest(BaseModel):
    name: str
    set: str | None = None
    url: str


@router.post("/overrides")
def create_override(req: OverrideRequest) -> dict:
    """Record a PriceCharting URL override for a (name, set) pair.

    On future lookups the URL is automatically applied so the user only
    needs to paste it once.
    """
    disk_cache.record_url_override(req.name, req.set, req.url)
    return {"status": "ok", "name": req.name, "set": req.set, "url": req.url}


@router.get("/overrides")
def list_overrides() -> dict:
    """Return all recorded URL overrides."""
    overrides = disk_cache._load_overrides()
    return {"overrides": overrides}
