from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn import cache
from mgz_pkmn.lookup import (
    _apply_price_bounds,
    _expand_concept,
    _name_token_match,
    _split_evolution_line,
    _subtype_filter,
    find_card,
    find_top_cards,
)
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.sources.base import MatchResult


class _StubTCGClient:
    """Records every query it receives and returns canned cards.

    `cards_by_query` maps a Lucene query string → list of card dicts.
    Anything not in the map returns []. `queries` is the call log so a
    test can assert which API queries were issued."""

    def __init__(self, cards_by_query: dict[str, list[dict]] | None = None) -> None:
        self.cards_by_query = cards_by_query or {}
        self.queries: list[str] = []

    def search_all(self, query: str, **_: object) -> tuple[list[dict], str]:
        self.queries.append(query)
        cards = list(self.cards_by_query.get(query, []))
        # Stub treats every response as a HIT — tests that need a different
        # cache_status override the method on the instance.
        return cards, "HIT"

    def search(self, query: str, **_: object) -> tuple[list[dict], str]:
        return self.search_all(query)


def _card(card_id: str, name: str, market: float, subtypes: list[str] | None = None) -> dict:
    return {
        "id": card_id,
        "name": name,
        "number": "1",
        "set": {"name": "Test Set", "series": "Test Series"},
        "subtypes": subtypes or [],
        "tcgplayer": {"prices": {"holofoil": {"market": market}}},
    }


class SubtypeFilterTests(unittest.TestCase):
    def test_tag_team_maps_to_quoted_subtype(self) -> None:
        self.assertEqual(_subtype_filter("tag team"), 'subtypes:"TAG TEAM"')
        self.assertEqual(_subtype_filter("Tag Team"), 'subtypes:"TAG TEAM"')

    def test_single_word_subtype_unquoted(self) -> None:
        self.assertEqual(_subtype_filter("vmax"), "subtypes:VMAX")
        self.assertEqual(_subtype_filter("gx"), "subtypes:GX")

    def test_unknown_subject_returns_none(self) -> None:
        self.assertIsNone(_subtype_filter("Charizard"))
        # Must be exact equality — `charizard ex` shouldn't trigger the EX subtype.
        self.assertIsNone(_subtype_filter("charizard ex"))


class SplitEvolutionLineTests(unittest.TestCase):
    def test_three_stage_line(self) -> None:
        self.assertEqual(
            _split_evolution_line("Charmander/Charmeleon/Charizard"),
            ["Charmander", "Charmeleon", "Charizard"],
        )

    def test_no_slash_returns_single_element_list(self) -> None:
        self.assertEqual(_split_evolution_line("Pikachu"), ["Pikachu"])

    def test_strips_whitespace(self) -> None:
        self.assertEqual(
            _split_evolution_line("Mew / Mewtwo"),
            ["Mew", "Mewtwo"],
        )


class NameTokenMatchTests(unittest.TestCase):
    def test_mew_does_not_match_mewtwo(self) -> None:
        self.assertFalse(_name_token_match("Mewtwo", ["Mew"]))
        self.assertFalse(_name_token_match("Mewtwo-GX", ["Mew"]))

    def test_mew_matches_mew_variants(self) -> None:
        self.assertTrue(_name_token_match("Mew", ["Mew"]))
        self.assertTrue(_name_token_match("Mew V", ["Mew"]))
        self.assertTrue(_name_token_match("Mew-EX", ["Mew"]))
        self.assertTrue(_name_token_match("Shining Mew", ["Mew"]))

    def test_evolution_line_matches_any_member(self) -> None:
        names = ["Charmander", "Charmeleon", "Charizard"]
        self.assertTrue(_name_token_match("Charmander", names))
        self.assertTrue(_name_token_match("Charizard ex", names))
        self.assertFalse(_name_token_match("Charcadet", names))


class FindTopCardsTests(unittest.TestCase):
    def test_evolution_line_unions_all_names(self) -> None:
        # `name_clause` leaves single-token names unquoted, so the queries hit
        # `name:Charmander` / `name:Charmeleon` / `name:Charizard`.
        client = _StubTCGClient(
            {
                "name:Charmander": [_card("c1", "Charmander", 5.0)],
                "name:Charmeleon": [_card("c2", "Charmeleon", 7.0)],
                "name:Charizard": [_card("c3", "Charizard ex", 50.0)],
            }
        )
        q = CardQuery(raw="x", name="Charmander/Charmeleon/Charizard", bulk_top=4)
        results = find_top_cards(client, q, limit=4)
        self.assertEqual([c["id"] for c in results], ["c3", "c2", "c1"])

    def test_mew_search_excludes_mewtwo(self) -> None:
        # Simulate the real API behaviour: the wildcard fallback returns Mewtwo
        # alongside Mew variants. The post-filter must drop Mewtwo.
        client = _StubTCGClient(
            {
                "name:Mew": [_card("m1", "Mew", 20.0)],
                "name:Mew*": [
                    _card("m1", "Mew", 20.0),
                    _card("m2", "Mew V", 30.0),
                    _card("mt1", "Mewtwo", 25.0),
                    _card("mt2", "Mewtwo-GX", 50.0),
                ],
            }
        )
        q = CardQuery(raw="x", name="Mew", bulk_top=5)
        results = find_top_cards(client, q, limit=5)
        names = sorted(c["name"] for c in results)
        self.assertEqual(names, ["Mew", "Mew V"])

    def test_tag_team_uses_subtype_query(self) -> None:
        client = _StubTCGClient(
            {
                'subtypes:"TAG TEAM"': [
                    _card("tt1", "Pikachu & Zekrom-GX", 40.0, subtypes=["TAG TEAM", "GX"]),
                    _card("tt2", "Reshiram & Charizard-GX", 80.0, subtypes=["TAG TEAM", "GX"]),
                ],
            }
        )
        q = CardQuery(raw="x", name="tag team", bulk_top=4)
        results = find_top_cards(client, q, limit=4)
        self.assertEqual([c["id"] for c in results], ["tt2", "tt1"])
        # The name-search path must be skipped — only the subtype query should fire.
        self.assertEqual(client.queries, ['subtypes:"TAG TEAM"'])

    def test_concept_puppy_expands_to_dog_pokemon_list(self) -> None:
        # The concept expansion should issue a per-name query for each dog
        # Pokemon and skip the wildcard fallback (multi-name lookup).
        client = _StubTCGClient(
            {
                "name:Growlithe": [_card("g1", "Growlithe", 5.0)],
                "name:Yamper": [_card("y1", "Yamper", 8.0)],
                "name:Riolu": [_card("r1", "Riolu", 12.0)],
            }
        )
        q = CardQuery(raw="x", name="puppy", bulk_top=3)
        results = find_top_cards(client, q, limit=3)
        self.assertEqual(sorted(c["name"] for c in results), ["Growlithe", "Riolu", "Yamper"])
        # No wildcard queries (`name:Growlithe*`) should appear — multi-name
        # lookups skip the wildcard fallback.
        self.assertFalse(any(q.endswith("*") for q in client.queries))

    def test_concept_skips_set_and_flavor_fallbacks_when_empty(self) -> None:
        # Even when the concept's name search returns nothing, we must NOT
        # fall through to set/flavor fallback — that's how `top 9 starter
        # evolution` previously matched the unrelated "Mega Evolution" set.
        client = _StubTCGClient({})  # every query returns []
        q = CardQuery(raw="x", name="starter evolution", bulk_top=9)
        results = find_top_cards(client, q, limit=9)
        self.assertEqual(results, [])
        # No set.name:"…" or flavorText:"…" queries should appear.
        self.assertFalse(any("set.name:" in q for q in client.queries))
        self.assertFalse(any("flavorText:" in q for q in client.queries))

    def test_japanese_card_in_pool_gets_tagged(self) -> None:
        # Real-world case: pokemontcg.io card xy12-109 returns the localized
        # name 'ナッシー[Exeggutor]'. The bulk path must stamp `language: ja`
        # on it so the PDF binder shows the badge.
        ja_card = _card("xy12-109", "ナッシー[Exeggutor]", 100.0)
        en_card = _card("sv8-3", "Exeggutor", 50.0)
        client = _StubTCGClient(
            {
                "name:Exeggutor": [en_card, ja_card],
                "name:Exeggutor*": [en_card, ja_card],
            }
        )
        q = CardQuery(raw="x", name="Exeggutor", bulk_top=2)
        results = find_top_cards(client, q, limit=2)
        by_id = {c["id"]: c for c in results}
        self.assertEqual(by_id["xy12-109"]["language"], "ja")
        self.assertEqual(by_id["sv8-3"]["language"], "en")


