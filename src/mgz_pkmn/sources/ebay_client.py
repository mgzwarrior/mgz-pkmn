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

Wiring these comps into the lookup pipeline + export serializers is #423 /
the ensemble work; this module is just the adapter.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any

import requests

from ..pricing import Pricing
from ._common import USER_AGENT
from .ebay import EbayAuthClient, EbayAuthError

_PROD_API_BASE = "https://api.ebay.com"
_SANDBOX_API_BASE = "https://api.sandbox.ebay.com"

_BROWSE_SEARCH_PATH = "/buy/browse/v1/item_summary/search"
_INSIGHTS_SEARCH_PATH = "/buy/marketplace_insights/v1/item_sales/search"

#: Capability flag for the gated sold path.
SOLD_ENABLED_ENV = "MGZ_PKMN_EBAY_SOLD_ENABLED"

#: Titles matching these skew raw-single comps (graded slabs inflate, lots /
#: bundles aren't a single card) — drop them before returning comps.
_EXCLUDE_TITLE_RE = re.compile(r"\b(psa|bgs|cgc|sgc|lot|bundle|playset|x\s?\d)\b", re.IGNORECASE)


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
        """
        comps = self._fetch_active(query, limit=limit)
        if self._sold_enabled:
            comps += self._fetch_sold(query, limit=limit)
        return comps

    def _fetch_active(self, query: str, *, limit: int) -> list[Pricing]:
        url = f"{self.api_base}{_BROWSE_SEARCH_PATH}"
        payload = self._get_json(url, params={"q": query, "limit": limit})
        if payload is None:
            return []
        return self._parse_listings(payload.get("itemSummaries") or [], source="ebay_active")

    def _fetch_sold(self, query: str, *, limit: int) -> list[Pricing]:
        url = f"{self.api_base}{_INSIGHTS_SEARCH_PATH}"
        # Insights access is gated server-side; a 403 here means this app
        # hasn't been granted the API yet — degrade to no sold comps.
        payload = self._get_json(url, params={"q": query, "limit": limit}, soft_statuses=(403,))
        if payload is None:
            return []
        return self._parse_listings(payload.get("itemSales") or [], source="ebay_sold")

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


__all__ = ["SOLD_ENABLED_ENV", "EbayClient"]
