"""Tests for the eBay listing-comps adapter (#422).

Mocked-fixture unit tests (the repo's unittest + unittest.mock style; the
sandbox cassette suite is #428). Fixtures encode the real Browse /
Marketplace-Insights response shapes. A fake auth client returns a static
token so the token path never touches the network.
"""

from __future__ import annotations

import io
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn import cache
from mgz_pkmn.sources.ebay_client import EbayClient, ebay_query_for_card


class _FakeAuth:
    """Stand-in EbayAuthClient: hands out a static token, records refreshes."""

    def __init__(self, environment: str = "production", configured: bool = True) -> None:
        self.environment = environment
        self.configured = configured
        self.refresh_calls = 0

    def get_token(self, *, force_refresh: bool = False) -> str:
        if force_refresh:
            self.refresh_calls += 1
            return "REFRESHED"
        return "TOKEN"


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"status {self.status_code}")

    def json(self) -> dict:
        return self._payload


_BROWSE_FIXTURE = {
    "itemSummaries": [
        {
            "itemId": "v1|1|0",
            "title": "Charizard 4/102 Base Set",
            "price": {"value": "250.00", "currency": "USD"},
            "condition": "Used",
            "itemWebUrl": "https://www.ebay.com/itm/1",
        },
        {
            "itemId": "v1|2|0",
            "title": "Charizard PSA 9 Base Set",  # graded → filtered out
            "price": {"value": "1200.00", "currency": "USD"},
            "condition": "Graded",
            "itemWebUrl": "https://www.ebay.com/itm/2",
        },
        {
            "itemId": "v1|3|0",
            "title": "Pokemon Base Set lot of 50 cards",  # lot → filtered out
            "price": {"value": "40.00", "currency": "USD"},
            "itemWebUrl": "https://www.ebay.com/itm/3",
        },
        {
            "itemId": "v1|1|0",  # duplicate itemId → deduped
            "title": "Charizard 4/102 Base Set",
            "price": {"value": "250.00", "currency": "USD"},
            "itemWebUrl": "https://www.ebay.com/itm/1",
        },
        {
            "itemId": "v1|4|0",
            "title": "Charizard 4/102 Base Set near mint",
            "price": {"value": "199.99", "currency": "USD"},
            "itemWebUrl": "https://www.ebay.com/itm/4",
        },
    ]
}

_INSIGHTS_FIXTURE = {
    "itemSales": [
        {
            "itemId": "s1",
            "title": "Charizard 4/102 Base Set",
            "price": {"value": "230.00", "currency": "USD"},
            "itemWebUrl": "https://www.ebay.com/itm/s1",
        }
    ]
}


def _client(**kwargs) -> EbayClient:
    kwargs.setdefault("auth", _FakeAuth())
    return EbayClient(**kwargs)


class _NoCacheTestCase(unittest.TestCase):
    """Bypass the disk cache so these tests exercise the network + parse path
    directly. The per-source caching layer is covered in EbayCacheTests."""

    def setUp(self) -> None:
        self._old_no_cache = os.environ.get(cache._NO_CACHE_ENV)
        os.environ[cache._NO_CACHE_ENV] = "1"

    def tearDown(self) -> None:
        if self._old_no_cache is None:
            os.environ.pop(cache._NO_CACHE_ENV, None)
        else:
            os.environ[cache._NO_CACHE_ENV] = self._old_no_cache


class ActiveCompsTests(_NoCacheTestCase):
    def test_active_listings_become_ebay_active_pricing(self) -> None:
        client = _client()
        with patch.object(client.session, "get", return_value=_FakeResponse(_BROWSE_FIXTURE)):
            comps = client.fetch_comps("Charizard 4/102 Base Set")
        # Graded + lot dropped, duplicate itemId collapsed → 2 comps remain.
        self.assertEqual(len(comps), 2)
        self.assertTrue(all(c.source == "ebay_active" for c in comps))
        self.assertEqual([c.market for c in comps], [250.00, 199.99])
        self.assertEqual(comps[0].url, "https://www.ebay.com/itm/1")
        self.assertEqual(comps[0].currency, "USD")

    def test_marketplace_header_and_bearer_token_sent(self) -> None:
        client = _client()
        with patch.object(
            client.session, "get", return_value=_FakeResponse(_BROWSE_FIXTURE)
        ) as get:
            client.fetch_comps("Charizard")
        _, kwargs = get.call_args
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer TOKEN")
        self.assertEqual(kwargs["headers"]["X-EBAY-C-MARKETPLACE-ID"], "EBAY_US")

    def test_sandbox_environment_targets_sandbox_host(self) -> None:
        client = _client(auth=_FakeAuth(environment="sandbox"))
        self.assertIn("api.sandbox.ebay.com", client.api_base)

    def test_network_error_returns_no_comps(self) -> None:
        client = _client()
        with patch.object(client.session, "get", side_effect=requests.ConnectionError("boom")):
            self.assertEqual(client.fetch_comps("Charizard"), [])

    def test_401_retries_once_with_force_refresh(self) -> None:
        client = _client()
        responses = [_FakeResponse({}, status_code=401), _FakeResponse(_BROWSE_FIXTURE)]
        with patch.object(client.session, "get", side_effect=responses):
            comps = client.fetch_comps("Charizard")
        self.assertEqual(client.auth.refresh_calls, 1)
        self.assertEqual(len(comps), 2)


