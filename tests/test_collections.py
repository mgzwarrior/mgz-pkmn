"""Tests for `/api/v1/collections` (ADR-0013 slice 3).

Covers:

- Alembic migration up/down round-trip for `collections` and
  `collection_items`.
- All CRUD endpoints + 404 paths.
- "Add card to collection" round-trip end-to-end.
- Cascade delete: removing a collection drops its items.

Mirrors the isolation pattern from `tests/test_persistence.py` — each
test points `MGZ_PKMN_DATABASE_URL` at a fresh tempfile so the user's
real `~/.cache/mgz-pkmn/mgz-pkmn.db` is never touched.
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
from api.db.models import CollectionItem


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
    "types": ["Fire"],
}

EEVEE_CARD = {
    "id": "sv1-130",
    "name": "Eevee",
    "set": {"id": "sv1", "name": "Scarlet & Violet"},
    "number": "130",
    "rarity": "Common",
    "images": {"small": "https://example.com/eevee.png"},
    "types": ["Colorless"],
}

VAPOREON_CARD = {
    "id": "sv1-131",
    "name": "Vaporeon",
    "set": {"id": "sv1", "name": "Scarlet & Violet"},
    "number": "131",
    "rarity": "Rare",
    "images": {"small": "https://example.com/vaporeon.png"},
    "types": ["Water"],
}


# ---------------------------------------------------------------------------
# Migration round-trip
# ---------------------------------------------------------------------------


class CollectionsMigrationTests(_IsolatedDbMixin):
    def test_upgrade_creates_collections_tables(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("collections", names)
        self.assertIn("collection_items", names)

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("collections", set(inspect(engine).get_table_names()))

        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        # Downgrade to the auth-foundation revision so the collections
        # slice is dropped regardless of what later slices have been
        # stacked on top (wishlists, etc.). Targeting a fixed revision
        # keeps the round-trip stable as the migration chain grows.
        command.downgrade(cfg, "9c4f2a7d8e15")
        names = set(inspect(engine).get_table_names())
        self.assertNotIn("collections", names)
        self.assertNotIn("collection_items", names)
        self.assertIn("users", names)

        upgrade_head(engine)
        names = set(inspect(engine).get_table_names())
        self.assertIn("collections", names)
        self.assertIn("collection_items", names)


class CollectionsModelReworkMigrationTests(_IsolatedDbMixin):
    """The collections-rework revision (#574) is the foundation every
    other child in the epic builds on, so the schema it lands must be
    well-defined: promoted columns on both item tables, quantity on
    ``collection_items``, ``kind`` on ``collections``, and a
    ``collection_snapshots`` table."""

    def test_promoted_columns_present_on_collection_items(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("collection_items")}
        for col in (
            "quantity",
            "card_set_id",
            "card_number",
            "card_name",
            "card_rarity",
            "card_types_json",
            "card_image_url",
            "price_snapshot",
            "priced_at",
            "added_via",
        ):
            self.assertIn(col, cols, f"expected collection_items.{col}")

    def test_promoted_columns_present_on_wishlist_items(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("wishlist_items")}
        for col in (
            "card_set_id",
            "card_number",
            "card_name",
            "card_image_url",
            "acquired_at",
            "acquired_collection_item_id",
        ):
            self.assertIn(col, cols, f"expected wishlist_items.{col}")

    def test_collections_carries_kind_and_rule_columns(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        self.assertIn("kind", cols)
        self.assertIn("source_set_id", cols)
        self.assertIn("rule_json", cols)

    def test_collection_snapshots_table_exists(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        self.assertIn("collection_snapshots", set(inspect(engine).get_table_names()))

    def test_backfill_populates_promoted_columns_on_legacy_rows(self) -> None:
        # Real-world parity check: roll the schema to the revision
        # *before* this one, insert a row that only carries ``card_json``
        # (i.e. exactly what existing prod rows look like), then upgrade.
        # The promoted columns must come out populated, not null.
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))

        # Step back to the immediate parent of the rework revision.
        command.downgrade(cfg, "7d2e3a8c4b91")

        from sqlalchemy import text

        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO collections (user_id, name, created_at) VALUES (1, 'legacy', :ts)"
                ),
                {"ts": "2026-06-01 00:00:00"},
            )
            cid = conn.execute(text("SELECT id FROM collections")).scalar_one()
            import json as _json

            conn.execute(
                text(
                    "INSERT INTO collection_items "
                    "(collection_id, card_json, added_at) "
                    "VALUES (:cid, :card, :ts)"
                ),
                {
                    "cid": cid,
                    "card": _json.dumps(SAMPLE_CARD),
                    "ts": "2026-06-01 00:00:00",
                },
            )

        upgrade_head(engine)

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT card_set_id, card_number, card_name, card_image_url, "
                    "       quantity, added_via "
                    "FROM collection_items"
                )
            ).one()
        self.assertEqual(row.card_set_id, "base1")
        self.assertEqual(row.card_number, "4")
        self.assertEqual(row.card_name, "Charizard")
        self.assertEqual(row.card_image_url, "https://example.com/charizard.png")
        # quantity carries its server-default for the legacy row.
        self.assertEqual(row.quantity, 1)
        # added_via was nullable on backfill; legacy rows stay None.
        self.assertIsNone(row.added_via)


class DynamicScopeMigrationTests(_IsolatedDbMixin):
    """The #631 ``collections.dynamic_scope`` column lands additively and
    round-trips down/up without disturbing the rest of the schema."""

    def test_dynamic_scope_column_present(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        self.assertIn("dynamic_scope", cols)

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))

        # Step back past the dynamic_scope revision to its parent.
        command.downgrade(cfg, "b3f1a9c2d7e4")
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        self.assertNotIn("dynamic_scope", cols)

        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        self.assertIn("dynamic_scope", cols)


# ---------------------------------------------------------------------------
# Endpoint behavior
# ---------------------------------------------------------------------------


class CollectionsEndpointTests(_IsolatedDbMixin):
    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_list_is_empty_when_no_collections(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/collections")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body, {"items": [], "total": 0})

    def test_create_then_list(self) -> None:
        with self._client() as c:
            created = c.post(
                "/api/v1/collections",
                json={"name": "Binder candidates", "description": "for the show"},
            )
            self.assertEqual(created.status_code, 201)
            body = created.json()
            self.assertEqual(body["name"], "Binder candidates")
            self.assertEqual(body["description"], "for the show")
            self.assertEqual(body["items"], [])
            self.assertTrue(body["id"])

            listing = c.get("/api/v1/collections").json()
            self.assertEqual(listing["total"], 1)
            self.assertEqual(listing["items"][0]["name"], "Binder candidates")
            self.assertEqual(listing["items"][0]["item_count"], 0)

    def test_create_rejects_blank_name(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections", json={"name": ""})
            self.assertEqual(resp.status_code, 422)

    def test_get_404_for_missing(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/collections/9999")
            self.assertEqual(resp.status_code, 404)

    def test_patch_renames_and_clears_description(self) -> None:
        with self._client() as c:
            cid = c.post(
                "/api/v1/collections",
                json={"name": "Old", "description": "keep me"},
            ).json()["id"]

            renamed = c.patch(f"/api/v1/collections/{cid}", json={"name": "New"}).json()
            self.assertEqual(renamed["name"], "New")
            # description omitted from the PATCH body — preserved.
            self.assertEqual(renamed["description"], "keep me")

            cleared = c.patch(f"/api/v1/collections/{cid}", json={"description": None}).json()
            self.assertIsNone(cleared["description"])

    def test_patch_404_for_missing(self) -> None:
        with self._client() as c:
            resp = c.patch("/api/v1/collections/9999", json={"name": "x"})
            self.assertEqual(resp.status_code, 404)

    def test_delete_collection_cascades_items(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "delete me"}).json()["id"]
            c.post(
                f"/api/v1/collections/{cid}/items",
                json={"card": SAMPLE_CARD},
            )
            resp = c.delete(f"/api/v1/collections/{cid}")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(c.get(f"/api/v1/collections/{cid}").status_code, 404)
            # No orphaned items left behind.
            with session_mod.get_session_factory()() as s:
                self.assertEqual(
                    s.scalar(select(CollectionItem).where(CollectionItem.collection_id == cid)),
                    None,
                )

    def test_add_card_round_trip(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Charizard masters"}).json()["id"]

            added = c.post(
                f"/api/v1/collections/{cid}/items",
                json={"card": SAMPLE_CARD, "notes": "near-mint"},
            )
            self.assertEqual(added.status_code, 201)
            item = added.json()
            self.assertEqual(item["card"]["id"], "base1-4")
            self.assertEqual(item["notes"], "near-mint")
            self.assertTrue(item["id"])

            detail = c.get(f"/api/v1/collections/{cid}").json()
            self.assertEqual(len(detail["items"]), 1)
            self.assertEqual(detail["items"][0]["card"]["name"], "Charizard")

            listing = c.get("/api/v1/collections").json()
            self.assertEqual(listing["items"][0]["item_count"], 1)

    def test_add_item_404_for_missing_collection(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections/9999/items", json={"card": SAMPLE_CARD})
            self.assertEqual(resp.status_code, 404)

    def test_delete_item_removes_one_and_returns_204(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "k"}).json()["id"]
            item_id = c.post(f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD}).json()[
                "id"
            ]

            resp = c.delete(f"/api/v1/collections/{cid}/items/{item_id}")
            self.assertEqual(resp.status_code, 204)
            self.assertEqual(len(c.get(f"/api/v1/collections/{cid}").json()["items"]), 0)

    def test_add_item_promotes_card_identity_and_defaults_quantity(self) -> None:
        # The promoted columns are what every other surface in the epic
        # queries against — the ownership badge (#576), the insights
        # dashboard (#575), library-aware swipe (#581). They have to
        # land on every new insert without the caller asking for them.
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "k"}).json()["id"]
            item = c.post(f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD}).json()
            self.assertEqual(item["quantity"], 1)
            self.assertEqual(item["card_set_id"], "base1")
            self.assertEqual(item["card_number"], "4")
            self.assertEqual(item["card_name"], "Charizard")
            self.assertEqual(item["card_rarity"], "Rare Holo")
            self.assertEqual(item["card_image_url"], "https://example.com/charizard.png")
            self.assertEqual(item["added_via"], "manual")

    def test_add_item_accepts_quantity_and_added_via(self) -> None:
        # Vendor multiples ride on ``quantity``; the wishlist promote
        # endpoint (#504) and haul mode (#509) will pass ``added_via``.
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "k"}).json()["id"]
            item = c.post(
                f"/api/v1/collections/{cid}/items",
                json={"card": SAMPLE_CARD, "quantity": 3, "added_via": "haul"},
            ).json()
            self.assertEqual(item["quantity"], 3)
            self.assertEqual(item["added_via"], "haul")

    def test_add_item_rejects_zero_quantity(self) -> None:
        # ``quantity = 0`` would mean "I own zero of this" — that's a
        # delete, not an insert. 422 keeps the caller honest.
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "k"}).json()["id"]
            resp = c.post(
                f"/api/v1/collections/{cid}/items",
                json={"card": SAMPLE_CARD, "quantity": 0},
            )
            self.assertEqual(resp.status_code, 422)

    def test_delete_item_404_when_wrong_collection(self) -> None:
        with self._client() as c:
            cid_a = c.post("/api/v1/collections", json={"name": "a"}).json()["id"]
            cid_b = c.post("/api/v1/collections", json={"name": "b"}).json()["id"]
            item_id = c.post(
                f"/api/v1/collections/{cid_a}/items", json={"card": SAMPLE_CARD}
            ).json()["id"]

            # Item exists, but not in collection B.
            resp = c.delete(f"/api/v1/collections/{cid_b}/items/{item_id}")
            self.assertEqual(resp.status_code, 404)

    def test_bulk_add_items_round_trip(self) -> None:
        # #268 — drop a multi-select of matched rows into a collection in one
        # call. Each card lands as its own row and the response carries them.
        second = {**SAMPLE_CARD, "id": "base1-2", "name": "Blastoise", "number": "2"}
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Show haul"}).json()["id"]

            resp = c.post(
                f"/api/v1/collections/{cid}/items/bulk",
                json={"cards": [SAMPLE_CARD, second], "added_via": "bulk"},
            )
            self.assertEqual(resp.status_code, 201)
            body = resp.json()
            self.assertEqual(body["added"], 2)
            self.assertEqual({i["card"]["name"] for i in body["items"]}, {"Charizard", "Blastoise"})
            self.assertTrue(all(i["added_via"] == "bulk" for i in body["items"]))

            detail = c.get(f"/api/v1/collections/{cid}").json()
            self.assertEqual(len(detail["items"]), 2)
            self.assertEqual(c.get("/api/v1/collections").json()["items"][0]["item_count"], 2)

    def test_bulk_add_rejects_empty_list(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "k"}).json()["id"]
            resp = c.post(f"/api/v1/collections/{cid}/items/bulk", json={"cards": []})
            self.assertEqual(resp.status_code, 422)

    def test_bulk_add_404_for_missing_collection(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections/9999/items/bulk", json={"cards": [SAMPLE_CARD]})
            self.assertEqual(resp.status_code, 404)

    def test_bulk_add_rejects_dynamic_collection(self) -> None:
        # A dynamic collection's membership is its rule — direct adds are 409,
        # same as the single-item endpoint.
        with self._client() as c:
            cid = c.post(
                "/api/v1/collections",
                json={"name": "All Eevees", "kind": "dynamic", "rule": {"name": "eevee"}},
            ).json()["id"]
            resp = c.post(f"/api/v1/collections/{cid}/items/bulk", json={"cards": [SAMPLE_CARD]})
            self.assertEqual(resp.status_code, 409)


# ---------------------------------------------------------------------------
# Dynamic (rule-based) collections (#506)
# ---------------------------------------------------------------------------


class DynamicCollectionTests(_IsolatedDbMixin):
    """A dynamic collection stores a rule and resolves its membership from
    the user's owned cards on read — never materialised as item rows."""

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def _seed_owned(self, c: TestClient, *cards: dict) -> int:
        """Drop the given cards into a plain manual collection so the
        dynamic resolver has owned inventory to match against."""
        cid = c.post("/api/v1/collections", json={"name": "binder"}).json()["id"]
        for card in cards:
            c.post(f"/api/v1/collections/{cid}/items", json={"card": card})
        return cid

    def test_create_dynamic_requires_a_rule(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections", json={"name": "x", "kind": "dynamic"})
            self.assertEqual(resp.status_code, 422)

    def test_create_dynamic_rejects_empty_rule(self) -> None:
        with self._client() as c:
            resp = c.post(
                "/api/v1/collections",
                json={"name": "x", "kind": "dynamic", "rule": {}},
            )
            self.assertEqual(resp.status_code, 422)

    def test_create_dynamic_rejects_unknown_rule_key(self) -> None:
        with self._client() as c:
            resp = c.post(
                "/api/v1/collections",
                json={"name": "x", "kind": "dynamic", "rule": {"colour": "Fire"}},
            )
            self.assertEqual(resp.status_code, 422)

    def test_create_rejects_unknown_kind(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections", json={"name": "x", "kind": "bogus"})
            self.assertEqual(resp.status_code, 422)

    def test_create_set_requires_source_set_id(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections", json={"name": "x", "kind": "set"})
            self.assertEqual(resp.status_code, 422)
            ok = c.post(
                "/api/v1/collections",
                json={"name": "base", "kind": "set", "source_set_id": "base1"},
            )
            self.assertEqual(ok.status_code, 201)
            self.assertEqual(ok.json()["kind"], "set")
            self.assertEqual(ok.json()["source_set_id"], "base1")

    def test_dynamic_resolves_by_name(self) -> None:
        with self._client() as c:
            self._seed_owned(c, SAMPLE_CARD, EEVEE_CARD, VAPOREON_CARD)
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "all Eevees", "kind": "dynamic", "rule": {"name": "eevee"}},
            ).json()
            self.assertEqual(dyn["kind"], "dynamic")
            self.assertEqual(dyn["rule"], {"name": "eevee"})

            detail = c.get(f"/api/v1/collections/{dyn['id']}").json()
            names = [i["card_name"] for i in detail["items"]]
            self.assertEqual(names, ["Eevee"])

    def test_dynamic_resolves_by_type(self) -> None:
        with self._client() as c:
            self._seed_owned(c, SAMPLE_CARD, EEVEE_CARD, VAPOREON_CARD)
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "fire", "kind": "dynamic", "rule": {"types": ["Fire"]}},
            ).json()
            detail = c.get(f"/api/v1/collections/{dyn['id']}").json()
            names = {i["card_name"] for i in detail["items"]}
            self.assertEqual(names, {"Charizard"})

    def test_dynamic_resolves_by_set(self) -> None:
        with self._client() as c:
            self._seed_owned(c, SAMPLE_CARD, EEVEE_CARD, VAPOREON_CARD)
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "sv1", "kind": "dynamic", "rule": {"set_id": "sv1"}},
            ).json()
            detail = c.get(f"/api/v1/collections/{dyn['id']}").json()
            names = {i["card_name"] for i in detail["items"]}
            self.assertEqual(names, {"Eevee", "Vaporeon"})

    def test_dynamic_count_in_list_view_reflects_membership(self) -> None:
        with self._client() as c:
            self._seed_owned(c, SAMPLE_CARD, EEVEE_CARD, VAPOREON_CARD)
            c.post(
                "/api/v1/collections",
                json={"name": "sv1", "kind": "dynamic", "rule": {"set_id": "sv1"}},
            )
            listing = c.get("/api/v1/collections").json()
            dyn = next(i for i in listing["items"] if i["kind"] == "dynamic")
            self.assertEqual(dyn["item_count"], 2)

    def test_dynamic_membership_grows_as_inventory_grows(self) -> None:
        with self._client() as c:
            owned = self._seed_owned(c, EEVEE_CARD)
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "sv1", "kind": "dynamic", "rule": {"set_id": "sv1"}},
            ).json()
            before = c.get(f"/api/v1/collections/{dyn['id']}").json()
            self.assertEqual(len(before["items"]), 1)

            c.post(f"/api/v1/collections/{owned}/items", json={"card": VAPOREON_CARD})
            after = c.get(f"/api/v1/collections/{dyn['id']}").json()
            self.assertEqual(len(after["items"]), 2)

    def test_dynamic_does_not_materialise_item_rows(self) -> None:
        with self._client() as c:
            self._seed_owned(c, EEVEE_CARD)
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "sv1", "kind": "dynamic", "rule": {"set_id": "sv1"}},
            ).json()
            with session_mod.get_session_factory()() as s:
                rows = s.scalars(
                    select(CollectionItem).where(CollectionItem.collection_id == dyn["id"])
                ).all()
            self.assertEqual(list(rows), [])

    def test_cannot_add_items_to_dynamic(self) -> None:
        with self._client() as c:
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "fire", "kind": "dynamic", "rule": {"types": ["Fire"]}},
            ).json()
            resp = c.post(f"/api/v1/collections/{dyn['id']}/items", json={"card": SAMPLE_CARD})
            self.assertEqual(resp.status_code, 409)

    def test_patch_rule_repoints_membership(self) -> None:
        with self._client() as c:
            self._seed_owned(c, SAMPLE_CARD, EEVEE_CARD, VAPOREON_CARD)
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "swap", "kind": "dynamic", "rule": {"name": "eevee"}},
            ).json()
            patched = c.patch(
                f"/api/v1/collections/{dyn['id']}",
                json={"rule": {"types": ["Water"]}},
            )
            self.assertEqual(patched.status_code, 200)
            detail = c.get(f"/api/v1/collections/{dyn['id']}").json()
            names = {i["card_name"] for i in detail["items"]}
            self.assertEqual(names, {"Vaporeon"})

    def test_patch_rule_on_manual_collection_is_409(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "manual"}).json()["id"]
            resp = c.patch(f"/api/v1/collections/{cid}", json={"rule": {"name": "x"}})
            self.assertEqual(resp.status_code, 409)

    def test_manual_collection_defaults_to_kind_manual(self) -> None:
        with self._client() as c:
            created = c.post("/api/v1/collections", json={"name": "plain"}).json()
            self.assertEqual(created["kind"], "manual")
            self.assertIsNone(created["rule"])
            self.assertIsNone(created["source_set_id"])


