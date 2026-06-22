"""Tests for `/api/v1/cards/ownership` — cross-collection ownership (#576).

Covers:

- Empty / no-occupancy requests return an empty map.
- Owned cards report their collection + summed quantity.
- Quantity sums across duplicate rows in one collection.
- A card in two collections lists both.
- Chased cards report their wishlist.
- A card both owned and chasing reports both sides.
- Only requested identities come back (scoping to the batch).

Mirrors the isolation pattern from `tests/test_swipe.py`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from api.db import session as session_mod


class _IsolatedDbMixin(unittest.TestCase):
    """Point MGZ_PKMN_DATABASE_URL at a fresh sqlite file per test."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "test.db"
        self._old_url = os.environ.get("MGZ_PKMN_DATABASE_URL")
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        if self._old_url is None:
            os.environ.pop("MGZ_PKMN_DATABASE_URL", None)
        else:
            os.environ["MGZ_PKMN_DATABASE_URL"] = self._old_url
        self._tmp.cleanup()


def _card(set_id: str, number: str, name: str) -> dict:
    return {
        "id": f"{set_id}-{number}",
        "name": name,
        "set": {"id": set_id, "name": set_id.upper()},
        "number": number,
        "rarity": "Rare Holo",
    }


CHARIZARD = _card("base1", "4", "Charizard")
BLASTOISE = _card("base1", "2", "Blastoise")
PIKACHU = _card("base1", "58", "Pikachu")


class OwnershipEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def _collection(self, c: TestClient, name: str) -> int:
        return c.post("/api/v1/collections", json={"name": name}).json()["id"]

    def _wishlist(self, c: TestClient, name: str) -> int:
        return c.post("/api/v1/wishlists", json={"name": name}).json()["id"]

    def _add_to_collection(self, c: TestClient, cid: int, card: dict) -> None:
        c.post(f"/api/v1/collections/{cid}/items", json={"card": card})

    def test_empty_request(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/cards/ownership", json={"cards": []})
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"ownership": {}})

    def test_owned_card_reports_collection(self) -> None:
        with self._client() as c:
            cid = self._collection(c, "Show Binder")
            self._add_to_collection(c, cid, BLASTOISE)

            resp = c.post(
                "/api/v1/cards/ownership",
                json={"cards": [{"set_id": "base1", "number": "2"}]},
            )
            body = resp.json()["ownership"]
            self.assertIn("base1::2", body)
            entry = body["base1::2"]
            self.assertEqual(entry["wishlists"], [])
            self.assertEqual(len(entry["collections"]), 1)
            self.assertEqual(entry["collections"][0]["name"], "Show Binder")
            self.assertEqual(entry["collections"][0]["id"], cid)
            self.assertEqual(entry["collections"][0]["quantity"], 1)

    def test_quantity_sums_across_duplicate_rows(self) -> None:
        with self._client() as c:
            cid = self._collection(c, "Trade Stock")
            # Same card added three times to one collection → quantity 3.
            for _ in range(3):
                self._add_to_collection(c, cid, CHARIZARD)

            body = c.post(
                "/api/v1/cards/ownership",
                json={"cards": [{"set_id": "base1", "number": "4"}]},
            ).json()["ownership"]
            self.assertEqual(len(body["base1::4"]["collections"]), 1)
            self.assertEqual(body["base1::4"]["collections"][0]["quantity"], 3)

    def test_card_in_two_collections_lists_both(self) -> None:
        with self._client() as c:
            a = self._collection(c, "Show Binder")
            b = self._collection(c, "Trade Stock")
            self._add_to_collection(c, a, CHARIZARD)
            self._add_to_collection(c, b, CHARIZARD)

            body = c.post(
                "/api/v1/cards/ownership",
                json={"cards": [{"set_id": "base1", "number": "4"}]},
            ).json()["ownership"]
            names = {x["name"] for x in body["base1::4"]["collections"]}
            self.assertEqual(names, {"Show Binder", "Trade Stock"})

    def test_chasing_card_reports_wishlist(self) -> None:
        with self._client() as c:
            wid = self._wishlist(c, "Allentown Show")
            c.post(f"/api/v1/wishlists/{wid}/items", json={"card": PIKACHU})

            body = c.post(
                "/api/v1/cards/ownership",
                json={"cards": [{"set_id": "base1", "number": "58"}]},
            ).json()["ownership"]
            self.assertEqual(body["base1::58"]["collections"], [])
            self.assertEqual(len(body["base1::58"]["wishlists"]), 1)
            self.assertEqual(body["base1::58"]["wishlists"][0]["name"], "Allentown Show")

    def test_owned_and_chasing_reports_both(self) -> None:
        with self._client() as c:
            cid = self._collection(c, "Show Binder")
            self._add_to_collection(c, cid, CHARIZARD)
            wid = self._wishlist(c, "Upgrade list")
            c.post(f"/api/v1/wishlists/{wid}/items", json={"card": CHARIZARD})

            body = c.post(
                "/api/v1/cards/ownership",
                json={"cards": [{"set_id": "base1", "number": "4"}]},
            ).json()["ownership"]
            self.assertEqual(len(body["base1::4"]["collections"]), 1)
            self.assertEqual(len(body["base1::4"]["wishlists"]), 1)

    def test_unowned_card_is_omitted(self) -> None:
        with self._client() as c:
            cid = self._collection(c, "Show Binder")
            self._add_to_collection(c, cid, CHARIZARD)

            # Ask about a card we don't own; it must not appear.
            body = c.post(
                "/api/v1/cards/ownership",
                json={
                    "cards": [
                        {"set_id": "base1", "number": "4"},
                        {"set_id": "base1", "number": "999"},
                    ]
                },
            ).json()["ownership"]
            self.assertIn("base1::4", body)
            self.assertNotIn("base1::999", body)

    def test_scoped_to_requested_identities(self) -> None:
        with self._client() as c:
            cid = self._collection(c, "Show Binder")
            self._add_to_collection(c, cid, CHARIZARD)  # base1-4
            self._add_to_collection(c, cid, BLASTOISE)  # base1-2

            # Same set, but only ask about Charizard — Blastoise stays out
            # even though it shares the set id used to scope the query.
            body = c.post(
                "/api/v1/cards/ownership",
                json={"cards": [{"set_id": "base1", "number": "4"}]},
            ).json()["ownership"]
            self.assertEqual(set(body.keys()), {"base1::4"})


