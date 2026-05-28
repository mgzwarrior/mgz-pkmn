"""GET /api/v1/changelog — structured release notes parsed from CHANGELOG.md.

Single source of truth for "what's new" surfaces. Both the marketing site
(at build time) and the demo SPA (at runtime) consume this instead of
duplicating release prose. Parsing lives in `mgz_pkmn.changelog`; this route
locates the repo's `CHANGELOG.md`, parses it, and serializes the result.

The file is read fresh per request (it's tiny — a few KB) but the response
carries a 1-hour `Cache-Control` so the browser / build cache skips the
round-trip; the changelog only changes on a release commit.
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response

from mgz_pkmn.changelog import parse_changelog

router = APIRouter()

# CHANGELOG.md lives at the repo root: api/routes/changelog.py → parents[2].
# In the Docker single-unit image the layout is preserved (WORKDIR /app,
# api/ at /app/api/, CHANGELOG.md copied to /app/CHANGELOG.md), so the same
# relative walk resolves in both dev and prod.
_CHANGELOG_PATH = Path(__file__).resolve().parents[2] / "CHANGELOG.md"

# Browser / build-cache TTL. The changelog only changes on a release commit,
# so an hour is comfortably conservative.
_BROWSER_TTL = 3600


@router.get("/changelog")
def get_changelog(
    response: Response,
    limit: int | None = Query(
        default=None,
        ge=1,
        le=100,
        description="Cap the number of releases returned (newest first).",
    ),
    include_unreleased: bool = Query(
        default=False,
        description="Include the in-flight [Unreleased] section.",
    ),
) -> dict:
    """Return parsed release notes, newest first.

    By default the in-flight `[Unreleased]` section is omitted (public
    "what's new" surfaces want shipped releases); pass
    `include_unreleased=true` for the full picture. `limit` caps the count
    *after* the unreleased filter, so `limit=1` reliably returns the most
    recent shipped release.
    """
    if not _CHANGELOG_PATH.is_file():
        # Misconfigured deploy (CHANGELOG.md not shipped). Surface it loudly
        # rather than returning a silently-empty list a caller might cache.
        raise HTTPException(status_code=404, detail="changelog not available")

    releases = parse_changelog(_CHANGELOG_PATH.read_text(encoding="utf-8"))
    if not include_unreleased:
        releases = [r for r in releases if not r.is_unreleased]
    if limit is not None:
        releases = releases[:limit]

    response.headers["Cache-Control"] = f"public, max-age={_BROWSER_TTL}"
    return {"releases": [asdict(r) for r in releases]}
