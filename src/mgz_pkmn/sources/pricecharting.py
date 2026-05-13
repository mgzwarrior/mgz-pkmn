"""PriceCharting product-page scraper. Used when the user provides an
explicit URL on the card line."""

from __future__ import annotations

import re
import sys
from typing import Any
from urllib.parse import urlparse

import requests

from ..parser import detect_card_language
from ._common import USER_AGENT
from .base import MatchResult

# Anchor on the <td id="..."> wrapper so the prices come from the right row.
_PC_PRICE_RE_TEMPLATE = r'<td id="{}">.*?<span class="price js-price">\s*\$([\d,.]+)\s*</span>'
_PC_USED_RE = re.compile(_PC_PRICE_RE_TEMPLATE.format("used_price"), re.DOTALL)
_PC_NEW_RE = re.compile(_PC_PRICE_RE_TEMPLATE.format("new_price"), re.DOTALL)
_PC_GRADED_RE = re.compile(_PC_PRICE_RE_TEMPLATE.format("graded_price"), re.DOTALL)
_PC_OG_TITLE_RE = re.compile(r'<meta property="og:title" content="([^"]+)"')
_PC_OG_IMAGE_RE = re.compile(r'<meta property="og:image" content="([^"]+)"')
_PC_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.DOTALL)

# PriceCharting product pages don't expose og:image. The cover image lives at
# storage.googleapis.com/images.pricecharting.com/<hash>/<size>.jpg, where
# <size> is typically 240 (thumb) or 1600 (high-res). We grab the first one
# inside <div class="cover"> and upgrade to /1600.jpg.
_PC_COVER_IMG_RE = re.compile(r'<div class="cover">.*?<img[^>]+src=[\'"]([^\'"]+)[\'"]', re.DOTALL)
_PC_GCS_IMG_RE = re.compile(
    r"https?://storage\.googleapis\.com/images\.pricecharting\.com/[\w-]+/\d+\.(?:jpg|jpeg|png|webp)",
    re.IGNORECASE,
)


class PriceChartingClient:
    """Lightweight scraper for pricecharting.com product pages. We trust the
    user picked the right page and just extract image + prices."""

    def __init__(self, verbose: bool = False) -> None:
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.verbose = verbose
        self._cache: dict[str, str] = {}

    def fetch(self, url: str) -> MatchResult:
        """Scrape a PriceCharting product page.

        Returns `MatchResult(card, "matched")` on success and
        `MatchResult(None, "scrape_failed", url=url)` on HTTP / connection
        error so callers can surface the failing URL instead of treating it
        as a generic "no match".
        """
        if self.verbose:
            print(f"  GET {url}", file=sys.stderr)
        try:
            html = self._cache.get(url)
            if html is None:
                resp = self.session.get(url, timeout=20)
                resp.raise_for_status()
                html = resp.text
                self._cache[url] = html
        except requests.RequestException as exc:
            if self.verbose:
                print(f"  ! pricecharting fetch failed: {exc}", file=sys.stderr)
            return MatchResult(None, "scrape_failed", url=url)
        return MatchResult(_scrape_pricecharting(html, url), "matched")


def _find_pc_image(html: str) -> str | None:
    """Pick the best card image on a PriceCharting product page.

    Order: og:image (rare on PC) → first <img> inside the cover div → first
    pricecharting GCS URL anywhere on the page. Whichever URL we land on, we
    upgrade /240.jpg → /1600.jpg for higher-res spreadsheet thumbnails.
    """
    og = _PC_OG_IMAGE_RE.search(html)
    if og:
        return _upgrade_pc_image(og.group(1))

    cover = _PC_COVER_IMG_RE.search(html)
    if cover:
        return _upgrade_pc_image(cover.group(1))

    any_gcs = _PC_GCS_IMG_RE.search(html)
    if any_gcs:
        return _upgrade_pc_image(any_gcs.group(0))

    return None


def _upgrade_pc_image(url: str) -> str:
    """If the URL is the 240px thumbnail, swap in the 1600px high-res sibling."""
    return re.sub(r"/240\.(jpg|jpeg|png|webp)$", r"/1600.\1", url)


def _scrape_pricecharting(html: str, url: str) -> dict[str, Any]:
    """Parse a PriceCharting product page into our normalized card shape."""
    title_match = _PC_OG_TITLE_RE.search(html) or _PC_H1_RE.search(html)
    title = title_match.group(1) if title_match else None
    if title:
        # H1 fallback contains nested anchor/img markup; strip tags + collapse
        # whitespace, then drop PC's "Prices" suffix.
        title = re.sub(r"<[^>]+>", " ", title)
        title = re.sub(r"\s+", " ", title).strip()
        title = re.sub(r"\s+Prices$", "", title).strip()
        # PriceCharting titles are formatted "<Name> #<Number> <Set>". Strip
        # the number + set suffix so callers (PDF/spreadsheet) get just the
        # card name; the number and set come from the URL path below.
        title = re.sub(r"\s+#\S.*$", "", title).strip()

    image = _find_pc_image(html)

    used = _PC_USED_RE.search(html)
    new = _PC_NEW_RE.search(html)
    graded = _PC_GRADED_RE.search(html)

    def _to_float(m: re.Match[str] | None) -> float | None:
        if not m:
            return None
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            return None

    used_p, new_p, graded_p = _to_float(used), _to_float(new), _to_float(graded)

    parts = urlparse(url).path.strip("/").split("/")
    set_slug = parts[1] if len(parts) > 1 else ""
    card_slug = parts[2] if len(parts) > 2 else ""
    set_name = (
        set_slug.replace("pokemon-", "").replace("-", " ").strip().title() if set_slug else None
    )
    number_match = re.search(r"-(\d+)$", card_slug)
    card_number = number_match.group(1) if number_match else None
    card_name = title or (
        re.sub(r"-\d+$", "", card_slug).replace("-", " ").title() if card_slug else "card"
    )

    # Include the set slug in the id so different PriceCharting pages with the
    # same card slug (e.g. pokemon-scarlet-&-violet/penny-239 vs
    # pokemon-paldean-fates/penny-239) don't collide on the cached image
    # filename. download_image keys off id, so a collision means the second
    # card silently reuses the first's image.
    pc_id = f"{set_slug}/{card_slug}" if set_slug else card_slug
    return {
        "id": f"pricecharting:{pc_id}",
        "name": card_name,
        "number": card_number,
        "rarity": None,
        "set": {"id": set_slug, "name": set_name, "series": None},
        "images": {"large": image, "small": image} if image else {},
        "language": detect_card_language(card_name, set_name=set_name, url=url),
        "_database": "pricecharting",
        "_pc_prices": {"used": used_p, "new": new_p, "graded": graded_p},
        "_pc_url": url,
    }