class PriceBoundaryFilterTests(unittest.TestCase):
    """`>` / `<` are exclusive: a card whose price exactly equals the bound
    must be dropped. `>=` / `<=` are inclusive: the boundary value is kept.
    These tests pin that contract through `find_top_cards` so the parser
    flags are wired all the way to the filter."""

    @staticmethod
    def _client_with_boundary_cards() -> _StubTCGClient:
        # Three cards at $10, $20, $30 — covers both sides of a $20 bound.
        return _StubTCGClient(
            {
                "name:Charizard": [
                    _card("low", "Charizard", 10.0),
                    _card("at", "Charizard", 20.0),
                    _card("high", "Charizard", 30.0),
                ],
                "name:Charizard*": [
                    _card("low", "Charizard", 10.0),
                    _card("at", "Charizard", 20.0),
                    _card("high", "Charizard", 30.0),
                ],
            }
        )

    def test_inclusive_min_keeps_boundary(self) -> None:
        # `>= 20` admits the card priced exactly at $20.
        q = CardQuery(raw="x", name="Charizard", bulk_top=5, price_min=20.0)
        results = find_top_cards(self._client_with_boundary_cards(), q, limit=5)
        self.assertEqual(sorted(c["id"] for c in results), ["at", "high"])

    def test_strict_min_drops_boundary(self) -> None:
        # `> 20` excludes the card priced exactly at $20.
        q = CardQuery(
            raw="x",
            name="Charizard",
            bulk_top=5,
            price_min=20.0,
            price_min_exclusive=True,
        )
        results = find_top_cards(self._client_with_boundary_cards(), q, limit=5)
        self.assertEqual([c["id"] for c in results], ["high"])

    def test_inclusive_max_keeps_boundary(self) -> None:
        # `<= 20` admits the card priced exactly at $20.
        q = CardQuery(raw="x", name="Charizard", bulk_top=5, price_max=20.0)
        results = find_top_cards(self._client_with_boundary_cards(), q, limit=5)
        self.assertEqual(sorted(c["id"] for c in results), ["at", "low"])

    def test_strict_max_drops_boundary(self) -> None:
        # `< 20` excludes the card priced exactly at $20.
        q = CardQuery(
            raw="x",
            name="Charizard",
            bulk_top=5,
            price_max=20.0,
            price_max_exclusive=True,
        )
        results = find_top_cards(self._client_with_boundary_cards(), q, limit=5)
        self.assertEqual([c["id"] for c in results], ["low"])

    def test_strict_band_drops_both_boundaries(self) -> None:
        # `> 10 < 30` keeps only the card at $20 (strict on both sides).
        q = CardQuery(
            raw="x",
            name="Charizard",
            bulk_top=5,
            price_min=10.0,
            price_min_exclusive=True,
            price_max=30.0,
            price_max_exclusive=True,
        )
        results = find_top_cards(self._client_with_boundary_cards(), q, limit=5)
        self.assertEqual([c["id"] for c in results], ["at"])

    def test_strict_max_wins_over_inclusive_global_cap_at_same_value(self) -> None:
        # `--max-price 20` (inclusive) AND inline `< 20` (strict) → strict wins
        # because it's the more restrictive at the same value.
        q = CardQuery(
            raw="x",
            name="Charizard",
            bulk_top=5,
            price_max=20.0,
            price_max_exclusive=True,
        )
        results = find_top_cards(self._client_with_boundary_cards(), q, limit=5, max_price=20.0)
        self.assertEqual([c["id"] for c in results], ["low"])


