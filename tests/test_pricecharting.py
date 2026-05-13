from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn.sources.pricecharting import PriceChartingClient, _scrape_pricecharting

_HTML_TEMPLATE = """
<html>
<head><meta property="og:title" content="{title}" /></head>
<body>
<div class="cover"><a href="#"><img src='https://storage.googleapis.com/images.pricecharting.com/abc/240.jpg' /></a></div>
<td id="used_price"><span class="price js-price">$5.44</span></td>
<td id="new_price"><span class="price js-price">$10.00</span></td>
<td id="graded_price"><span class="price js-price">$50.00</span></td>
</body></html>
"""


class PriceChartingScrapeTests(unittest.TestCase):
    def test_id_includes_set_slug_to_avoid_collision(self) -> None:
        # Two pages with the same card slug (`penny-239`) but different sets
        # must produce different ids — otherwise download_image's filename
        # cache reuses the wrong image on the second card.
        sv_html = _HTML_TEMPLATE.format(title="Penny #239 Scarlet &amp; Violet")
        paf_html = _HTML_TEMPLATE.format(title="Penny #239 Paldean Fates")
        sv = _scrape_pricecharting(
            sv_html, "https://www.pricecharting.com/game/pokemon-scarlet-&-violet/penny-239"
        )
        paf = _scrape_pricecharting(
            paf_html, "https://www.pricecharting.com/game/pokemon-paldean-fates/penny-239"
        )
        self.assertNotEqual(sv["id"], paf["id"])
        self.assertEqual(sv["id"], "pricecharting:pokemon-scarlet-&-violet/penny-239")
        self.assertEqual(paf["id"], "pricecharting:pokemon-paldean-fates/penny-239")

    def test_image_url_upgraded_to_high_res(self) -> None:
        result = _scrape_pricecharting(
            _HTML_TEMPLATE.format(title="x"),
            "https://www.pricecharting.com/game/pokemon-base-set/charizard-4",
        )
        self.assertIn("/1600.jpg", result["images"]["large"])

    def test_name_strips_number_and_set_from_title(self) -> None:
        # PriceCharting og:title is formatted "<Name> #<Num> <Set>". The
        # scraped name must be just "<Name>" so the PDF caption doesn't
        # double up on info that already lives on the number/set lines.
        result = _scrape_pricecharting(
            _HTML_TEMPLATE.format(title="Penny #239 Paldean Fates"),
            "https://www.pricecharting.com/game/pokemon-paldean-fates/penny-239",
        )
        self.assertEqual(result["name"], "Penny")

    def test_name_strips_alphanumeric_set_codes(self) -> None:
        # Promo / trainer-gallery numbers can be alphanumeric (SV20, TG01).
        result = _scrape_pricecharting(
            _HTML_TEMPLATE.format(title="Iono #SV20 Scarlet & Violet Promo"),
            "https://www.pricecharting.com/game/pokemon-promo/iono-sv20",
        )
        self.assertEqual(result["name"], "Iono")

    def test_pricecharting_card_marked_english(self) -> None:
        result = _scrape_pricecharting(
            _HTML_TEMPLATE.format(title="Charizard #4 Base Set"),
            "https://www.pricecharting.com/game/pokemon-base-set/charizard-4",
        )
        self.assertEqual(result["language"], "en")

    def test_pricecharting_chinese_url_slug_tags_language(self) -> None:
        # Calvin's Cubone Chinese SIR — the URL slug is the only evidence of
        # the card's language; the product page is still English text.
        result = _scrape_pricecharting(
            _HTML_TEMPLATE.format(title="Cubone #407 Gem Pack Vol 3"),
            "https://www.pricecharting.com/game/pokemon-chinese-gem-pack-3/cubone-407",
        )
        self.assertEqual(result["language"], "zh-cn")


class PriceChartingFetchErrorTests(unittest.TestCase):
    """`PriceChartingClient.fetch` must wrap scrape failures in a MatchResult
    so the CLI can name the URL instead of surfacing a raw `requests.HTTPError`
    or pretending the card simply wasn't found."""

    URL = "https://www.pricecharting.com/game/pokemon-base-set/charizard-4"

    def _fetch_with_exception(self, exc: Exception) -> object:
        client = PriceChartingClient()
        with patch.object(client.session, "get", side_effect=exc):
            return client.fetch(self.URL)

    def test_http_404_returns_scrape_failed(self) -> None:
        resp = requests.Response()
        resp.status_code = 404
        result = self._fetch_with_exception(requests.HTTPError(response=resp))
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "scrape_failed")
        self.assertEqual(result.url, self.URL)

    def test_http_500_returns_scrape_failed(self) -> None:
        resp = requests.Response()
        resp.status_code = 500
        result = self._fetch_with_exception(requests.HTTPError(response=resp))
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "scrape_failed")
        self.assertEqual(result.url, self.URL)

    def test_connection_error_returns_scrape_failed(self) -> None:
        result = self._fetch_with_exception(requests.ConnectionError("boom"))
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "scrape_failed")
        self.assertEqual(result.url, self.URL)

    def test_successful_fetch_returns_matched(self) -> None:
        client = PriceChartingClient()
        # Prime the in-memory cache so fetch never touches the network.
        client._cache[self.URL] = _HTML_TEMPLATE.format(title="Charizard #4 Base Set")
        result = client.fetch(self.URL)
        self.assertEqual(result.reason, "matched")
        self.assertIsNotNone(result.card)
        self.assertEqual(result.card["name"], "Charizard")


if __name__ == "__main__":
    unittest.main()
