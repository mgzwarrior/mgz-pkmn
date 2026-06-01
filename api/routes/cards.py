"""Per-card HTTP surface — currently just the cached image-serving route.

`GET /api/v1/cards/{card_id}/image/{size}` streams the cached card image
out of the unified disk image cache (see `mgz_pkmn.cache.read_image`).
Returns 404 when the requested card isn't in the cache yet — the
boundary URL-rewriter in `api/routes/lookup.py` and
`api/routes/sets.py` swaps `images.small/large` URLs to this route
only when the file is on disk, so a deployed instance never serves a
broken `<img>` to the SPA: a cache miss means the SPA still sees the
upstream pokemontcg.io URL.

Phase 2 of the pre-Scrydex catalog-warm epic (#368) — partner of the
`pkmn cache warm-card-images` command and the
`MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP=1` runtime hook. See ADR-0014
(if/when written) for the broader self-hosted-images rationale.
"""

from __future__ import annotations

import mimetypes
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from fastapi import Path as PathParam
from fastapi.responses import FileResponse

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.card_images import LARGE_CATEGORY, SMALL_CATEGORY

router = APIRouter()


# Relative-URL template for the boundary rewriter — same-origin so the
# SPA's `<img>` tag picks the right host without us having to thread
# `request.base_url` through every projection. Mirrors how
# `web/src/api/client.ts:setLogoUrl` builds `/api/v1/sets/{id}/logo`.
_CARD_IMAGE_URL_TEMPLATE = "/api/v1/cards/{card_id}/image/{size}"


def rewrite_card_image_urls(card: dict | None, *, card_id: str | None = None) -> dict | None:
    """Return `card` with `images.{large,small}` swapped to the API route
    whenever the underlying file is present on disk.

    Cache miss → returns the upstream URL untouched. That graceful
    degradation matters: a fresh deploy whose warm pass hasn't
    completed yet still serves a working `<img src>` to the SPA, just
    pointed at pokemontcg.io instead of our disk.

    `card_id` defaults to `card['id']`; passing it explicitly avoids
    re-reading the field for callers that already have it. A missing
    id or a `None` card short-circuits to the input unchanged — we
    never invent a route for something we can't address.

    Mutates and returns the same dict (no deep copy) — every caller in
    the boundary already projects card data into a new dict before
    serialising, so the mutation can't leak into shared state."""
    if card is None:
        return None
    images = card.get("images")
    if not isinstance(images, dict):
        return card
    resolved_id = card_id or card.get("id")
    if not resolved_id:
        return card
    rewritten = dict(images)
    for size, category in (("large", LARGE_CATEGORY), ("small", SMALL_CATEGORY)):
        if rewritten.get(size) and disk_cache.read_image(category, resolved_id) is not None:
            rewritten[size] = _CARD_IMAGE_URL_TEMPLATE.format(card_id=resolved_id, size=size)
    card["images"] = rewritten
    return card


# Pokemon TCG card ids are short alphanumeric strings with a `-` between
# the set and the number (e.g. `sv8-1`, `base1-4`). Mirror the set-id
# guard in api/routes/sets.py — same character class, same `max_length`
# upper bound. 96 chars is comfortable headroom over the longest id we
# see today (about 12) and still bounds pathological inputs.
_CARD_ID_PATH = PathParam(pattern=r"^[A-Za-z0-9_-]{1,96}$", max_length=96)

# `large` and `small` are the only two image variants pokemontcg.io
# exposes — keep the path enum tight so a typo gets a 422 with a clear
# error rather than a 404 the operator has to debug.
_SIZE_BY_NAME = {"large": LARGE_CATEGORY, "small": SMALL_CATEGORY}


@router.get("/cards/{card_id}/image/{size}")
async def get_card_image(
    card_id: Annotated[str, _CARD_ID_PATH],
    size: Literal["large", "small"],
) -> FileResponse:
    """Stream the cached card image, or 404 if not cached.

    Reads from `cache/images/cards/{large,small}/<card_id>.<ext>`,
    populated by `pkmn cache warm-card-images` or by the runtime
    on-startup hook (`MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP=1`).
    Strictly a cache reader — never fetches upstream on miss, so a cold
    cache surfaces a clean 404 with a hint about the warmer instead of
    hammering pokemontcg.io's CDN for every image render.
    """
    category = _SIZE_BY_NAME[size]
    path = disk_cache.read_image(category, card_id)
    if path is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"no cached {size} image for card '{card_id}' — "
                "run `pkmn cache warm-card-images` to populate the catalog"
            ),
        )
    # Defense-in-depth: confirm the resolved path is inside the cache
    # root before streaming. `card_id` is already doubly-sanitised
    # (FastAPI path regex + `_safe_image_key` inside `read_image`), so
    # this check should never fire — but it's the canonical CodeQL
    # sanitiser pattern for path-traversal taint analysis, and a
    # 404-on-mismatch leaks no info even if the upstream guards drift.
    cache_root = disk_cache._cache_root_path().resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(cache_root):
        raise HTTPException(status_code=404)
    media_type, _ = mimetypes.guess_type(resolved.name)
    return FileResponse(
        resolved,
        media_type=media_type or "application/octet-stream",
        # 30-day immutable browser cache — card images never change once
        # a set ships. Mirrors `get_set_logo` in api/routes/sets.py.
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )
