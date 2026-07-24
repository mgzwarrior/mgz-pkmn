"""Data-source adapters: pokemontcg.io, TCGdex, PriceCharting, eBay, card shows."""

from .card_shows import CardShow, CardShowProvider, SeedCardShowProvider
from .ebay import EbayAuthClient, EbayAuthError
from .ebay_client import EbayClient
from .pokemontcg import TCGClient, search_pokemontcg
from .pricecharting import PriceChartingClient
from .tcgdex import TCGDexClient, search_tcgdex

__all__ = [
    "CardShow",
    "CardShowProvider",
    "EbayAuthClient",
    "EbayAuthError",
    "EbayClient",
    "PriceChartingClient",
    "SeedCardShowProvider",
    "TCGClient",
    "TCGDexClient",
    "search_pokemontcg",
    "search_tcgdex",
]
