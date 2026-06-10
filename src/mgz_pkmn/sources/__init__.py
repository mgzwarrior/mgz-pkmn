"""Data-source adapters: pokemontcg.io, TCGdex, PriceCharting, eBay."""

from .ebay import EbayAuthClient, EbayAuthError
from .ebay_client import EbayClient
from .pokemontcg import TCGClient, search_pokemontcg
from .pricecharting import PriceChartingClient
from .tcgdex import TCGDexClient, search_tcgdex

__all__ = [
    "EbayAuthClient",
    "EbayAuthError",
    "EbayClient",
    "PriceChartingClient",
    "TCGClient",
    "TCGDexClient",
    "search_pokemontcg",
    "search_tcgdex",
]
