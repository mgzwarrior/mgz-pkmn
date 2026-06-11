"""eBay listing-comps adapter (#422).

Turns a card query into eBay pricing comps for the pricing ensemble
(see [ADR-0020](../../../docs/adr/0020-ebay-pricing-source.md) and
[ADR-0023](../../../docs/adr/0023-source-ensemble-pricing.md)). Mirrors the
client shape of ``pricecharting.py`` / ``pokemontcg.py``: a ``requests``
session, a per-call timeout, and network errors swallowed into an empty
result so a source hiccup never breaks the wider lookup.

Two tiers, both flowing through the existing :class:`~mgz_pkmn.pricing.Pricing`
dataclass as additional sources:

- **Active** (``source="ebay_active"``) — what's listed right now, from the
  **Browse API**. Generally available with the application access token
  :class:`EbayAuthClient` mints.
- **Sold** (``source="ebay_sold"``) — recent sales, from the **Marketplace
  Insights API**. That API is limited-release (separate eBay business
  approval; the legacy ``findCompletedItems`` Finding API was decommissioned
  in early 2025), so the sold path is **gated** behind
  ``MGZ_PKMN_EBAY_SOLD_ENABLED`` (default off) and fails soft on a 403 — it's
  a no-op until access is granted.

Each tier is cached cache-aside in the shared ``api_pricing/`` slice with a
per-source TTL (#424, [ADR-0020](../../../docs/adr/0020-ebay-pricing-source.md)):
sold comps for 7 days, active listings for 6 hours, with stale-while-revalidate
background refresh — the same machinery the pokemontcg.io pricing slice uses
(ADR-0018).

:meth:`EbayClient.comps_for_card` is the lookup pipeline's entry point (#617):
it turns a resolved card into the (sold median, active floor) pair the
``Pricing`` dataclass carries; the CLI and API finalize-pricing sites call it
per resolved card.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any

import requests

from .. import cache as disk_cache
from ..pricing import Pricing, summarize_ebay_comps
from ._common import USER_AGENT
from .ebay import EbayAuthClient, EbayAuthError

_PROD_API_BASE = "https://api.ebay.com"
_SANDBOX_API_BASE = "https://api.sandbox.ebay.com"

_BROWSE_SEARCH_PATH = "/buy/browse/v1/item_summary/search"
_INSIGHTS_SEARCH_PATH = "/buy/marketplace_insights/v1/item_sales/search"

#: Capability flag for the gated sold path.
SOLD_ENABLED_ENV = "MGZ_PKMN_EBAY_SOLD_ENABLED"

#: Operator hint for the unconfigured warning. Spelled out as a literal — these
#: are env-var *names*, never secret values — so the warning doesn't interpolate
#: the secret-suffixed `ebay` constants into a logging sink (a false-positive
#: ``py/clear-text-logging-sensitive-data`` trip).
_UNCONFIGURED_HINT = (
    "set MGZ_PKMN_EBAY_TOKEN, or both MGZ_PKMN_EBAY_CLIENT_ID and "
    "MGZ_PKMN_EBAY_CLIENT_SECRET, to enable"
)

#: Titles matching these skew raw-single comps (graded slabs inflate, lots /
#: bundles aren't a single card) — drop them before returning comps.
_EXCLUDE_TITLE_RE = re.compile(r"\b(psa|bgs|cgc|sgc|lot|bundle|playset|x\s?\d)\b", re.IGNORECASE)


def ebay_query_for_card(card: dict[str, Any]) -> str:
    """Build an eBay keyword query for a resolved card.

    Name + set name + collector number — specific enough to pull raw singles
    of the exact printing without over-constraining the search. Returns an
    empty string when the card has no usable name, which the pipeline treats
    as "no comps to fetch".
    """
    name = (card.get("name") or "").strip()
    if not name:
        return ""
    set_name = ((card.get("set") or {}).get("name") or "").strip()
    number = str(card.get("number") or "").strip()
    return " ".join(part for part in (name, set_name, number) if part)


class EbayClient:
    """Fetches eBay sold + active listing comps for a card query."""

    def __init__(
        self,
        *,
        auth: EbayAuthClient | None = None,
        marketplace_id: str = "EBAY_US",
        sold_enabled: bool | None = None,
        session: requests.Session | None = None,
        verbose: bool = False,
    ) -> None:
        self.auth = auth or EbayAuthClient()
        self.marketplace_id = marketplace_id
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", USER_AGENT)
        self.verbose = verbose
        if sold_enabled is None:
            sold_enabled = os.environ.get(SOLD_ENABLED_ENV, "").strip() in ("1", "true", "True")
        self._sold_enabled = sold_enabled
        self._warned_unconfigured = False

    @property
    def api_base(self) -> str:
        """Browse / Insights host, kept consistent with the token host."""
        return _SANDBOX_API_BASE if self.auth.environment == "sandbox" else _PROD_API_BASE

    def fetch_comps(self, query: str, *, limit: int = 50) -> list[Pricing]:
        """Return deduped, condition-filtered comps for ``query``.

        Always fetches active listings; additionally fetches sold listings
        when the gated sold path is enabled. A network or auth failure on
        either tier yields no comps for that tier rather than raising, so a
        flaky source degrades to "no eBay price" instead of breaking lookup.

        When no eBay credentials are configured the source is disabled
        outright (one loud warning, then silence) rather than minting on
        every call — a missing secret stays a no-op, never a crash (#426).
        """
        if not self.auth.configured:
            self._warn_unconfigured()
            return []
        comps = self._fetch_active(query, limit=limit)
        if self._sold_enabled:
            comps += self._fetch_sold(query, limit=limit)
        return comps

    def comps_for_card(
        self, card: dict[str, Any], *, limit: int = 50
    ) -> tuple[float | None, float | None]:
        """Fetch comps for a resolved card, reduced to (sold median, active floor).

        The lookup pipeline's entry point: turns a resolved card into the two
        scalar signals the :class:`~mgz_pkmn.pricing.Pricing` dataclass carries.
        A card with no name, or a fetch that yields no comps (unconfigured
        source, network hiccup, nothing relevant listed), returns
        ``(None, None)`` — leaving the row's eBay fields blank rather than
        raising.
        """
        query = ebay_query_for_card(card)
        if not query:
            return None, None
        return summarize_ebay_comps(self.fetch_comps(query, limit=limit))

    def _warn_unconfigured(self) -> None:
        """Warn once that eBay comps are off because no credentials are set.

        Loud enough to surface a misconfigured deploy, quiet enough not to
        spam every lookup — unlike the verbose-gated per-fetch diagnostics,
        a missing secret is an operator-facing config error worth one
        unconditional line on stderr.
        """
        if self._warned_unconfigured:
            return
        self._warned_unconfigured = True
        print(f"  ! eBay comps disabled: {_UNCONFIGURED_HINT}", file=sys.stderr)

    def _fetch_active(self, query: str, *, limit: int) -> list[Pricing]:
        return self._fetch_tier(
            query,
            limit=limit,
            source="ebay_active",
            url=f"{self.api_base}{_BROWSE_SEARCH_PATH}",
            results_key="itemSummaries",
        )

    def _fetch_sold(self, query: str, *, limit: int) -> list[Pricing]:
        # Insights access is gated server-side; a 403 here means this app
        # hasn't been granted the API yet — degrade to no sold comps.
        return self._fetch_tier(
            query,
            limit=limit,
            source="ebay_sold",
            url=f"{self.api_base}{_INSIGHTS_SEARCH_PATH}",
            results_key="itemSales",
            soft_statuses=(403,),
        )

    def _fetch_tier(
        self,
        query: str,
        *,
        limit: int,
        source: str,
        url: str,
        results_key: str,
        soft_statuses: tuple[int, ...] = (),
    ) -> list[Pricing]:
        """Cache-aside fetch + parse for one eBay tier (#424, ADR-0020).

        The raw upstream payload is cached in the `api_pricing/` slice with a
        per-source TTL (`pricing_ttl_for_source`): a HIT parses straight from
        disk, a STALE serves the cached payload and kicks off a background
        refresh, and a MISS fetches the network, writes, then parses. The
        cache is transparently bypassed under ``MGZ_PKMN_NO_CACHE`` (the read
        misses and the write is a no-op), so an uncached run behaves exactly
        as before.
        """
        params = {"q": query, "limit": limit}
        cache_key = self._cache_key(source, query, limit)
        ttl = disk_cache.pricing_ttl_for_source(source)
        cached, status = disk_cache.read_pricing_payload(cache_key, ttl_seconds=ttl)
        if status == "STALE":
            if self.verbose:
                print(f"  stale {url} (background refresh kicked off)", file=sys.stderr)
            disk_cache.spawn_pricing_refresh(
                cache_key,
                lambda: self._get_json(url, params=params, soft_statuses=soft_statuses),
                writer=disk_cache.write_pricing_payload,
            )
        elif status == "MISS":
            cached = self._get_json(url, params=params, soft_statuses=soft_statuses)
            if cached is None:
                return []
            disk_cache.write_pricing_payload(cache_key, cached)
        elif self.verbose:
            print(f"  cached {url}", file=sys.stderr)
        return self._parse_listings((cached or {}).get(results_key) or [], source=source)

    def _cache_key(self, source: str, query: str, limit: int) -> str:
        """Stable per-tier cache key. Environment + marketplace keep sandbox /
        production and per-marketplace results from colliding."""
        return f"ebay:{self.auth.environment}:{source}:{self.marketplace_id}:{query}:{limit}"

    def _get_json(
        self,
        url: str,
        *,
        params: dict[str, Any],
        soft_statuses: tuple[int, ...] = (),
    ) -> dict[str, Any] | None:
        """GET ``url`` with the bearer token, retrying once on a 401 with a
        force-refreshed token (the #421 auth seam). Returns parsed JSON, or
        ``None`` on any error / soft status so callers fail soft."""
        try:
            resp = self._authed_get(url, params=params)
            if resp.status_code == 401:
                # Token may have expired mid-flight — re-mint once and retry.
                resp = self._authed_get(url, params=params, force_refresh=True)
            if resp.status_code in soft_statuses:
                if self.verbose:
                    print(f"  ! ebay {resp.status_code} for {url} (soft)", file=sys.stderr)
                return None
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, EbayAuthError, ValueError) as exc:
            if self.verbose:
                print(f"  ! ebay fetch failed: {exc}", file=sys.stderr)
            return None

    def _authed_get(
        self, url: str, *, params: dict[str, Any], force_refresh: bool = False
    ) -> requests.Response:
        token = self.auth.get_token(force_refresh=force_refresh)
        if self.verbose:
            print(f"  GET {url}", file=sys.stderr)
        return self.session.get(
            url,
            params=params,
            headers={
                "Authorization": f"Bearer {token}",
                "X-EBAY-C-MARKETPLACE-ID": self.marketplace_id,
            },
            timeout=20,
        )

    def _parse_listings(self, items: list[dict[str, Any]], *, source: str) -> list[Pricing]:
        """Normalize Browse / Insights items into ``Pricing`` comps, dropping
        graded slabs / lots and de-duplicating on eBay item id."""
        comps: list[Pricing] = []
        seen: set[str] = set()
        for item in items:
            title = item.get("title") or ""
            if _EXCLUDE_TITLE_RE.search(title):
                continue
            price = (item.get("price") or {}).get("value")
            if price is None:
                continue
            try:
                market = float(price)
            except (TypeError, ValueError):
                continue
            dedupe_key = str(item.get("itemId") or f"{title}:{price}")
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            comps.append(
                Pricing(
                    market=market,
                    variant=item.get("condition"),
                    source=source,
                    url=item.get("itemWebUrl"),
                    currency=(item.get("price") or {}).get("currency") or "USD",
                )
            )
        return comps


__all__ = ["SOLD_ENABLED_ENV", "EbayClient", "ebay_query_for_card"]
