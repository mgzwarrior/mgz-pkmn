"""Pricing extraction + comp generation."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from statistics import median
from typing import Any

# The price sources a `Pricing.source` may name. pokemontcg.io exposes
# tcgplayer + cardmarket; pricecharting is the URL-hint path; ebay_active /
# ebay_sold come from the eBay Browse / Marketplace-Insights adapter
# (`sources.ebay_client`). Documentation-only — the pipeline fails soft on an
# unknown source rather than validating against this set.
PRICE_SOURCES = (
    "tcgplayer",
    "cardmarket",
    "pricecharting",
    "ebay_active",
    "ebay_sold",
)

# Variants we look at when picking a market price, in preference order.
PRICE_VARIANT_PREFERENCE = (
    "holofoil",
    "1stEditionHolofoil",
    "unlimitedHolofoil",
    "normal",
    "1stEdition",
    "unlimited",
    "reverseHolofoil",
)

# Comps shown alongside market price (for negotiating at the table).
COMP_PERCENTS = (80, 85, 90, 95)


@dataclass
class Pricing:
    market: float | None = None
    variant: str | None = None
    source: str | None = None  # one of PRICE_SOURCES
    url: str | None = None
    currency: str = "USD"
    # Optional browser-side condition pricing (#270). `market` remains the
    # raw near-mint reference; exports can carry an adjusted value alongside it.
    condition: str | None = None
    condition_multiplier: float | None = None
    adjusted_market: float | None = None
    # eBay listing-comp signals carried alongside the primary market price:
    # the median of recent sold comps and the lowest current active listing.
    # Both stay None until the eBay source contributes (see summarize_ebay_comps).
    ebay_sold_median: float | None = None
    ebay_active_floor: float | None = None
    # Manual per-row correction (#266) — "for this row, use $X regardless of
    # what the source returned." Takes priority over both `market` and
    # `condition`-adjusted pricing everywhere a writer reads a basis price.
    pricing_override: float | None = None

    @property
    def market_or_override(self) -> float | None:
        """Raw market price, or the user's manual override when set (#266)."""
        return self.pricing_override if self.pricing_override is not None else self.market

    @property
    def effective_market(self) -> float | None:
        """Market value writers should use for buyer-facing comps."""
        if self.pricing_override is not None:
            return self.pricing_override
        return self.adjusted_market if self.adjusted_market is not None else self.market


def summarize_ebay_comps(comps: Iterable[Pricing]) -> tuple[float | None, float | None]:
    """Reduce eBay comps into (median sold, active floor).

    Takes the ``ebay_sold`` / ``ebay_active`` ``Pricing`` entries the eBay
    adapter (`sources.ebay_client.EbayClient.fetch_comps`) returns and folds
    them into the two scalar signals the serializers carry: the median of the
    sold prices and the floor (cheapest) of the active listings. Either is
    ``None`` when that tier contributed no priced comps.
    """
    sold = [c.market for c in comps if c.source == "ebay_sold" and c.market is not None]
    active = [c.market for c in comps if c.source == "ebay_active" and c.market is not None]
    median_sold = round(median(sold), 2) if sold else None
    active_floor = round(min(active), 2) if active else None
    return median_sold, active_floor


def _pricing_from_pricecharting(card: dict[str, Any]) -> Pricing | None:
    # PriceCharting (when matched via a URL hint) takes priority since the
    # user explicitly chose that page. "Loose" / used is the negotiation tier.
    pc_prices = card.get("_pc_prices") or {}
    if not pc_prices:
        return None
    pc_url = card.get("_pc_url")
    for label in ("used", "new", "graded"):
        value = pc_prices.get(label)
        if value:
            return Pricing(
                market=float(value),
                variant=label,
                source="pricecharting",
                url=pc_url,
                currency="USD",
            )
    return None


def _tcgplayer_variant_order(prices: dict[str, Any], variant_hint: str | None) -> list[str]:
    # Explicit hint first, then the preference list, then any remaining variants.
    order: list[str] = []
    if variant_hint and variant_hint in prices:
        order.append(variant_hint)
    for v in PRICE_VARIANT_PREFERENCE:
        if v in prices and v not in order:
            order.append(v)
    for v in prices:
        if v not in order:
            order.append(v)
    return order


def _pricing_from_tcgplayer(tcg: dict[str, Any], variant_hint: str | None) -> Pricing | None:
    prices = tcg.get("prices") or {}
    url = tcg.get("url")
    for v in _tcgplayer_variant_order(prices, variant_hint):
        bucket = prices.get(v) or {}
        market = bucket.get("market") or bucket.get("mid") or bucket.get("low")
        if market:
            return Pricing(market=float(market), variant=v, source="tcgplayer", url=url)
    return None


def _pricing_from_cardmarket(cm: dict[str, Any], fallback_url: str | None) -> Pricing | None:
    cm_prices = cm.get("prices") or {}
    cm_url = cm.get("url")
    cm_currency = cm.get("_currency", "EUR")
    for key in ("averageSellPrice", "trendPrice", "avg7", "avg30"):
        if cm_prices.get(key):
            return Pricing(
                market=float(cm_prices[key]),
                variant=key,
                source="cardmarket",
                url=cm_url or fallback_url,
                currency=cm_currency,
            )
    return None


def extract_pricing(card: dict[str, Any], variant_hint: str | None) -> Pricing:
    """Resolve a `Pricing` from a card, walking sources in priority order.

    PriceCharting (explicit URL hint) wins, then TCGPlayer, then Cardmarket;
    a bare `Pricing` carrying whatever store URL we have is the floor."""
    tcg = card.get("tcgplayer") or {}
    cm = card.get("cardmarket") or {}
    tcg_url = tcg.get("url")
    return (
        _pricing_from_pricecharting(card)
        or _pricing_from_tcgplayer(tcg, variant_hint)
        or _pricing_from_cardmarket(cm, fallback_url=tcg_url)
        or Pricing(url=tcg_url or cm.get("url"))
    )