# ---------------------------------------------------------------------------
# Catalog-scope dynamic collections — target view + chase (#631)
# ---------------------------------------------------------------------------


# Three Eevee printings the fake catalog returns for a `name: eevee` rule.
CATALOG_EEVEES = [
    EEVEE_CARD,  # sv1-130
    {
        "id": "sv4-167",
        "name": "Eevee ex",
        "set": {"id": "sv4", "name": "Paradox Rift"},
        "number": "167",
        "rarity": "Double Rare",
        "images": {"small": "https://example.com/eevee-ex.png"},
        "types": ["Colorless"],
    },
    {
        "id": "swsh7-186",
        "name": "Eevee VMAX",
        "set": {"id": "swsh7", "name": "Evolving Skies"},
        "number": "186",
        "rarity": "Rare Rainbow",
        "images": {"small": "https://example.com/eevee-vmax.png"},
        "types": ["Colorless"],
    },
]


class _FakeTCGClient:
    """Stand-in for the pokemontcg.io client — returns a fixed card list so
    the catalog-scope tests never touch the network."""

    def __init__(self, cards: list[dict], *, api_key: str | None = None) -> None:
        self._cards = cards

    def search_all(self, query: str, *args, **kwargs):
        return list(self._cards), "HIT"


class CatalogScopeDynamicTests(_IsolatedDbMixin):
    """A catalog-scope dynamic collection resolves its membership from the
    catalog and overlays ownership — a goal-with-progress target view."""

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def _patch_catalog(self, cards: list[dict]):
        from unittest.mock import patch

        return patch(
            "api.routes.collections.TCGClient",
            lambda api_key=None: _FakeTCGClient(cards, api_key=api_key),
        )

    def _seed_owned(self, c: TestClient, *cards: dict) -> int:
        cid = c.post("/api/v1/collections", json={"name": "binder"}).json()["id"]
        for card in cards:
            c.post(f"/api/v1/collections/{cid}/items", json={"card": card})
        return cid

    def _make_catalog_dynamic(self, c: TestClient, rule: dict) -> dict:
        return c.post(
            "/api/v1/collections",
            json={
                "name": "all Eevees",
                "kind": "dynamic",
                "rule": rule,
                "dynamic_scope": "catalog",
            },
        ).json()

    def test_create_catalog_scope_echoes_scope(self) -> None:
        with self._client() as c:
            dyn = self._make_catalog_dynamic(c, {"name": "eevee"})
            self.assertEqual(dyn["kind"], "dynamic")
            self.assertEqual(dyn["dynamic_scope"], "catalog")

    def test_dynamic_defaults_to_owned_scope(self) -> None:
        with self._client() as c:
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "x", "kind": "dynamic", "rule": {"name": "eevee"}},
            ).json()
            self.assertEqual(dyn["dynamic_scope"], "owned")

    def test_create_rejects_unknown_scope(self) -> None:
        with self._client() as c:
            resp = c.post(
                "/api/v1/collections",
                json={
                    "name": "x",
                    "kind": "dynamic",
                    "rule": {"name": "eevee"},
                    "dynamic_scope": "bogus",
                },
            )
            self.assertEqual(resp.status_code, 422)

    def test_target_overlays_ownership_and_progress(self) -> None:
        with self._client() as c:
            self._seed_owned(c, EEVEE_CARD)  # owns sv1-130 only
            dyn = self._make_catalog_dynamic(c, {"name": "eevee"})
            with self._patch_catalog(CATALOG_EEVEES):
                target = c.get(f"/api/v1/collections/{dyn['id']}/target").json()
            self.assertEqual(target["total"], 3)
            self.assertEqual(target["owned_count"], 1)
            by_id = {tc["card"]["id"]: tc for tc in target["cards"]}
            self.assertTrue(by_id["sv1-130"]["owned"])
            self.assertEqual(by_id["sv1-130"]["owned_quantity"], 1)
            self.assertFalse(by_id["sv4-167"]["owned"])

    def test_target_409_on_owned_scope(self) -> None:
        with self._client() as c:
            dyn = c.post(
                "/api/v1/collections",
                json={"name": "x", "kind": "dynamic", "rule": {"name": "eevee"}},
            ).json()
            resp = c.get(f"/api/v1/collections/{dyn['id']}/target")
            self.assertEqual(resp.status_code, 409)

    def test_target_409_on_manual(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "m"}).json()["id"]
            self.assertEqual(c.get(f"/api/v1/collections/{cid}/target").status_code, 409)

    def test_chase_adds_only_unowned_to_new_wishlist(self) -> None:
        with self._client() as c:
            self._seed_owned(c, EEVEE_CARD)  # owns sv1-130
            dyn = self._make_catalog_dynamic(c, {"name": "eevee"})
            with self._patch_catalog(CATALOG_EEVEES):
                res = c.post(
                    f"/api/v1/collections/{dyn['id']}/chase",
                    json={"wishlist_name": "Eevee chase"},
                ).json()
            self.assertEqual(res["total_missing"], 2)
            self.assertEqual(res["added"], 2)
            self.assertEqual(res["skipped"], 0)

            detail = c.get(f"/api/v1/wishlists/{res['wishlist_id']}").json()
            names = {i["card_name"] for i in detail["items"]}
            self.assertEqual(names, {"Eevee ex", "Eevee VMAX"})

    def test_chase_is_idempotent_on_rerun(self) -> None:
        with self._client() as c:
            self._seed_owned(c, EEVEE_CARD)
            dyn = self._make_catalog_dynamic(c, {"name": "eevee"})
            with self._patch_catalog(CATALOG_EEVEES):
                first = c.post(
                    f"/api/v1/collections/{dyn['id']}/chase",
                    json={"wishlist_name": "Eevee chase"},
                ).json()
                again = c.post(
                    f"/api/v1/collections/{dyn['id']}/chase",
                    json={"wishlist_id": first["wishlist_id"]},
                ).json()
            self.assertEqual(again["added"], 0)
            self.assertEqual(again["skipped"], 2)

    def test_chase_requires_exactly_one_target(self) -> None:
        with self._client() as c:
            dyn = self._make_catalog_dynamic(c, {"name": "eevee"})
            both = c.post(
                f"/api/v1/collections/{dyn['id']}/chase",
                json={"wishlist_id": 1, "wishlist_name": "x"},
            )
            self.assertEqual(both.status_code, 422)
            neither = c.post(f"/api/v1/collections/{dyn['id']}/chase", json={})
            self.assertEqual(neither.status_code, 422)

    def test_chase_404_for_missing_wishlist_id(self) -> None:
        with self._client() as c:
            dyn = self._make_catalog_dynamic(c, {"name": "eevee"})
            with self._patch_catalog(CATALOG_EEVEES):
                resp = c.post(
                    f"/api/v1/collections/{dyn['id']}/chase",
                    json={"wishlist_id": 9999},
                )
            self.assertEqual(resp.status_code, 404)