def _eur_card(card_id: str, name: str, market: float) -> dict:
    """Build a stub card priced in EUR via Cardmarket (not USD via TCGPlayer)."""
    return {
        "id": card_id,
        "name": name,
        "number": "1",
        "set": {"name": "Test Set", "series": "Test Series"},
        "subtypes": [],
        "cardmarket": {
            "_currency": "EUR",
            "prices": {"averageSellPrice": market},
        },
    }


class MixedCurrencyFilterTests(unittest.TestCase):
    """--max-price compares raw market figures regardless of currency.

    A pool containing both USD (TCGPlayer) and EUR (Cardmarket) cards is
    filtered by the same numeric threshold.  This test documents the current
    currency-blind behaviour so any future currency-aware change is intentional.
    """

    @staticmethod
    def _mixed_client() -> _StubTCGClient:
        return _StubTCGClient(
            {
                "name:Pikachu": [
                    _card("usd-10", "Pikachu", 10.0),
                    _card("usd-30", "Pikachu", 30.0),
                    _eur_card("eur-15", "Pikachu", 15.0),
                    _eur_card("eur-25", "Pikachu", 25.0),
                ],
                "name:Pikachu*": [
                    _card("usd-10", "Pikachu", 10.0),
                    _card("usd-30", "Pikachu", 30.0),
                    _eur_card("eur-15", "Pikachu", 15.0),
                    _eur_card("eur-25", "Pikachu", 25.0),
                ],
            }
        )

    def test_max_price_drops_eur_cards_above_cap_currency_blind(self) -> None:
        # Both USD and EUR cards above the $20 cap are dropped, even though the
        # EUR values are in a different currency.  usd-30 ($30 USD) and
        # eur-25 (€25 EUR treated as 25) are both excluded.
        q = CardQuery(raw="x", name="Pikachu", bulk_top=10)
        results = find_top_cards(self._mixed_client(), q, limit=10, max_price=20.0)
        ids = {c["id"] for c in results}
        self.assertIn("usd-10", ids)
        self.assertIn("eur-15", ids)
        self.assertNotIn("usd-30", ids)
        self.assertNotIn("eur-25", ids)

    def test_max_price_passes_all_cards_when_no_cap(self) -> None:
        q = CardQuery(raw="x", name="Pikachu", bulk_top=10)
        results = find_top_cards(self._mixed_client(), q, limit=10)
        self.assertEqual(len(results), 4)


class ExpandConceptTests(unittest.TestCase):
    def test_known_concept_returns_slash_string(self) -> None:
        result = _expand_concept("eeveelution")
        self.assertIsNotNone(result)
        self.assertIn("Vaporeon", result)
        self.assertIn("Sylveon", result)
        self.assertIn("/", result)

    def test_unknown_concept_returns_none(self) -> None:
        self.assertIsNone(_expand_concept("Charizard"))
        self.assertIsNone(_expand_concept(""))

    def test_concept_lookup_is_case_insensitive(self) -> None:
        self.assertEqual(_expand_concept("PUPPY"), _expand_concept("puppy"))


