"""GET /api/v1/set-cards.pdf — printable set identification cards.

Fetches every Pokémon TCG set from pokemontcg.io, renders one card-sized
cutout per set (3x3 grid on Letter, sized for a 9-pocket binder sheet),
and streams the PDF back."""

from __future__ import annotations

import io
import tempfile
from pathlib import Path

import requests
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from mgz_pkmn.set_cards import fetch_all_sets, write_set_cards_pdf
from mgz_pkmn.sources import TCGClient

router = APIRouter()

# Logos are cached on disk across requests so we don't re-download the entire
# set catalog every time someone hits this endpoint. Shared with the CLI's
# default `--logos-dir` only when the API runs as the same user — otherwise
# each gets its own cache, which is fine.
_LOGOS_CACHE_DIR = Path("~/.cache/mgz-pkmn/set-logos").expanduser()


@router.get("/set-cards.pdf")
async def get_set_cards_pdf(
    api_key: str | None = None,
    no_images: bool = False,
) -> StreamingResponse:
    """Return a PDF of printable set identification cutouts.

    Pass `api_key` as a query parameter to authenticate the upstream
    pokemontcg.io request (otherwise the public rate limit applies).
    Pass `no_images=true` to skip logo downloads and render text-only
    cutouts — much faster on a cold cache."""
    content = await run_in_threadpool(_render, api_key, no_images)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=set-cards.pdf"},
    )


def _render(api_key: str | None, no_images: bool) -> bytes:
    client = TCGClient(api_key=api_key)
    try:
        sets = fetch_all_sets(client)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"upstream fetch failed: {exc}") from exc
    if not sets:
        raise HTTPException(status_code=502, detail="pokemontcg.io returned no sets")
    logos_dir = None if no_images else _LOGOS_CACHE_DIR
    session = None if no_images else client.session
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / "set-cards.pdf"
        write_set_cards_pdf(sets, out_path, logos_dir=logos_dir, session=session)
        return out_path.read_bytes()