class RuleToLuceneTests(unittest.TestCase):
    """The rule → pokemontcg.io Lucene translation (#631)."""

    def test_name_becomes_prefix_wildcard(self) -> None:
        from api.db.collection_rules import rule_to_lucene

        self.assertEqual(rule_to_lucene({"name": "Eevee"}), "name:Eevee*")

    def test_multiword_name_is_quoted(self) -> None:
        from api.db.collection_rules import rule_to_lucene

        self.assertEqual(rule_to_lucene({"name": "Mr Mime"}), 'name:"Mr Mime*"')

    def test_predicates_and_together(self) -> None:
        from api.db.collection_rules import rule_to_lucene

        q = rule_to_lucene({"types": ["Fire"], "set_id": "base1", "rarity": "Rare Holo"})
        self.assertIn("types:Fire", q)
        self.assertIn('set.id:"base1"', q)
        self.assertIn('rarity:"Rare Holo"', q)


# ---------------------------------------------------------------------------
# Auth gating
# ---------------------------------------------------------------------------


class CollectionsAuthGateTests(_IsolatedDbMixin):
    """With auth on, every collections endpoint requires sign-in and is
    scoped to the signed-in user's id. Cross-account access 404s, never
    leaks existence."""

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
        """Context-manager hack: install a dep override that pins the
        request to the given user_id for the duration of the call. Mirrors
        the pattern used in MeEndpointAuthOnTests."""
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
            resp = c.get("/api/v1/collections")
            self.assertEqual(resp.status_code, 401)

    def test_anonymous_create_is_401(self) -> None:
        with self._client() as c:
            resp = c.post("/api/v1/collections", json={"name": "x"})
            self.assertEqual(resp.status_code, 401)

    def test_user_a_cannot_see_user_bs_collections_in_list(self) -> None:
        with self._client() as c:
            uid_a = self._seed_user("alice", "a@x.com")
            uid_b = self._seed_user("bob", "b@x.com")

            with self._as(uid_a):
                c.post("/api/v1/collections", json={"name": "alice-only"})
            with self._as(uid_b):
                listing = c.get("/api/v1/collections").json()
                self.assertEqual(listing["total"], 0)

    def test_user_a_cannot_get_user_bs_collection_by_id(self) -> None:
        with self._client() as c:
            uid_a = self._seed_user("alice", "a@x.com")
            uid_b = self._seed_user("bob", "b@x.com")

            with self._as(uid_a):
                cid = c.post("/api/v1/collections", json={"name": "alice-only"}).json()["id"]
            with self._as(uid_b):
                # 404 (not 403) — we don't leak existence
                self.assertEqual(c.get(f"/api/v1/collections/{cid}").status_code, 404)
                self.assertEqual(
                    c.patch(f"/api/v1/collections/{cid}", json={"name": "stolen"}).status_code,
                    404,
                )
                self.assertEqual(c.delete(f"/api/v1/collections/{cid}").status_code, 404)

    def test_user_a_cannot_add_or_delete_items_in_user_bs_collection(self) -> None:
        with self._client() as c:
            uid_a = self._seed_user("alice", "a@x.com")
            uid_b = self._seed_user("bob", "b@x.com")

            with self._as(uid_a):
                cid = c.post("/api/v1/collections", json={"name": "alice-only"}).json()["id"]
                item_id = c.post(
                    f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD}
                ).json()["id"]
            with self._as(uid_b):
                self.assertEqual(
                    c.post(
                        f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD}
                    ).status_code,
                    404,
                )
                self.assertEqual(
                    c.delete(f"/api/v1/collections/{cid}/items/{item_id}").status_code,
                    404,
                )