class ApplyPriceBoundsTests(unittest.TestCase):
    """Unit tests for _apply_price_bounds — the helper that enforces inline price
    conditions on single-card lookup results."""

    def _priced_card(self, market: float) -> dict:
        return {
            "id": "test-1",
            "name": "Charizard",
            "number": "4",
            "set": {"name": "Base Set", "series": "Base"},
            "tcgplayer": {"prices": {"holofoil": {"market": market}}},
        }

    def _q(self, **kwargs) -> CardQuery:
        return CardQuery(raw="test", name="Charizard", **kwargs)

    def test_no_bounds_passes_through(self) -> None:
        card = self._priced_card(50.0)
        result = _apply_price_bounds(MatchResult(card, "matched"), self._q())
        self.assertIs(result.card, card)

    def test_inclusive_min_passes_equal(self) -> None:
        card = self._priced_card(100.0)
        q = self._q(price_min=100.0, price_min_exclusive=False)
        result = _apply_price_bounds(MatchResult(card, "matched"), q)
        self.assertIs(result.card, card)

    def test_inclusive_min_drops_below(self) -> None:
        card = self._priced_card(80.0)
        q = self._q(price_min=100.0, price_min_exclusive=False)
        result = _apply_price_bounds(MatchResult(card, "matched"), q)
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "price_mismatch")

    def test_strict_min_drops_equal(self) -> None:
        card = self._priced_card(100.0)
        q = self._q(price_min=100.0, price_min_exclusive=True)
        result = _apply_price_bounds(MatchResult(card, "matched"), q)
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "price_mismatch")

    def test_strict_min_passes_above(self) -> None:
        card = self._priced_card(100.01)
        q = self._q(price_min=100.0, price_min_exclusive=True)
        result = _apply_price_bounds(MatchResult(card, "matched"), q)
        self.assertIs(result.card, card)

    def test_inclusive_max_passes_equal(self) -> None:
        card = self._priced_card(50.0)
        q = self._q(price_max=50.0, price_max_exclusive=False)
        result = _apply_price_bounds(MatchResult(card, "matched"), q)
        self.assertIs(result.card, card)

    def test_inclusive_max_drops_above(self) -> None:
        card = self._priced_card(60.0)
        q = self._q(price_max=50.0, price_max_exclusive=False)
        result = _apply_price_bounds(MatchResult(card, "matched"), q)
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "price_mismatch")

    def test_strict_max_drops_equal(self) -> None:
        card = self._priced_card(50.0)
        q = self._q(price_max=50.0, price_max_exclusive=True)
        result = _apply_price_bounds(MatchResult(card, "matched"), q)
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "price_mismatch")

    def test_no_pricing_data_passes_through(self) -> None:
        card = {
            "id": "test-1",
            "name": "Charizard",
            "number": "4",
            "set": {"name": "Base Set", "series": "Base"},
        }
        q = self._q(price_min=100.0)
        result = _apply_price_bounds(MatchResult(card, "matched"), q)
        self.assertIs(result.card, card)

    def test_none_card_passes_through(self) -> None:
        q = self._q(price_min=100.0)
        result = _apply_price_bounds(MatchResult(None, "no_candidates"), q)
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "no_candidates")


class FindCardPriceBoundsTests(unittest.TestCase):
    """Integration tests: find_card() enforces inline price bounds end-to-end."""

    def _charizard(self, market: float) -> dict:
        return {
            "id": "base1-4",
            "name": "Charizard",
            "number": "4",
            "set": {"name": "Base Set", "series": "Base"},
            "tcgplayer": {"prices": {"holofoil": {"market": market}}},
        }

    def test_find_card_drops_when_price_below_min(self) -> None:
        card = self._charizard(80.0)
        client = _StubTCGClient({"name:Charizard": [card]})
        q = CardQuery(
            raw="Charizard >= $100", name="Charizard", price_min=100.0, price_min_exclusive=False
        )
        result = find_card(
            client, _NullTCGDexClient(), _StubPCClient(MatchResult(None, "no_candidates")), q
        )
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "price_mismatch")

    def test_find_card_passes_when_price_meets_min(self) -> None:
        card = self._charizard(120.0)
        client = _StubTCGClient({"name:Charizard": [card]})
        q = CardQuery(
            raw="Charizard >= $100", name="Charizard", price_min=100.0, price_min_exclusive=False
        )
        result = find_card(
            client, _NullTCGDexClient(), _StubPCClient(MatchResult(None, "no_candidates")), q
        )
        self.assertIsNotNone(result.card)

    def test_find_card_drops_when_price_above_max(self) -> None:
        card = self._charizard(200.0)
        client = _StubTCGClient({"name:Charizard": [card]})
        q = CardQuery(
            raw="Charizard <= $100", name="Charizard", price_max=100.0, price_max_exclusive=False
        )
        result = find_card(
            client, _NullTCGDexClient(), _StubPCClient(MatchResult(None, "no_candidates")), q
        )
        self.assertIsNone(result.card)
        self.assertEqual(result.reason, "price_mismatch")


