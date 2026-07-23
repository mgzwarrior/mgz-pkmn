"""TCGdex multilingual fallback (https://tcgdex.dev)."""

from __future__ import annotations

import sys
import time
from typing import Any
from urllib.parse import quote

import requests

from ..parser import CardQuery, strip_noise
from ._common import USER_AGENT
from .base import MatchResult, rank_candidates, set_overlap

TCGDEX_BASE = "https://api.tcgdex.net/v2"


class TCGDexClient:
    """Two-step lookup: search by name, then hydrate each hit with full card
    details so we can score on set + rarity."""

    def __init__(self, verbose: bool = False, session: requests.Session | None = None) -> None:
        # Injected session keeps the connection pool warm across instances
        # (#302); `_cache` stays instance-local.
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.verbose = verbose
        self._cache: dict[str, Any] = {}

    def _get(self, path: str) -> Any:
        if path in self._cache:
            return self._cache[path]
        url = f"{TCGDEX_BASE}{path}"
        if self.verbose:
            print(f"  GET {url}", file=sys.stderr)
        for attempt in range(3):
            try:
                resp = self.session.get(url, timeout=20)
                if resp.status_code == 404:
                    self._cache[path] = None
                    return None
                if resp.status_code == 429:
                    time.sleep(2**attempt)
                    continue
                resp.raise_for_status()
                data = resp.json()
                self._cache[path] = data
                return data
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(1 + attempt)
        return None

    def search(self, name: str, lang: str = "en", limit: int = 8) -> list[dict[str, Any]]:
        if not name.strip():
            return []
        try:
            hits = self._get(f"/{lang}/cards?name={quote(name)}") or []
        except requests.RequestException:
            return []
        out: list[dict[str, Any]] = []
        for hit in hits[:limit]:
            cid = hit.get("id")
            if not cid:
                continue
            try:
                detail = self._get(f"/{lang}/cards/{cid}") or hit
            except requests.RequestException:
                detail = hit
            out.append(_normalize_tcgdex(detail, lang))
        return out


def _normalize_tcgdex(card: dict[str, Any], lang: str) -> dict[str, Any]:
    """Coerce a TCGdex card payload into the same shape we use for pokemontcg.io."""
    image_base = card.get("image")
    images: dict[str, str] = {}
    if image_base:
        images["large"] = f"{image_base}/high.png"
        images["small"] = f"{image_base}/low.png"

    set_obj = card.get("set") or {}
    pricing = card.get("pricing") or {}

    card_count = set_obj.get("cardCount") or {}
    out_card: dict[str, Any] = {
        "id": f"tcgdex:{lang}:{card.get('id', '')}",
        "name": card.get("name"),
        "number": card.get("localId") or card.get("number"),
        "rarity": card.get("rarity"),
        "set": {
            "id": set_obj.get("id"),
            "name": set_obj.get("name"),
            "series": None,
            "total": card_count.get("total"),
            "printedTotal": card_count.get("official"),
        },
        "images": images,
        "language": lang,
        "_database": f"tcgdex ({lang})",
    }

    cm = pricing.get("cardmarket") or {}
    if cm and (cm.get("avg") or cm.get("trend")):
        out_card["cardmarket"] = {
            "url": (
                f"https://www.cardmarket.com/en/Pokemon/Products/Singles?idProduct={cm['idProduct']}"
                if cm.get("idProduct")
                else None
            ),
            "prices": {
                "averageSellPrice": cm.get("avg"),
                "trendPrice": cm.get("trend"),
                "avg7": cm.get("avg7"),
                "avg30": cm.get("avg30"),
                "lowPrice": cm.get("low"),
            },
            "_currency": cm.get("unit", "EUR"),
        }
    tp = pricing.get("tcgplayer") or {}
    if tp:
        out_card["tcgplayer"] = tp

    return out_card


def search_tcgdex(client: TCGDexClient, q: CardQuery, lang: str) -> MatchResult:
    cleaned_name = strip_noise(q.name)
    name = cleaned_name or q.name
    candidates = client.search(name, lang=lang)
    if not candidates:
        return MatchResult(None, "no_candidates")
    if q.set_hint:
        in_set = [c for c in candidates if set_overlap(c, q.set_hint)]
        if not in_set:
            return MatchResult(None, "set_mismatch")
        ranked = rank_candidates(in_set, q)
        return MatchResult(ranked[0], "matched", candidates=ranked if len(ranked) > 1 else None)
    ranked = rank_candidates(candidates, q)
    return MatchResult(ranked[0], "matched", candidates=ranked if len(ranked) > 1 else None)