class CollectionInsightsTests(_IsolatedDbMixin):
    """`GET /api/v1/collections/insights` — the aggregate dashboard (#575)."""

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_insights_empty_when_no_collections(self) -> None:
        with self._client() as c:
            body = c.get("/api/v1/collections/insights").json()
            self.assertEqual(
                body["totals"],
                {"collections": 0, "unique_cards": 0, "total_quantity": 0, "estimated_value": 0.0},
            )
            self.assertEqual(body["top_types"], [])
            self.assertEqual(body["duplicate_multiples"], [])
            self.assertEqual(body["cross_collection"], [])
            self.assertEqual(body["already_owned_chasing"], [])

    def test_insights_totals_and_breakdowns(self) -> None:
        priced = {**SAMPLE_CARD, "market_price": 250.0}  # Charizard, Fire, base1, Rare Holo
        with self._client() as c:
            owned = c.post("/api/v1/collections", json={"name": "Owned"}).json()["id"]
            trade = c.post("/api/v1/collections", json={"name": "Trade Stock"}).json()["id"]
            c.post(f"/api/v1/collections/{owned}/items", json={"card": priced, "quantity": 2})
            c.post(f"/api/v1/collections/{owned}/items", json={"card": EEVEE_CARD})
            c.post(f"/api/v1/collections/{trade}/items", json={"card": VAPOREON_CARD})

            body = c.get("/api/v1/collections/insights").json()
            self.assertEqual(
                body["totals"],
                {
                    "collections": 2,
                    "unique_cards": 3,  # three distinct (set, number) identities
                    "total_quantity": 4,  # 2 + 1 + 1
                    "estimated_value": 500.0,  # 250 * 2; only the Charizard is priced
                },
            )
            sets = {b["label"]: b["count"] for b in body["top_sets"]}
            self.assertEqual(sets["sv1"], 2)  # Eevee + Vaporeon
            self.assertEqual(sets["base1"], 1)
            types = {b["label"]: b["count"] for b in body["top_types"]}
            self.assertEqual(types, {"Fire": 1, "Colorless": 1, "Water": 1})
            rarities = {b["label"]: b["count"] for b in body["top_rarities"]}
            self.assertEqual(rarities["Rare Holo"], 1)

    def test_insights_flags_vendor_multiples(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Trade Stock"}).json()["id"]
            c.post(f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD, "quantity": 3})
            c.post(
                f"/api/v1/collections/{cid}/items", json={"card": EEVEE_CARD}
            )  # qty 1, not a dup

            dups = c.get("/api/v1/collections/insights").json()["duplicate_multiples"]
            self.assertEqual(len(dups), 1)
            self.assertEqual(dups[0]["card_name"], "Charizard")
            self.assertEqual(dups[0]["quantity"], 3)
            self.assertEqual(dups[0]["collection_name"], "Trade Stock")

    def test_insights_flags_cross_collection_cards(self) -> None:
        with self._client() as c:
            a = c.post("/api/v1/collections", json={"name": "Show Binder"}).json()["id"]
            b = c.post("/api/v1/collections", json={"name": "Trade Stock"}).json()["id"]
            c.post(f"/api/v1/collections/{a}/items", json={"card": SAMPLE_CARD})
            c.post(f"/api/v1/collections/{b}/items", json={"card": SAMPLE_CARD, "quantity": 2})
            c.post(f"/api/v1/collections/{a}/items", json={"card": EEVEE_CARD})  # single collection

            cross = c.get("/api/v1/collections/insights").json()["cross_collection"]
            self.assertEqual(len(cross), 1)
            self.assertEqual(cross[0]["card_name"], "Charizard")
            self.assertEqual(cross[0]["total_quantity"], 3)  # 1 + 2
            self.assertEqual(sorted(cross[0]["collections"]), ["Show Binder", "Trade Stock"])

    def test_insights_nudges_cards_you_own_but_still_chase(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Show Binder"}).json()["id"]
            c.post(f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD})
            wid = c.post("/api/v1/wishlists", json={"name": "Chase"}).json()["id"]
            c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD})  # already own it
            c.post(f"/api/v1/wishlists/{wid}/items", json={"card": EEVEE_CARD})  # don't own it

            nudge = c.get("/api/v1/collections/insights").json()["already_owned_chasing"]
            self.assertEqual(len(nudge), 1)
            self.assertEqual(nudge[0]["card_name"], "Charizard")
            self.assertEqual(nudge[0]["wishlist_name"], "Chase")
            self.assertEqual(nudge[0]["collections"], ["Show Binder"])

    def test_insights_excludes_acquired_wishlist_cards(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Show Binder"}).json()["id"]
            c.post(f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD})
            wid = c.post("/api/v1/wishlists", json={"name": "Chase"}).json()["id"]
            item_id = c.post(f"/api/v1/wishlists/{wid}/items", json={"card": SAMPLE_CARD}).json()[
                "id"
            ]
            # Marking the chase complete makes it a retrospective, not a stale
            # want — it should drop out of the cleanup nudge.
            c.post(
                f"/api/v1/wishlists/{wid}/items/{item_id}/promote",
                json={"collection_id": cid},
            )
            nudge = c.get("/api/v1/collections/insights").json()["already_owned_chasing"]
            self.assertEqual(nudge, [])