class _StubPCClient:
    """PriceCharting client stub: returns a configured MatchResult from fetch."""

    def __init__(self, result: MatchResult) -> None:
        self.result = result
        self.calls: list[str] = []

    def fetch(self, url: str) -> MatchResult:
        self.calls.append(url)
        return self.result


class _NullTCGDexClient:
    """TCGdex client stub — should never be called on the URL-hint path."""

    def search_cards(self, *_: object, **__: object) -> list[dict]:
        return []


class FindCardUrlHintOverrideTests(unittest.TestCase):
    """A PriceCharting URL the user pastes should be persisted as a sticky
    override only when the fetch actually succeeded — a bad URL must not get
    pinned into the override store and quietly fail on every future run."""

    URL = "https://www.pricecharting.com/game/pokemon-base-set/charizard-4"

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(cache._NO_CACHE_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(cache._NO_CACHE_ENV, None)
        self.q = CardQuery(raw=f"Charizard | {self.URL}", name="Charizard", url_hint=self.URL)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(cache._NO_CACHE_ENV, None)
        else:
            os.environ[cache._NO_CACHE_ENV] = self._old_no_cache
        self._tmp.cleanup()

    def test_scrape_failed_url_is_not_persisted(self) -> None:
        pc = _StubPCClient(MatchResult(None, "scrape_failed", url=self.URL))
        result = find_card(_StubTCGClient(), _NullTCGDexClient(), pc, self.q)
        self.assertEqual(result.reason, "scrape_failed")
        self.assertEqual(result.url, self.URL)
        self.assertIsNone(cache.find_url_override("Charizard", None))
        # PC client was actually consulted — guards against a regression
        # where the URL-hint branch silently fell through.
        self.assertEqual(pc.calls, [self.URL])

    def test_successful_url_is_persisted(self) -> None:
        card = {"id": "pricecharting:x", "name": "Charizard"}
        pc = _StubPCClient(MatchResult(card, "matched"))
        result = find_card(_StubTCGClient(), _NullTCGDexClient(), pc, self.q)
        self.assertEqual(result.reason, "matched")
        self.assertIs(result.card, card)
        self.assertEqual(cache.find_url_override("Charizard", None), self.URL)


class StageCallbackTests(unittest.TestCase):
    """The lookup coordinator surfaces pipeline stages through `on_stage`
    so the web UI can render finer-grained per-line progress."""

    def setUp(self) -> None:
        # Isolate the disk cache so the URL-hint test's sticky override
        # can't leak into the DB-source tests (which would otherwise see a
        # phantom `url_hint` stage from a recorded override).
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
        self._tmp.cleanup()

    def _charizard(self, market: float = 100.0) -> dict:
        return {
            "id": "base1-4",
            "name": "Charizard",
            "number": "4",
            "set": {"name": "Base Set", "series": "Base"},
            "tcgplayer": {"prices": {"holofoil": {"market": market}}},
        }

    def test_find_card_emits_looking_up_on_pokemontcg_hit(self) -> None:
        client = _StubTCGClient({"name:Charizard": [self._charizard()]})
        q = CardQuery(raw="Charizard", name="Charizard")
        stages: list[str] = []
        find_card(
            client,
            _NullTCGDexClient(),
            _StubPCClient(MatchResult(None, "no_candidates")),
            q,
            on_stage=stages.append,
        )
        # pokemontcg.io hits first, so the TCGdex fallback never fires.
        self.assertEqual(stages, ["looking_up"])

    def test_find_card_emits_fallback_when_pokemontcg_misses(self) -> None:
        class _EmptyTCGDex:
            def search(self, *_: object, **__: object) -> list[dict]:
                return []

        client = _StubTCGClient()  # empty map → no pokemontcg.io match
        q = CardQuery(raw="Charizard", name="Charizard")
        stages: list[str] = []
        find_card(
            client,
            _EmptyTCGDex(),
            _StubPCClient(MatchResult(None, "no_candidates")),
            q,
            on_stage=stages.append,
        )
        self.assertEqual(stages, ["looking_up", "fallback"])

    def test_find_card_emits_url_hint_on_pricecharting_url(self) -> None:
        url = "https://www.pricecharting.com/game/pokemon-base-set/charizard-4"
        pc = _StubPCClient(MatchResult(self._charizard(), "matched"))
        q = CardQuery(raw=f"Charizard | {url}", name="Charizard", url_hint=url)
        stages: list[str] = []
        find_card(_StubTCGClient(), _NullTCGDexClient(), pc, q, on_stage=stages.append)
        # A successful URL hint short-circuits the DB sources entirely.
        self.assertEqual(stages, ["url_hint"])

    def test_find_top_cards_emits_looking_up_then_pricing(self) -> None:
        client = _StubTCGClient({"name:Charizard": [_card("base1-4", "Charizard", 100.0)]})
        q = CardQuery(raw="top:5 Charizard", name="Charizard", bulk_top=5)
        stages: list[str] = []
        find_top_cards(client, q, limit=5, on_stage=stages.append)
        self.assertEqual(stages, ["looking_up", "pricing"])

    def test_on_stage_none_is_a_silent_no_op(self) -> None:
        # The default (no callback) must not raise — the CLI and the
        # single-line endpoint rely on it.
        client = _StubTCGClient({"name:Charizard": [self._charizard()]})
        q = CardQuery(raw="Charizard", name="Charizard")
        result = find_card(
            client, _NullTCGDexClient(), _StubPCClient(MatchResult(None, "no_candidates")), q
        )
        self.assertIsNotNone(result.card)


class CacheStatusPropagationTests(unittest.TestCase):
    """`MatchResult.cache_status` carries the worst split-cache outcome from
    the source layer up through `find_card`. The /lookup route uses this to
    set the `X-Cache` response header (#372 / #310)."""

    def _stub_with_status(self, cards: list[dict], status: str) -> _StubTCGClient:
        """Build a _StubTCGClient whose search()/search_all() return `status`."""
        client = _StubTCGClient()

        def _search_all(query: str, **_: object) -> tuple[list[dict], str]:
            client.queries.append(query)
            return cards, status

        client.search_all = _search_all  # type: ignore[method-assign]
        client.search = _search_all  # type: ignore[method-assign]
        return client

    def _charizard(self) -> dict:
        return _card("base1-4", "Charizard", 100.0)

    def test_hit_status_propagates_to_match_result(self) -> None:
        client = self._stub_with_status([self._charizard()], "HIT")
        q = CardQuery(raw="Charizard", name="Charizard")
        result = find_card(
            client, _NullTCGDexClient(), _StubPCClient(MatchResult(None, "no_candidates")), q
        )
        self.assertEqual(result.reason, "matched")
        self.assertEqual(result.cache_status, "HIT")

    def test_stale_status_propagates_to_match_result(self) -> None:
        client = self._stub_with_status([self._charizard()], "STALE")
        q = CardQuery(raw="Charizard", name="Charizard")
        result = find_card(
            client, _NullTCGDexClient(), _StubPCClient(MatchResult(None, "no_candidates")), q
        )
        self.assertEqual(result.cache_status, "STALE")

    def test_miss_status_propagates_to_match_result(self) -> None:
        client = self._stub_with_status([self._charizard()], "MISS")
        q = CardQuery(raw="Charizard", name="Charizard")
        result = find_card(
            client, _NullTCGDexClient(), _StubPCClient(MatchResult(None, "no_candidates")), q
        )
        self.assertEqual(result.cache_status, "MISS")

    def test_find_top_cards_on_cache_status_aggregates_worst_across_queries(self) -> None:
        # Subtype-driven path issues exactly one query for 'tag team'.
        # Use the same stub to surface STALE on that query.
        client = self._stub_with_status([self._charizard()], "STALE")
        q = CardQuery(raw="top:1 tag team", name="tag team", bulk_top=1)
        seen: list[str] = []
        find_top_cards(client, q, limit=1, on_cache_status=seen.append)
        self.assertIn("STALE", seen)


if __name__ == "__main__":
    unittest.main()
