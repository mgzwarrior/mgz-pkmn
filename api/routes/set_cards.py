"""GET /api/v1/set-cards.pdf — printable set identification cards.

Fetches every Pokémon TCG set from pokemontcg.io, renders one card-sized
cutout per set (3x3 grid on Letter, sized for a 9-pocket binder sheet),
and streams the PDF back. Pass `set_ids` (repeatable) to restrict the
PDF to a subset of sets — the SPA's set picker modal uses this filter."""

from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Annotated

import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from mgz_pkmn.set_cards import fetch_all_sets, filter_sets_by_ids, write_set_cards_pdf
from mgz_pkmn.sources import TCGClient

router = APIRouter()


@router.get("/set-cards.pdf")
async def get_set_cards_pdf(
    api_key: str | None = None,
    no_images: bool = False,
    # Repeatable query param: ?set_ids=sv8&set_ids=sv7 picks just those
    # sets. Empty list means "every set" — preserves the historical
    # default behavior.
    set_ids: Annotated[list[str], Query()] = [],  # noqa: B006  # FastAPI binding
) -> StreamingResponse:
    """Return a PDF of printable set identification cutouts.

    Pass `api_key` as a query parameter to authenticate the upstream
    pokemontcg.io request (otherwise the public rate limit applies).
    Pass `no_images=true` to skip logo downloads and render text-only
    cutouts — much faster on a cold cache. Pass `set_ids` (repeatable)
    to restrict the output to specific sets; omit to render every set."""
    content = await run_in_threadpool(_render, api_key, no_images, tuple(set_ids))
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=set-cards.pdf"},
    )


def _render(api_key: str | None, no_images: bool, set_ids: tuple[str, ...]) -> bytes:
    client = TCGClient(api_key=api_key)
    try:
        sets = fetch_all_sets(client)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"upstream fetch failed: {exc}") from exc
    if not sets:
        raise HTTPException(status_code=502, detail="pokemontcg.io returned no sets")
    if set_ids:
        sets = filter_sets_by_ids(sets, set_ids)
        if not sets:
            # 404 — every requested id was unknown or stale (typo, set
            # removed from the upstream catalog, etc.). Note that this
            # is NOT the picker's "nothing selected" state: the SPA
            # blocks empty selection client-side, so an empty filter
            # never reaches this branch. Returning a zero-page PDF for
            # unknown ids would be confusing; the 404 lets the CLI fail
            # loudly as a ClickException and lets the SPA surface the
            # detail message verbatim.
            raise HTTPException(
                status_code=404,
                detail=f"no sets matched the requested ids: {', '.join(set_ids)}",
            )
    # Logo storage now flows entirely through the unified disk image cache
    # under `cache/images/sets/`, shared with the CLI. We pass `session` so
    # the writer can fetch on a miss; no `logos_dir` is needed (the cache
    # path is fixed and resolved internally).
    session = None if no_images else client.session
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / "set-cards.pdf"
        write_set_cards_pdf(sets, out_path, session=session)
        return out_path.read_bytes()