class CollectionIdCardTests(_IsolatedDbMixin):
    """`GET /api/v1/collections/{id}/id-card.pdf` — printable binder cover (#507)."""

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_id_card_renders_pdf_for_a_manual_collection(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Show Binder"}).json()["id"]
            c.post(f"/api/v1/collections/{cid}/items", json={"card": SAMPLE_CARD})
            # no_images skips the cover fetch so the test stays offline.
            resp = c.get(f"/api/v1/collections/{cid}/id-card.pdf?no_images=true")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.headers["content-type"], "application/pdf")
            self.assertTrue(resp.content.startswith(b"%PDF"))

    def test_id_card_renders_for_an_empty_collection(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Empty"}).json()["id"]
            resp = c.get(f"/api/v1/collections/{cid}/id-card.pdf?no_images=true")
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(resp.content.startswith(b"%PDF"))

    def test_id_card_404_for_missing_collection(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.get("/api/v1/collections/9999/id-card.pdf?no_images=true").status_code, 404
            )

    def test_pick_cover_prefers_the_most_valuable_card(self) -> None:
        from types import SimpleNamespace

        from api.routes.collections import _pick_cover_url

        items = [
            SimpleNamespace(card_image_url="cheap.png", price_snapshot=2.0),
            SimpleNamespace(card_image_url="pricey.png", price_snapshot=300.0),
            SimpleNamespace(card_image_url=None, price_snapshot=999.0),  # no image — skipped
        ]
        self.assertEqual(_pick_cover_url(items), "pricey.png")
        self.assertIsNone(
            _pick_cover_url([SimpleNamespace(card_image_url=None, price_snapshot=1.0)])
        )


class BinderIdentityMigrationTests(_IsolatedDbMixin):
    """The #679 binder-identity columns land additively and round-trip
    down/up without disturbing the rest of the schema."""

    _COLS = ("binder_format", "binder_color", "capacity", "is_master_set")

    def test_binder_columns_present(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        for col in self._COLS:
            self.assertIn(col, cols)

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))

        # Step back past the binder-identity revision to its parent.
        command.downgrade(cfg, "d5e2f7a3c9b1")
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        for col in self._COLS:
            self.assertNotIn(col, cols)

        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        for col in self._COLS:
            self.assertIn(col, cols)