class UnconfiguredTests(_NoCacheTestCase):
    def test_missing_credentials_disables_source_without_network(self) -> None:
        client = _client(auth=_FakeAuth(configured=False))
        with patch.object(client.session, "get") as get:
            comps = client.fetch_comps("Charizard")
        # No token mint, no network call — the source is simply disabled.
        self.assertEqual(comps, [])
        get.assert_not_called()

    def test_unconfigured_warning_emitted_once(self) -> None:
        client = _client(auth=_FakeAuth(configured=False))
        with patch("sys.stderr", new_callable=io.StringIO) as err:
            client.fetch_comps("Charizard")
            client.fetch_comps("Pikachu")
        # One loud warning across repeated lookups, not one per call.
        self.assertEqual(err.getvalue().count("eBay comps disabled"), 1)


class SoldCompsTests(_NoCacheTestCase):
    def test_sold_disabled_by_default_skips_insights(self) -> None:
        client = _client()
        with patch.object(
            client.session, "get", return_value=_FakeResponse(_BROWSE_FIXTURE)
        ) as get:
            client.fetch_comps("Charizard")
        # Only the Browse endpoint was hit.
        urls = [call.args[0] for call in get.call_args_list]
        self.assertTrue(all("item_summary/search" in u for u in urls))
        self.assertFalse(any("item_sales/search" in u for u in urls))

    def test_sold_enabled_adds_ebay_sold_comps(self) -> None:
        client = _client(sold_enabled=True)

        def _route(url, **_kwargs):
            if "item_sales/search" in url:
                return _FakeResponse(_INSIGHTS_FIXTURE)
            return _FakeResponse(_BROWSE_FIXTURE)

        with patch.object(client.session, "get", side_effect=_route):
            comps = client.fetch_comps("Charizard")
        sources = {c.source for c in comps}
        self.assertEqual(sources, {"ebay_active", "ebay_sold"})
        sold = [c for c in comps if c.source == "ebay_sold"]
        self.assertEqual(sold[0].market, 230.00)

    def test_sold_403_degrades_to_no_sold_comps(self) -> None:
        client = _client(sold_enabled=True)

        def _route(url, **_kwargs):
            if "item_sales/search" in url:
                return _FakeResponse({}, status_code=403)
            return _FakeResponse(_BROWSE_FIXTURE)

        with patch.object(client.session, "get", side_effect=_route):
            comps = client.fetch_comps("Charizard")
        # Active still returned; no sold comps, no raise.
        self.assertTrue(comps)
        self.assertTrue(all(c.source == "ebay_active" for c in comps))


class EbayCacheTests(unittest.TestCase):
    """Per-source TTL caching of eBay comps (#424, ADR-0020). Each test runs
    against a fresh tempdir cache so the first fetch always MISSes."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(cache._NO_CACHE_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(cache._NO_CACHE_ENV, None)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(cache._NO_CACHE_ENV, None)
        else:
            os.environ[cache._NO_CACHE_ENV] = self._old_no_cache
        with cache._inflight_lock:
            cache._inflight_pricing.clear()
        self._tmp.cleanup()

    def _age(self, key: str, seconds: float) -> None:
        """Backdate a cached entry's mtime by `seconds` to force a TTL gate."""
        t = time.time() - seconds
        os.utime(cache._api_pricing_path(key), (t, t))

    def test_miss_fetches_network_then_second_call_hits_cache(self) -> None:
        client = _client()
        with patch.object(
            client.session, "get", return_value=_FakeResponse(_BROWSE_FIXTURE)
        ) as get:
            first = client.fetch_comps("Charizard")
            second = client.fetch_comps("Charizard")
        # Second call served from disk — the network was hit exactly once.
        self.assertEqual(get.call_count, 1)
        self.assertEqual([c.market for c in first], [c.market for c in second])

    def test_active_stale_past_six_hours_spawns_refresh(self) -> None:
        # An entry 7h old is past the active window → STALE → background
        # refresh fires, and the stale comps are still served immediately.
        client = _client()
        key = client._cache_key("ebay_active", "Charizard", 50)
        cache.write_pricing_payload(key, _BROWSE_FIXTURE)
        self._age(key, 7 * 3600)
        with patch.object(cache, "spawn_pricing_refresh", return_value=True) as spawn:
            comps = client.fetch_comps("Charizard")
        self.assertTrue(comps)
        self.assertEqual(spawn.call_count, 1)
        # The refresh writes through the raw-payload writer, not the card split.
        self.assertIs(spawn.call_args.kwargs["writer"], cache.write_pricing_payload)

    def test_sold_still_hits_at_seven_hours_no_network(self) -> None:
        # The same 7h age is a HIT for the sold tier (7d window). With the
        # active entry fresh too, the whole fetch serves from cache.
        client = _client(sold_enabled=True)
        active_key = client._cache_key("ebay_active", "Charizard", 50)
        sold_key = client._cache_key("ebay_sold", "Charizard", 50)
        cache.write_pricing_payload(active_key, _BROWSE_FIXTURE)  # fresh → HIT
        cache.write_pricing_payload(sold_key, _INSIGHTS_FIXTURE)
        self._age(sold_key, 7 * 3600)  # 7h < 7d → still HIT
        with patch.object(client.session, "get") as get:
            comps = client.fetch_comps("Charizard")
        self.assertEqual({c.source for c in comps}, {"ebay_active", "ebay_sold"})
        get.assert_not_called()  # both tiers served from cache