class QuickActionTests(_IsolatedDbMixin):
    """One-tap want / own against the user's defaults (#760, ADR-0027)."""

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_want_adds_to_default_wishlist_and_is_idempotent(self) -> None:
        from sqlalchemy import select

        from api.db.models import Wishlist

        with self._client() as c:
            first = c.post("/api/v1/cards/want", json={"card": CHARIZARD})
            self.assertEqual(first.status_code, 200)
            body = first.json()
            self.assertTrue(body["wanted"])
            self.assertFalse(body["owned"])
            self.assertEqual(len(body["wishlists"]), 1)

            # Re-tapping is a no-op — still exactly one wishlist, one item.
            again = c.post("/api/v1/cards/want", json={"card": CHARIZARD}).json()
            self.assertEqual(len(again["wishlists"]), 1)
            self.assertEqual(len(c.get("/api/v1/wishlists").json()["items"]), 1)

        sf = session_mod.get_session_factory()
        with sf() as db:
            lists = db.scalars(select(Wishlist)).all()
            self.assertEqual(len(lists), 1)
            self.assertTrue(lists[0].is_default)

    def test_unwant_removes_from_default_wishlist(self) -> None:
        with self._client() as c:
            c.post("/api/v1/cards/want", json={"card": CHARIZARD})
            body = c.post("/api/v1/cards/unwant", json={"card": CHARIZARD}).json()
            self.assertFalse(body["wanted"])
            self.assertEqual(body["wishlists"], [])

    def test_own_adds_to_default_collection_and_is_idempotent(self) -> None:
        with self._client() as c:
            body = c.post("/api/v1/cards/own", json={"card": CHARIZARD}).json()
            self.assertTrue(body["owned"])
            self.assertEqual(len(body["collections"]), 1)
            self.assertEqual(body["collections"][0]["quantity"], 1)

            again = c.post("/api/v1/cards/own", json={"card": CHARIZARD}).json()
            # Idempotent — one row, quantity unchanged (quantity flows are #762).
            self.assertEqual(len(again["collections"]), 1)
            self.assertEqual(again["collections"][0]["quantity"], 1)

    def test_unown_removes_from_default_collection(self) -> None:
        with self._client() as c:
            c.post("/api/v1/cards/own", json={"card": CHARIZARD})
            body = c.post("/api/v1/cards/unown", json={"card": CHARIZARD}).json()
            self.assertFalse(body["owned"])
            self.assertEqual(body["collections"], [])

    def test_owning_a_wanted_card_stamps_the_chase_complete(self) -> None:
        from sqlalchemy import select

        from api.db.models import WishlistItem

        with self._client() as c:
            c.post("/api/v1/cards/want", json={"card": CHARIZARD})
            body = c.post("/api/v1/cards/own", json={"card": CHARIZARD}).json()
            # A card can be both wanted (history preserved) and owned.
            self.assertTrue(body["owned"])
            self.assertTrue(body["wanted"])

        sf = session_mod.get_session_factory()
        with sf() as db:
            item = db.scalar(select(WishlistItem))
            self.assertIsNotNone(item.acquired_at)
            self.assertIsNotNone(item.acquired_collection_item_id)

    def test_unowning_clears_the_chase_stamp(self) -> None:
        from sqlalchemy import select

        from api.db.models import WishlistItem

        with self._client() as c:
            c.post("/api/v1/cards/want", json={"card": CHARIZARD})
            c.post("/api/v1/cards/own", json={"card": CHARIZARD})
            c.post("/api/v1/cards/unown", json={"card": CHARIZARD})

        sf = session_mod.get_session_factory()
        with sf() as db:
            item = db.scalar(select(WishlistItem))
            self.assertIsNone(item.acquired_at)
            self.assertIsNone(item.acquired_collection_item_id)


if __name__ == "__main__":
    unittest.main()