class BinderEndpointTests(_IsolatedDbMixin):
    """`kind='binder'` create/patch carrying the #679 physical identity."""

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def test_create_binder_persists_identity(self) -> None:
        with self._client() as c:
            resp = c.post(
                "/api/v1/collections",
                json={
                    "name": "Trade binder",
                    "kind": "binder",
                    "binder_format": "9-pocket",
                    "binder_color": "palm",
                    "binder_type": "toploader",
                    "capacity": 360,
                },
            )
            self.assertEqual(resp.status_code, 201)
            body = resp.json()
            self.assertEqual(body["kind"], "binder")
            self.assertEqual(body["binder_format"], "9-pocket")
            self.assertEqual(body["binder_color"], "palm")
            self.assertEqual(body["binder_type"], "toploader")
            self.assertEqual(body["capacity"], 360)

            # Identity round-trips through the list view too.
            summary = c.get("/api/v1/collections").json()["items"][0]
            self.assertEqual(summary["binder_color"], "palm")
            self.assertEqual(summary["binder_type"], "toploader")
            self.assertEqual(summary["capacity"], 360)

    def test_create_binder_accepts_custom_hex_color(self) -> None:
        with self._client() as c:
            body = c.post(
                "/api/v1/collections",
                json={"name": "Custom", "kind": "binder", "binder_color": "#1a2b3c"},
            ).json()
            self.assertEqual(body["binder_color"], "#1a2b3c")

    def test_create_rejects_bad_hex_and_unknown_type(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.post(
                    "/api/v1/collections",
                    json={"name": "B", "kind": "binder", "binder_color": "#xyz"},
                ).status_code,
                422,
            )
            self.assertEqual(
                c.post(
                    "/api/v1/collections",
                    json={"name": "B", "kind": "binder", "binder_type": "shoebox"},
                ).status_code,
                422,
            )

    def test_master_set_binder_requires_source_set(self) -> None:
        with self._client() as c:
            resp = c.post(
                "/api/v1/collections",
                json={"name": "Master set", "kind": "binder", "is_master_set": True},
            )
            self.assertEqual(resp.status_code, 422)

            ok = c.post(
                "/api/v1/collections",
                json={
                    "name": "Master set",
                    "kind": "binder",
                    "source_set_id": "sv1",
                    "is_master_set": True,
                },
            )
            self.assertEqual(ok.status_code, 201)
            body = ok.json()
            self.assertTrue(body["is_master_set"])
            self.assertEqual(body["source_set_id"], "sv1")

    def test_create_rejects_unknown_format_and_color(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.post(
                    "/api/v1/collections",
                    json={"name": "B", "kind": "binder", "binder_format": "8-pocket"},
                ).status_code,
                422,
            )
            self.assertEqual(
                c.post(
                    "/api/v1/collections",
                    json={"name": "B", "kind": "binder", "binder_color": "magenta"},
                ).status_code,
                422,
            )

    def test_create_rejects_zero_capacity(self) -> None:
        with self._client() as c:
            self.assertEqual(
                c.post(
                    "/api/v1/collections",
                    json={"name": "B", "kind": "binder", "capacity": 0},
                ).status_code,
                422,
            )

    def test_non_binder_kinds_drop_identity_fields(self) -> None:
        with self._client() as c:
            body = c.post(
                "/api/v1/collections",
                json={"name": "Plain", "binder_color": "palm", "capacity": 100},
            ).json()
            self.assertIsNone(body["binder_color"])
            self.assertIsNone(body["capacity"])

    def test_patch_edits_binder_identity(self) -> None:
        with self._client() as c:
            cid = c.post(
                "/api/v1/collections",
                json={"name": "B", "kind": "binder", "binder_color": "sun"},
            ).json()["id"]

            patched = c.patch(
                f"/api/v1/collections/{cid}",
                json={"binder_color": "sky", "capacity": 180},
            ).json()
            self.assertEqual(patched["binder_color"], "sky")
            self.assertEqual(patched["capacity"], 180)

    def test_summary_total_quantity_counts_vendor_multiples(self) -> None:
        with self._client() as c:
            cid = c.post(
                "/api/v1/collections",
                json={"name": "Bulk binder", "kind": "binder", "capacity": 360},
            ).json()["id"]
            # One row holding four copies — one item, four occupied slots.
            c.post(
                f"/api/v1/collections/{cid}/items",
                json={"card": dict(SAMPLE_CARD), "quantity": 4},
            )
            summary = c.get("/api/v1/collections").json()["items"][0]
            self.assertEqual(summary["item_count"], 1)
            self.assertEqual(summary["total_quantity"], 4)

    def test_patch_identity_on_non_binder_is_409(self) -> None:
        with self._client() as c:
            cid = c.post("/api/v1/collections", json={"name": "Manual"}).json()["id"]
            resp = c.patch(f"/api/v1/collections/{cid}", json={"binder_color": "palm"})
            self.assertEqual(resp.status_code, 409)