class EbayQueryForCardTests(unittest.TestCase):
    def test_builds_name_set_number_query(self) -> None:
        card = {"name": "Charizard", "set": {"name": "Base Set"}, "number": "4"}
        self.assertEqual(ebay_query_for_card(card), "Charizard Base Set 4")

    def test_omits_missing_parts(self) -> None:
        self.assertEqual(ebay_query_for_card({"name": "Pikachu"}), "Pikachu")

    def test_no_name_yields_empty_query(self) -> None:
        self.assertEqual(ebay_query_for_card({"set": {"name": "Base Set"}, "number": "4"}), "")


class CompsForCardTests(_NoCacheTestCase):
    def test_reduces_active_listings_to_floor(self) -> None:
        client = _client()
        card = {"name": "Charizard", "set": {"name": "Base Set"}, "number": "4"}
        with patch.object(client.session, "get", return_value=_FakeResponse(_BROWSE_FIXTURE)):
            sold, active = client.comps_for_card(card)
        # Sold tier off by default → no median; active floor is the cheapest
        # raw single after graded/lot drops (199.99 < 250.00).
        self.assertIsNone(sold)
        self.assertEqual(active, 199.99)

    def test_sold_enabled_yields_sold_median(self) -> None:
        client = _client(sold_enabled=True)
        card = {"name": "Charizard", "set": {"name": "Base Set"}, "number": "4"}

        def _route(url, **_kwargs):
            if "item_sales/search" in url:
                return _FakeResponse(_INSIGHTS_FIXTURE)
            return _FakeResponse(_BROWSE_FIXTURE)

        with patch.object(client.session, "get", side_effect=_route):
            sold, active = client.comps_for_card(card)
        self.assertEqual(sold, 230.00)
        self.assertEqual(active, 199.99)

    def test_nameless_card_skips_fetch(self) -> None:
        client = _client()
        with patch.object(client.session, "get") as get:
            self.assertEqual(client.comps_for_card({"number": "4"}), (None, None))
        get.assert_not_called()


class BuildRowWiringTests(_NoCacheTestCase):
    """The CLI finalize-pricing site folds eBay comps into the row's Pricing."""

    def test_build_row_attaches_ebay_comps(self) -> None:
        from mgz_pkmn.cli.lookup import _build_row
        from mgz_pkmn.parser import CardQuery

        client = _client()
        card = {"name": "Charizard", "set": {"name": "Base Set"}, "number": "4"}
        with patch.object(client.session, "get", return_value=_FakeResponse(_BROWSE_FIXTURE)):
            row = _build_row(
                card,
                CardQuery(raw="Charizard", name="Charizard"),
                "t1",
                pkmn_client=None,
                images_dir=Path("."),
                no_images=True,
                ebay=client,
            )
        self.assertEqual(row.pricing.ebay_active_floor, 199.99)
        self.assertIsNone(row.pricing.ebay_sold_median)

    def test_build_row_without_ebay_leaves_fields_none(self) -> None:
        from mgz_pkmn.cli.lookup import _build_row
        from mgz_pkmn.parser import CardQuery

        card = {"name": "Charizard", "set": {"name": "Base Set"}, "number": "4"}
        row = _build_row(
            card,
            CardQuery(raw="Charizard", name="Charizard"),
            "t1",
            pkmn_client=None,
            images_dir=Path("."),
            no_images=True,
        )
        self.assertIsNone(row.pricing.ebay_active_floor)
        self.assertIsNone(row.pricing.ebay_sold_median)


if __name__ == "__main__":
    unittest.main()
