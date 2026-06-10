"""Data-source adapters: pokemontcg.io, TCGdex, PriceCharting, eBay."""

from .ebay import EbayAuthClient, EbayAuthError
from .pokemontcg import TCGClient, search_pokemontcg
from .pricecharting import PriceChartingClient
from .tcgdex import TCGDexClient, search_tcgdex

__all__ = [
    "EbayAuthClient",
    "EbayAuthError",
    "PriceChartingClient",
    "TCGClient",
    "TCGDexClient",
    "search_pokemontcg",
    "search_tcgdex",
]
