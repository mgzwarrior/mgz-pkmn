"""Tests for `/api/v1/wishlists` (ADR-0013 slice 4).

Covers:

- Alembic migration up/down round-trip for `wishlists` and
  `wishlist_items` (including `max_price`).
- All CRUD endpoints + 404 paths.
- "Add card to wishlist" round-trip end-to-end, with and without `max_price`.
- Cascade delete: removing a wishlist drops its items.

Mirrors the isolation pattern from `tests/test_collections.py`.
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
from sqlalchemy import inspect, select

from api.db import session as session_mod
from api.db.migrate import upgrade_head
from api.db.models import WishlistItem


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


SAMPLE_CARD = {
    "id": "base1-4",
    "name": "Charizard",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "4",
    "rarity": "Rare Holo",
    "images": {"small": "https://example.com/charizard.png"},
}


# ---------------------------------------------------------------------------
# Migration round-trip
# ---------------------------------------------------------------------------


class WishlistsMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_wishlists_tables(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("wishlists", names)
        self.assertIn("wishlist_items", names)

    def test_max_price_column_exists_on_items(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("wishlist_items")}
        self.assertIn("max_price", cols)

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("wishlists", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Step back to the collections revision so the wishlists tables
        # come down but the collections slice underneath survives.
        command.downgrade(cfg, "2b9da4eb7e17")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("wishlists", names)
        self.assertNotIn("wishlist_items", names)
        self.assertIn("collections", names)

        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("wishlists", names)
        self.assertIn("wishlist_items", names)


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


class WishlistsEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_list_is_empty_when_no_wishlists(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/wishlists")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"items": [], "total": 0})

    def test_create_then_list(self) -> None:
        with self._client() as c:
            created = c.post(
                "/api/v1/wishlists",
                json={"name": "Charizard hunt", "description": "every set"},
            )
            self.assertEqual(created.status_code, 201)
            body = created.json()
            self.assertEqual(body["name"], "Charizard hunt")
            self.assertEqual(body["description"], "every set")
            self.assertEqual(body["items"], [])
            self.assertTrue(body["id"])

            listing = c.get("/api/v1/wishlists").json()
            self.assertEqual(listing["total"], 1)
            self.assertEqual(listing["items"][0]["name"], "Charizard hunt")
            self.assertEqual(listing["items"][0]["item_count"], 0)

    def test_create_rejects_blank_name(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/wishlists", json={"name": ""})
            self.assertEqual(resp.status_code, 422)

    def test_get_404_for_missing(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/wishlists/9999")
            self.assertEqual(resp.status_code, 404)

    def test_patch_renames_and_clears_description(self) -> None:
        with self._client() as c:
            wid = c.post(
                "/api/v1/wishlists",
                json={"name": "Old", "description": "keep me"},
            ).json()["id"]

            renamed = c.patch(f"/api/v1/wishlists/{wid}", json={"name": "New"}).json()
            self.assertEqual(renamed["name"], "New")
            self.assertEqual(renamed["description"], "keep me")

            cleared = c.patch(f"/api/v1/wishlists/{wid}", json={"description": None}).json()
            self.assertIsNone(cleared["description"])

    def test_patch_404_for_missing(self) -> None:
        with self._client() as c:
            resp = c.patch("/api/v1/wishlists/9999", json={"name": "x"})
            self.assertEqual(resp.status_code, 404)

    def test_delete_wishlist_cascades_items(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "drop me"}).json()["id"]
            c.post(
                f"/api/v1/wishlists/{wid}/items",
                json={"card": SAMPLE_CARD, "max_price": 50.0},
            )
            resp = c.delete(f"/api/v1/wishlists/{wid}")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(c.get(f"/api/v1/wishlists/{wid}").status_code, 404)
            with session_mod.get_session_factory()() as s:
                self.assertEqual(
                    s.scalar(select(WishlistItem).where(WishlistItem.wishlist_id == wid)),
                    None,
                )

    # ---- #774: filing want-lists into binders ----------------------------

    def test_create_files_into_binder(self) -> None:
        with self._client() as c:
            bid = c.post("/api/v1/binders", json={"name": "Show binder"}).json()["id"]
            created = c.post(
                "/api/v1/wishlists",
                json={"name": "Chase", "binder_id": bid},
            )
            self.assertEqual(created.status_code, 201)
            self.assertEqual(created.json()["binder_id"], bid)
            # The summary list carries binder_id too, so the SPA can group it.
            self.assertEqual(c.get("/api/v1/wishlists").json()["items"][0]["binder_id"], bid)

    def test_create_rejects_unowned_binder(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/wishlists", json={"name": "Chase", "binder_id": 9999})
            self.assertEqual(resp.status_code, 404)

    def test_patch_refiles_and_unfiles(self) -> None:
        with self._client() as c:
            b1 = c.post("/api/v1/binders", json={"name": "B1"}).json()["id"]
            b2 = c.post("/api/v1/binders", json={"name": "B2"}).json()["id"]
            wid = c.post("/api/v1/wishlists", json={"name": "Chase", "binder_id": b1}).json()["id"]

            refiled = c.patch(f"/api/v1/wishlists/{wid}", json={"binder_id": b2})
            self.assertEqual(refiled.json()["binder_id"], b2)

            unfiled = c.patch(f"/api/v1/wishlists/{wid}", json={"binder_id": None})
            self.assertIsNone(unfiled.json()["binder_id"])

            # Omitting binder_id leaves the current value untouched.
            renamed = c.patch(f"/api/v1/wishlists/{wid}", json={"name": "Renamed"})
            self.assertIsNone(renamed.json()["binder_id"])

    def test_patch_rejects_unowned_binder(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "Chase"}).json()["id"]
            resp = c.patch(f"/api/v1/wishlists/{wid}", json={"binder_id": 9999})
            self.assertEqual(resp.status_code, 404)

    def test_add_card_persists_max_price(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "Charizard hunt"}).json()["id"]

            added = c.post(
                f"/api/v1/wishlists/{wid}/items",
                json={"card": SAMPLE_CARD, "max_price": 75.5, "notes": "near-mint"},
            )
            self.assertEqual(added.status_code, 201)
            item = added.json()
            self.assertEqual(item["card"]["id"], "base1-4")
            self.assertEqual(item["notes"], "near-mint")
            self.assertEqual(item["max_price"], 75.5)

            detail = c.get(f"/api/v1/wishlists/{wid}").json()
            self.assertEqual(len(detail["items"]), 1)
            self.assertEqual(detail["items"][0]["max_price"], 75.5)

    def test_add_card_without_max_price_persists_null(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "no caps"}).json()["id"]
            added = c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD})
            self.assertEqual(added.status_code, 201)
            self.assertIsNone(added.json()["max_price"])

    def test_add_card_rejects_negative_max_price(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "x"}).json()["id"]
            resp = c.post(
                f"/api/v1/wishlists/{wid}/items",
                json={"card": SAMPLE_CARD, "max_price": -5},
            )
            self.assertEqual(resp.status_code, 422)

    def test_add_card_promotes_card_identity_columns(self) -> None:
        # Symmetric with collection_items: the same promoted columns
        # land on the wishlist row so cross-surface queries (is this
        # card already chased *or* owned?) hit one indexed shape.
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "hunt"}).json()["id"]
            item = c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD}).json()
            self.assertEqual(item["card_set_id"], "base1")
            self.assertEqual(item["card_number"], "4")
            self.assertEqual(item["card_name"], "Charizard")
            self.assertIsNone(item["acquired_at"])
            self.assertIsNone(item["acquired_collection_item_id"])

    def test_add_item_404_for_missing_wishlist(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/wishlists/9999/items", json={"card": SAMPLE_CARD})
            self.assertEqual(resp.status_code, 404)

    def test_delete_item_removes_one_and_returns_204(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "k"}).json()["id"]
            item_id = c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD}).json()[
                "id"
            ]
            resp = c.delete(f"/api/v1/wishlists/{wid}/items/{item_id}")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(len(c.get(f"/api/v1/wishlists/{wid}").json()["items"]), 0)

    def test_delete_item_404_when_wrong_wishlist(self) -> None:
        with self._client() as c:
            wid_a = c.post("/api/v1/wishlists", json={"name": "a"}).json()["id"]
            wid_b = c.post("/api/v1/wishlists", json={"name": "b"}).json()["id"]
            item_id = c.post(f"/api/v1/wishlists/{wid_a}/items", json={"card": SAMPLE_CARD}).json()[
                "id"
            ]
            resp = c.delete(f"/api/v1/wishlists/{wid_b}/items/{item_id}")
            self.assertEqual(resp.status_code, 404)

    def test_delete_items_by_card_removes_active_chase(self) -> None:
        # The card-detail "remove from this list" affordance (#762) drops the
        # active chase by identity, no item id needed.
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "k"}).json()["id"]
            c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD})
            resp = c.delete(
                f"/api/v1/wishlists/{wid}/items",
                params={"set_id": "base1", "number": "4"},
            )
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(len(c.get(f"/api/v1/wishlists/{wid}").json()["items"]), 0)

    def test_delete_items_by_card_404_when_card_absent(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "k"}).json()["id"]
            resp = c.delete(
                f"/api/v1/wishlists/{wid}/items",
                params={"set_id": "base1", "number": "4"},
            )
            self.assertEqual(resp.status_code, 404)

    def test_bulk_add_items_round_trip(self) -> None:
        # #268 — add a multi-select of matched rows to a want-list at once,
        # with a shared price cap stamped on every row.
        second = {**SAMPLE_CARD, "id": "base1-2", "name": "Blastoise", "number": "2"}
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "Chase board"}).json()["id"]

            resp = c.post(
                f"/api/v1/wishlists/{wid}/items/bulk",
                json={"cards": [SAMPLE_CARD, second], "max_price": 50},
            )
            self.assertEqual(resp.status_code, 201)
            body = resp.json()
            self.assertEqual(body["added"], 2)
            self.assertEqual({i["card"]["name"] for i in body["items"]}, {"Charizard", "Blastoise"})
            self.assertTrue(all(i["max_price"] == 50 for i in body["items"]))

            self.assertEqual(len(c.get(f"/api/v1/wishlists/{wid}").json()["items"]), 2)

    def test_bulk_add_rejects_empty_list(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "k"}).json()["id"]
            resp = c.post(f"/api/v1/wishlists/{wid}/items/bulk", json={"cards": []})
            self.assertEqual(resp.status_code, 422)

    def test_bulk_add_404_for_missing_wishlist(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/wishlists/9999/items/bulk", json={"cards": [SAMPLE_CARD]})
            self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# Promote: wishlist item → collection (#504)
# ---------------------------------------------------------------------------


class WishlistPromoteTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def _seed_item_and_collection(self, c: TestClient) -> tuple[int, int, int]:
        """Return ``(wishlist_id, item_id, collection_id)`` ready to promote."""
        wid = c.post("/api/v1/wishlists", json={"name": "hunt"}).json()["id"]
        item_id = c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD}).json()["id"]
        cid = c.post("/api/v1/collections", json={"name": "binder"}).json()["id"]
        return wid, item_id, cid

    def test_promote_marks_acquired_and_creates_collection_item(self) -> None:
        with self._client() as c:
            wid, item_id, cid = self._seed_item_and_collection(c)
            resp = c.post(
                f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                json={"collection_id": cid, "quantity": 2, "notes": "near-mint"},
            )
            self.assertEqual(resp.status_code, 201)
            body = resp.json()

            wl_item = body["wishlist_item"]
            self.assertEqual(wl_item["id"], item_id)
            self.assertIsNotNone(wl_item["acquired_at"])
            self.assertIsNotNone(wl_item["acquired_collection_item_id"])

            coll_item = body["collection_item"]
            self.assertEqual(coll_item["card"]["id"], "base1-4")
            self.assertEqual(coll_item["quantity"], 2)
            self.assertEqual(coll_item["notes"], "near-mint")
            self.assertEqual(coll_item["added_via"], "wishlist_promote")
            self.assertEqual(coll_item["card_set_id"], "base1")
            self.assertEqual(wl_item["acquired_collection_item_id"], coll_item["id"])

    def test_promote_lands_in_collection_listing(self) -> None:
        with self._client() as c:
            wid, item_id, cid = self._seed_item_and_collection(c)
            c.post(
                f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                json={"collection_id": cid},
            )
            detail = c.get(f"/api/v1/collections/{cid}").json()
            self.assertEqual(len(detail["items"]), 1)
            self.assertEqual(detail["items"][0]["added_via"], "wishlist_promote")
            # The wishlist row survives — the want-list still doubles as a
            # retrospective.
            wl = c.get(f"/api/v1/wishlists/{wid}").json()
            self.assertEqual(len(wl["items"]), 1)
            self.assertIsNotNone(wl["items"][0]["acquired_at"])

    def test_promote_defaults_quantity_to_one(self) -> None:
        with self._client() as c:
            wid, item_id, cid = self._seed_item_and_collection(c)
            resp = c.post(
                f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                json={"collection_id": cid},
            )
            self.assertEqual(resp.json()["collection_item"]["quantity"], 1)

    def test_promote_twice_is_409(self) -> None:
        with self._client() as c:
            wid, item_id, cid = self._seed_item_and_collection(c)
            first = c.post(
                f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                json={"collection_id": cid},
            )
            self.assertEqual(first.status_code, 201)
            second = c.post(
                f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                json={"collection_id": cid},
            )
            self.assertEqual(second.status_code, 409)
            # No duplicate collection row.
            self.assertEqual(len(c.get(f"/api/v1/collections/{cid}").json()["items"]), 1)

    def test_promote_404_for_missing_item(self) -> None:
        with self._client() as c:
            wid = c.post("/api/v1/wishlists", json={"name": "hunt"}).json()["id"]
            cid = c.post("/api/v1/collections", json={"name": "binder"}).json()["id"]
            resp = c.post(
                f"/api/v1/wishlists/{wid}/items/9999/promote",
                json={"collection_id": cid},
            )
            self.assertEqual(resp.status_code, 404)

    def test_promote_404_for_missing_collection(self) -> None:
        with self._client() as c:
            wid, item_id, _ = self._seed_item_and_collection(c)
            resp = c.post(
                f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                json={"collection_id": 9999},
            )
            self.assertEqual(resp.status_code, 404)

    def test_promote_409_into_dynamic_collection(self) -> None:
        with self._client() as c:
            wid, item_id, _ = self._seed_item_and_collection(c)
            cid = c.post(
                "/api/v1/collections",
                json={"name": "all fire", "kind": "dynamic", "rule": {"types": ["Fire"]}},
            ).json()["id"]
            resp = c.post(
                f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                json={"collection_id": cid},
            )
            self.assertEqual(resp.status_code, 409)

    def test_promote_404_when_item_in_other_wishlist(self) -> None:
        with self._client() as c:
            wid_a = c.post("/api/v1/wishlists", json={"name": "a"}).json()["id"]
            wid_b = c.post("/api/v1/wishlists", json={"name": "b"}).json()["id"]
            item_id = c.post(f"/api/v1/wishlists/{wid_a}/items", json={"card": SAMPLE_CARD}).json()[
                "id"
            ]
            cid = c.post("/api/v1/collections", json={"name": "binder"}).json()["id"]
            resp = c.post(
                f"/api/v1/wishlists/{wid_b}/items/{item_id}/promote",
                json={"collection_id": cid},
            )
            self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# Auth gating
# ---------------------------------------------------------------------------


class WishlistsAuthGateTests(_IsolatedDbMixin):
    """Mirror of CollectionsAuthGateTests for the wishlists tree."""

    def setUp(self) -> None:
        super().setUp()
        from api.auth.session import AUTH_ENABLED_ENV

        self._old_auth = os.environ.get(AUTH_ENABLED_ENV)
        os.environ[AUTH_ENABLED_ENV] = "1"

    def tearDown(self) -> None:
        from api.auth.session import AUTH_ENABLED_ENV

        if self._old_auth is None:
            os.environ.pop(AUTH_ENABLED_ENV, None)
        else:
            os.environ[AUTH_ENABLED_ENV] = self._old_auth
        super().tearDown()

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def _seed_user(self, name: str, email: str) -> int:
        from api.db.models import User

        with session_mod.get_session_factory()() as s:
            u = User(name=name, email=email, display_name=name.title())
            s.add(u)
            s.commit()
            return u.id

    def _as(self, user_id: int):
        from contextlib import contextmanager

        from api.auth.session import get_current_user
        from api.db.models import User
        from api.main import app

        @contextmanager
        def _ctx():
            with session_mod.get_session_factory()() as s:
                u = s.get(User, user_id)
            app.dependency_overrides[get_current_user] = lambda: u
            try:
                yield
            finally:
                app.dependency_overrides.pop(get_current_user, None)

        return _ctx()

    def test_anonymous_get_list_is_401(self) -> None:
        with self._client() as c:
            self.assertEqual(c.get("/api/v1/wishlists").status_code, 401)

    def test_anonymous_create_is_401(self) -> None:
        with self._client() as c:
            self.assertEqual(c.post("/api/v1/wishlists", json={"name": "x"}).status_code, 401)

    def test_cross_account_isolation(self) -> None:
        with self._client() as c:
            uid_a = self._seed_user("alice", "a@x.com")
            uid_b = self._seed_user("bob", "b@x.com")

            with self._as(uid_a):
                wid = c.post("/api/v1/wishlists", json={"name": "alice-only"}).json()["id"]
                item_id = c.post(
                    f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD}
                ).json()["id"]

            with self._as(uid_b):
                self.assertEqual(c.get("/api/v1/wishlists").json()["total"], 0)
                self.assertEqual(c.get(f"/api/v1/wishlists/{wid}").status_code, 404)
                self.assertEqual(
                    c.patch(f"/api/v1/wishlists/{wid}", json={"name": "x"}).status_code, 404
                )
                self.assertEqual(c.delete(f"/api/v1/wishlists/{wid}").status_code, 404)
                self.assertEqual(
                    c.post(
                        f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD}
                    ).status_code,
                    404,
                )
                self.assertEqual(
                    c.delete(f"/api/v1/wishlists/{wid}/items/{item_id}").status_code,
                    404,
                )
                cid = c.post("/api/v1/collections", json={"name": "bob-binder"}).json()["id"]
                self.assertEqual(
                    c.post(
                        f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                        json={"collection_id": cid},
                    ).status_code,
                    404,
                )


if __name__ == "__main__":
    unittest.main()
