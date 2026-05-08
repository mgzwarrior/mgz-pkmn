"""pokemontcg.io v2 client and Lucene-style search builder."""

from __future__ import annotations

import sys
import time
from typing import Any
from urllib.parse import quote

import requests

from ..parser import CardQuery, strip_noise
from ._common import USER_AGENT
from .base import MatchResult, name_clause, score_card, set_overlap

API_BASE = "https://api.pokemontcg.io/v2"


class TCGClient:
    """Thin wrapper around api.pokemontcg.io with response caching + 429 retry."""

    def __init__(self, api_key: str | None = None, verbose: bool = False) -> None:
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        if api_key:
            self.session.headers["X-Api-Key"] = api_key
        self.verbose = verbose
        self._cache: dict[str, list[dict[str, Any]]] = {}

    def search(self, query: str, page_size: int = 12) -> list[dict[str, Any]]:
        return self._fetch_page(query, page=1, page_size=page_size)

    def search_all(
        self,
        query: str,
        page_size: int = 50,
        max_pages: int = 12,
    ) -> list[dict[str, Any]]:
        """Paginate through every match for `query` (up to max_pages * page_size).

        Necessary for "top N from a set" queries — sets often have 200+ cards
        and the highest-priced chase variants (secret-rare alt arts, hyper
        rares) typically have the highest card numbers, so they fall past
        page 1 of a default-sized search."""
        cache_key = f"all:{query}:{page_size}:{max_pages}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        all_cards: list[dict[str, Any]] = []
        for page in range(1, max_pages + 1):
            data = self._fetch_page(query, page=page, page_size=page_size)
            if not data:
                break
            all_cards.extend(data)
            if len(data) < page_size:
                break  # short page → last page
        self._cache[cache_key] = all_cards
        return all_cards

    def _fetch_page(self, query: str, *, page: int, page_size: int) -> list[dict[str, Any]]:
        cache_key = f"page:{query}:{page}:{page_size}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        url = f"{API_BASE}/cards?q={quote(query)}&pageSize={page_size}&page={page}"
        if self.verbose:
            print(f"  GET {url}", file=sys.stderr)
        # Polite throttle: free tier is 30 rpm without a key. The pokemontcg.io
        # API is occasionally slow on big set queries, so allow a longer
        # per-request timeout and retry transient timeouts.
        for attempt in range(4):
            try:
                resp = self.session.get(url, timeout=60)
                if resp.status_code == 429:
                    time.sleep(2**attempt)
                    continue
                resp.raise_for_status()
                data = resp.json().get("data", [])
                self._cache[cache_key] = data
                return data
            except (requests.Timeout, requests.ConnectionError):
                if attempt == 3:
                    return []  # silently give up on this page rather than crash
                time.sleep(1 + attempt)
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(1 + attempt)
        return []


def search_pokemontcg(client: TCGClient, q: CardQuery) -> MatchResult:
    """Build a sequence of progressively-looser queries against pokemontcg.io
    and pick the best candidate. Returns reason='set_mismatch' if candidates
    exist but none satisfy the user's set hint."""
    primary_name = q.name
    cleaned_name = strip_noise(primary_name)

    queries: list[str] = []

    def _push(name_query: str) -> None:
        if q.number and q.set_hint:
            num = q.number.split("/")[0]
            queries.append(f'{name_query} number:"{num}" set.name:"{q.set_hint}"')
            queries.append(f'{name_query} number:"{num}" set.series:"{q.set_hint}"')
        if q.number:
            num = q.number.split("/")[0]
            queries.append(f'{name_query} number:"{num}"')
        if q.set_hint:
            queries.append(f'{name_query} set.name:"{q.set_hint}"')
            queries.append(f'{name_query} set.series:"{q.set_hint}"')
        queries.append(name_query)

    _push(name_clause(primary_name))
    if cleaned_name and cleaned_name.lower() != primary_name.lower():
        _push(name_clause(cleaned_name))
    head = cleaned_name.split(" ", 1)[0] if cleaned_name else ""
    if head and head.lower() != primary_name.lower():
        queries.append(f"name:{head}*" + (f' set.name:"{q.set_hint}"' if q.set_hint else ""))

    seen: set[str] = set()
    all_candidates: list[dict[str, Any]] = []
    for query in queries:
        if query in seen:
            continue
        seen.add(query)
        candidates = client.search(query)
        if candidates:
            all_candidates = candidates
            break

    if not all_candidates:
        return MatchResult(None, "no_candidates")

    for c in all_candidates:
        c.setdefault("_database", "pokemontcg.io")

    if q.set_hint:
        in_set = [c for c in all_candidates if set_overlap(c, q.set_hint)]
        if not in_set:
            return MatchResult(None, "set_mismatch")
        return MatchResult(max(in_set, key=lambda c: score_card(c, q)), "matched")

    return MatchResult(max(all_candidates, key=lambda c: score_card(c, q)), "matched")