class BinderTypeMigrationTests(_IsolatedDbMixin):
    """The #681 ``collections.binder_type`` column lands additively and
    round-trips down/up without disturbing the rest of the schema."""

    def test_binder_type_column_present(self) -> None:
        engine = session_mod.get_engine()
        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        self.assertIn("binder_type", cols)

    def test_round_trip_downgrade_then_reupgrade(self) -> None:
        from alembic import command

        from api.db import migrate as migrate_mod

        engine = session_mod.get_engine()
        upgrade_head(engine)
        cfg = migrate_mod._alembic_config()
        cfg.set_main_option("sqlalchemy.url", str(engine.url))

        command.downgrade(cfg, "f7c4b2a9e6d3")
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        self.assertNotIn("binder_type", cols)

        upgrade_head(engine)
        cols = {c["name"] for c in inspect(engine).get_columns("collections")}
        self.assertIn("binder_type", cols)


class SmartBinderIdentityTests(_IsolatedDbMixin):
    """#681 — a dynamic (smart) binder carries the shared cover/type/master-set
    identity, but not the physical pocket format / capacity."""

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def _make_smart(self, c: TestClient, **extra) -> dict:
        return c.post(
            "/api/v1/collections",
            json={"name": "All Eevees", "kind": "dynamic", "rule": {"name": "eevee"}, **extra},
        ).json()

    def test_smart_binder_carries_shared_identity(self) -> None:
        with self._client() as c:
            body = self._make_smart(c, binder_color="sky", binder_type="graded", is_master_set=True)
            self.assertEqual(body["binder_color"], "sky")
            self.assertEqual(body["binder_type"], "graded")
            self.assertTrue(body["is_master_set"])

    def test_smart_master_set_needs_no_source_set(self) -> None:
        # Unlike a physical binder, a smart master-set flag is just a label —
        # the rule defines membership, so no source_set_id is required.
        with self._client() as c:
            body = self._make_smart(c, is_master_set=True)
            self.assertEqual(c.get(f"/api/v1/collections/{body['id']}").status_code, 200)
            self.assertTrue(body["is_master_set"])

    def test_smart_binder_drops_physical_fields(self) -> None:
        with self._client() as c:
            body = self._make_smart(c, binder_format="9-pocket", capacity=180)
            self.assertIsNone(body["binder_format"])
            self.assertIsNone(body["capacity"])

    def test_patch_physical_field_on_smart_binder_is_409(self) -> None:
        with self._client() as c:
            cid = self._make_smart(c)["id"]
            self.assertEqual(
                c.patch(f"/api/v1/collections/{cid}", json={"capacity": 90}).status_code,
                409,
            )

    def test_patch_identity_on_smart_binder_works(self) -> None:
        with self._client() as c:
            cid = self._make_smart(c)["id"]
            body = c.patch(f"/api/v1/collections/{cid}", json={"binder_color": "ember"}).json()
            self.assertEqual(body["binder_color"], "ember")


if __name__ == "__main__":
    unittest.main()
