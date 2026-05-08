"""Card image download + thumbnail generation."""

from __future__ import annotations

import io
import sys
from pathlib import Path

import requests
from PIL import Image as PILImage

# Thumbnail size used inside the spreadsheet (px). Card aspect ratio is ~2.5:3.5.
THUMB_W, THUMB_H = 96, 134


def download_image(url: str, dest: Path, session: requests.Session) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    try:
        resp = session.get(url, timeout=30)
        resp.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.content)
        return True
    except requests.RequestException as exc:
        print(f"  ! image download failed for {url}: {exc}", file=sys.stderr)
        return False


def make_thumbnail(src: Path, size: tuple[int, int]) -> bytes:
    img = PILImage.open(src)
    img.thumbnail(size, PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
