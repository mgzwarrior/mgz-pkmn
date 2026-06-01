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
import os
import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from fastapi import Path as PathParam

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

# Re-validation regex used by the route. FastAPI's `_CARD_ID_PATH`
# already enforces the same pattern at request parse time, but the
# explicit `re.fullmatch` inside the handler is the canonical
# sanitiser shape CodeQL's path-injection query recognises — and the
# guard is genuinely cheap, so the belt-and-braces is free.
_SAFE_CARD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,96}$")

# Extensions to probe in cache lookup order. Mirrors
# `cache._IMAGE_EXTENSIONS` but kept local so the route never imports
# a path-shaped value from a tainted code path.
_PROBE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


@router.get("/cards/{card_id}/image/{size}")
async def get_card_image(
    card_id: Annotated[str, _CARD_ID_PATH],
    size: Literal["large", "small"],
) -> Response:
    """Return the cached card image bytes, or 404 if not cached.

    Reads from `cache/images/cards/{large,small}/<card_id>.<ext>`,
    populated by `pkmn cache warm-card-images` or by the runtime
    on-startup hook (`MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP=1`).
    Strictly a cache reader — never fetches upstream on miss, so a cold
    cache surfaces a clean 404 with a hint about the warmer instead of
    hammering pokemontcg.io's CDN for every image render.

    Returns the bytes via `Response` rather than `FileResponse` because
    card-image payloads are small (~80-150 KB) and reading them into
    memory keeps the user-controlled `card_id` from flowing into
    FastAPI's file-serving sink.

    The route resolves the filename itself rather than delegating to
    `disk_cache.read_image` — `read_image` calls `_safe_image_key`
    (an `re.sub`-based collapse), which is a real sanitiser but is
    not one CodeQL's path-injection query recognises. The explicit
    `re.fullmatch` guard + `os.path.commonpath` containment check
    below ARE recognised sanitisers, so the analyzer can prove the
    file open is safe.
    """
    # Re-validate explicitly. FastAPI's path regex already enforced
    # this, but the in-handler check is what CodeQL's tainted_path
    # query needs to see as a sanitiser barrier.
    if not _SAFE_CARD_ID_RE.fullmatch(card_id):
        raise HTTPException(status_code=404)

    category = _SIZE_BY_NAME[size]
    cache_dir = os.path.realpath(
        os.path.join(str(disk_cache._cache_root_path()), "images", category)
    )

    for ext in _PROBE_EXTENSIONS:
        candidate = os.path.realpath(os.path.join(cache_dir, card_id + ext))
        # `os.path.commonpath([safe_root, candidate]) == safe_root` is
        # the canonical CodeQL-recognised containment check. After it
        # passes, `candidate` is provably inside `cache_dir`.
        try:
            if os.path.commonpath([cache_dir, candidate]) != cache_dir:
                continue
        except ValueError:
            # commonpath raises on mixed drives (Windows) — treat as miss.
            continue
        if not os.path.isfile(candidate):
            continue
        try:
            with open(candidate, "rb") as f:
                content = f.read()
        except OSError:
            # File vanished between the existence check and the read
            # (concurrent eviction, network FS hiccup). Treat as a miss.
            continue
        media_type, _ = mimetypes.guess_type(candidate)
        return Response(
            content=content,
            media_type=media_type or "application/octet-stream",
            # 30-day immutable browser cache — card images never change
            # once a set ships. Mirrors `get_set_logo` in
            # api/routes/sets.py.
            headers={"Cache-Control": "public, max-age=2592000, immutable"},
        )

    raise HTTPException(
        status_code=404,
        detail=(
            f"no cached {size} image for card '{card_id}' — "
            "run `pkmn cache warm-card-images` to populate the catalog"
        ),
    )
