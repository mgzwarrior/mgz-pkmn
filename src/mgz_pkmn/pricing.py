"""Pricing extraction + comp generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

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
    source: str | None = None  # "tcgplayer" | "cardmarket" | "pricecharting"
    url: str | None = None
    currency: str = "USD"


def extract_pricing(card: dict[str, Any], variant_hint: str | None) -> Pricing:
    # PriceCharting (when matched via a URL hint) takes priority since the
    # user explicitly chose that page. "Loose" / used is the negotiation tier.
    pc_prices = card.get("_pc_prices") or {}
    pc_url = card.get("_pc_url")
    if pc_prices:
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

    tcg = card.get("tcgplayer") or {}
    prices = tcg.get("prices") or {}
    url = tcg.get("url")

    # Build the variant search order: explicit hint first, then preferences.
    order: list[str] = []
    if variant_hint and variant_hint in prices:
        order.append(variant_hint)
    for v in PRICE_VARIANT_PREFERENCE:
        if v in prices and v not in order:
            order.append(v)
    for v in prices:
        if v not in order:
            order.append(v)

    for v in order:
        bucket = prices.get(v) or {}
        market = bucket.get("market") or bucket.get("mid") or bucket.get("low")
        if market:
            return Pricing(market=float(market), variant=v, source="tcgplayer", url=url)

    cm = card.get("cardmarket") or {}
    cm_prices = cm.get("prices") or {}
    cm_url = cm.get("url")
    cm_currency = cm.get("_currency", "EUR")
    for key in ("averageSellPrice", "trendPrice", "avg7", "avg30"):
        if cm_prices.get(key):
            return Pricing(
                market=float(cm_prices[key]),
                variant=key,
                source="cardmarket",
                url=cm_url or url,
                currency=cm_currency,
            )

    return Pricing(url=url or cm_url)
