"""pokemontcg.io v2 client and Lucene-style search builder."""

from __future__ import annotations

import sys
import time
from typing import Any
from urllib.parse import quote

import requests

from .. import cache as disk_cache
from ..parser import CardQuery, detect_card_language, strip_noise
from ._common import USER_AGENT
from .base import MatchResult, name_clause, score_card, set_overlap, worse_cache_status

API_BASE = "https://api.pokemontcg.io/v2"


class TCGClient:
    """Thin wrapper around api.pokemontcg.io with response caching + 429 retry."""

    def __init__(self, api_key: str | None = None, verbose: bool = False) -> None:
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        if api_key:
            self.session.headers["X-Api-Key"] = api_key
        self.verbose = verbose
        # L1 in-memory cache. Stores (cards, status) — status is the worst
        # disk-cache outcome we observed when first populating this entry,
        # so an L1 hit reports its original L2 freshness instead of falsely
        # promoting STALE/MISS to HIT on the second call within a process.
        self._cache: dict[str, tuple[list[dict[str, Any]], str]] = {}

    def search(self, query: str, page_size: int = 12) -> tuple[list[dict[str, Any]], str]:
        return self._fetch_page(query, page=1, page_size=page_size)

    def search_all(
        self,
        query: str,
        page_size: int = 50,
        max_pages: int = 12,
    ) -> tuple[list[dict[str, Any]], str]:
        """Paginate through every match for `query` (up to max_pages * page_size).

        Necessary for "top N from a set" queries — sets often have 200+ cards
        and the highest-priced chase variants (secret-rare alt arts, hyper
        rares) typically have the highest card numbers, so they fall past
        page 1 of a default-sized search.

        Returns `(cards, status)` where `status` is the worst page-level
        cache outcome across the walk (MISS > STALE > HIT). A single MISS
        page upgrades the whole call's status to MISS."""
        cache_key = f"all:{query}:{page_size}:{max_pages}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        all_cards: list[dict[str, Any]] = []
        status = "HIT"
        for page in range(1, max_pages + 1):
            data, page_status = self._fetch_page(query, page=page, page_size=page_size)
            status = worse_cache_status(status, page_status)
            if not data:
                break
            all_cards.extend(data)
            if len(data) < page_size:
                break  # short page → last page
        self._cache[cache_key] = (all_cards, status)
        return all_cards, status

    def _fetch_page(
        self, query: str, *, page: int, page_size: int
    ) -> tuple[list[dict[str, Any]], str]:
        cache_key = f"page:{query}:{page}:{page_size}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        url = f"{API_BASE}/cards?q={quote(query)}&pageSize={page_size}&page={page}"
        # L2 disk cache (#372 split: structural indefinite, pricing 24h SWR).
        # The in-memory `_cache` above is the L1, but disk persists across
        # runs so iterating on a card list doesn't re-spend API quota for
        # queries we already answered. HIT returns immediately; STALE
        # returns the cached value AND kicks off a background pricing
        # refresh; MISS falls through to the network fetch.
        cached, status = disk_cache.read_api_split(url)
        if cached is not None and status == "HIT":
            if self.verbose:
                print(f"  cached {url}", file=sys.stderr)
            self._cache[cache_key] = (cached, "HIT")
            return cached, "HIT"
        if cached is not None and status == "STALE":
            if self.verbose:
                print(f"  stale {url} (background refresh kicked off)", file=sys.stderr)
            disk_cache.spawn_pricing_refresh(url, lambda u=url: self._refetch_for_pricing(u))
            self._cache[cache_key] = (cached, "STALE")
            return cached, "STALE"
        if self.verbose:
            print(f"  GET {url}", file=sys.stderr)
        data = self._network_fetch(url)
        if data is None:
            # Transient failure already swallowed below; return empty MISS so
            # callers see "no candidates" without poisoning the cache.
            self._cache[cache_key] = ([], "MISS")
            return [], "MISS"
        self._cache[cache_key] = (data, "MISS")
        disk_cache.write_api_split(url, data)
        return data, "MISS"

    def _network_fetch(self, url: str) -> list[dict[str, Any]] | None:
        """Issue the upstream GET with 429-aware retry. Returns the `data`
        array on success, None on a transient failure (timeout / connection
        error after retries). Raises on persistent non-retryable errors."""
        for attempt in range(4):
            try:
                resp = self.session.get(url, timeout=60)
                if resp.status_code == 429:
                    time.sleep(2**attempt)
                    continue
                resp.raise_for_status()
                return resp.json().get("data", [])
            except (requests.Timeout, requests.ConnectionError):
                if attempt == 3:
                    return None
                time.sleep(1 + attempt)
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(1 + attempt)
        return None

    def _refetch_for_pricing(self, url: str) -> list[dict[str, Any]] | None:
        """Closure target for `spawn_pricing_refresh`.

        Re-issues the upstream GET for `url` and returns the fresh `data`
        list. The split-cache write itself happens in
        `disk_cache.write_pricing_only`; this method only owns the fetch."""
        return self._network_fetch(url)


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
    # Track the worst cache status across the queries we actually tried —
    # one MISS anywhere in the fallback chain makes the whole lookup MISS.
    aggregate_status = "HIT"
    for query in queries:
        if query in seen:
            continue
        seen.add(query)
        candidates, status = client.search(query)
        aggregate_status = worse_cache_status(aggregate_status, status)
        if candidates:
            all_candidates = candidates
            break

    if not all_candidates:
        return MatchResult(None, "no_candidates", cache_status=aggregate_status)

    for c in all_candidates:
        c.setdefault("_database", "pokemontcg.io")
        c.setdefault(
            "language",
            detect_card_language(c.get("name"), (c.get("set") or {}).get("name")),
        )

    if q.set_hint:
        in_set = [c for c in all_candidates if set_overlap(c, q.set_hint)]
        if not in_set:
            return MatchResult(None, "set_mismatch", cache_status=aggregate_status)
        return MatchResult(
            max(in_set, key=lambda c: score_card(c, q)),
            "matched",
            cache_status=aggregate_status,
        )

    return MatchResult(
        max(all_candidates, key=lambda c: score_card(c, q)),
        "matched",
        cache_status=aggregate_status,
    )
