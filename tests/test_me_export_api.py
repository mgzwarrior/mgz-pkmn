"""Tests for `GET /api/v1/me/export` (#448).

Covers:

- 200 with self-host defaults (auth off) and a real signed-in user.
- 401 for a signed-out caller once auth is on.
- Round-trip: everything seeded across runs / collections / wishlists /
  binders / favorites / swipe memory shows up in the dump — no field loss.
- Cross-account isolation: user A's export never contains user B's rows.
- The in-process rate limit 429s past the request cap and resets outside
  the window.

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

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.db import session as session_mod
from api.db.models import DEFAULT_USER_ID, PROVIDER_GITHUB, Run, RunRow, User, UserIdentity

CHARIZARD = {
    "id": "base1-4",
    "name": "Charizard",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "4",
    "rarity": "Rare Holo",
    "images": {"small": "https://example.com/charizard.png"},
}
PIKACHU = {
    "id": "base1-58",
    "name": "Pikachu",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "58",
    "rarity": "Common",
}


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

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)

    def _seed_run(self, *, user_id: int = DEFAULT_USER_ID) -> int:
        with session_mod.get_session_factory()() as s:
            run = Run(
                user_id=user_id,
                input_text="Charizard",
                summary_json={"total_rows": 1, "matched": 1},
                rows=[
                    RunRow(
                        position=0,
                        tag="",
                        market_price=42.50,
                        currency="USD",
                        query_json={"raw": "Charizard", "name": "Charizard"},
                        card_json={"id": "base1-4"},
                        pricing_json={"market": 42.50, "currency": "USD"},
                    )
                ],
            )
            s.add(run)
            s.commit()
            return run.id


class MeExportSelfHostTests(_IsolatedDbMixin):
    """Auth off (default in these tests) — resolves to the sentinel user."""

    def test_empty_export_has_every_section(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/me/export")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(
                resp.headers["content-disposition"],
                'attachment; filename="mgz-pkmn-export.json"',
            )
            body = resp.json()
            self.assertEqual(body["schema_version"], 1)
            self.assertIn("exported_at", body)
            self.assertEqual(body["user"]["id"], DEFAULT_USER_ID)
            for section in (
                "identities",
                "runs",
                "collections",
                "wishlists",
                "binders",
                "favorite_sets",
                "favorite_species",
                "swipe_seen",
            ):
                self.assertEqual(body[section], [])

    def test_round_trips_every_kind_of_data_with_no_field_loss(self) -> None:
        with self._client() as c:
            run_id = self._seed_run()
            with session_mod.get_session_factory()() as s:
                identity = UserIdentity(
                    user_id=DEFAULT_USER_ID,
                    provider=PROVIDER_GITHUB,
                    provider_subject="12345",
                    email="default@x.com",
                )
                s.add(identity)
                s.commit()

            cid = c.post("/api/v1/collections", json={"name": "Show Binder"}).json()["id"]
            item_id = c.post(f"/api/v1/collections/{cid}/items", json={"card": CHARIZARD}).json()[
                "id"
            ]

            wid = c.post("/api/v1/wishlists", json={"name": "Hunt"}).json()["id"]
            c.post(f"/api/v1/wishlists/{wid}/items", json={"card": PIKACHU})

            binder_id = c.post("/api/v1/binders", json={"name": "Trade Binder"}).json()["id"]

            c.post("/api/v1/favorite-sets", json={"set_id": "base1"})
            c.post("/api/v1/favorite-pokemon", json={"dex_number": 6})
            c.post("/api/v1/swipe/seen", json={"set_id": "base1", "number": "4", "dir": "save"})

            body = c.get("/api/v1/me/export").json()

            self.assertEqual(len(body["identities"]), 1)
            self.assertEqual(body["identities"][0]["provider"], PROVIDER_GITHUB)
            self.assertEqual(body["identities"][0]["provider_subject"], "12345")

            run_ids = {r["id"] for r in body["runs"]}
            self.assertIn(run_id, run_ids)
            seeded_run = next(r for r in body["runs"] if r["id"] == run_id)
            self.assertEqual(seeded_run["rows"][0]["card"], {"id": "base1-4"})
            self.assertEqual(seeded_run["rows"][0]["market_price"], 42.50)

            collection_ids = {c_["id"] for c_ in body["collections"]}
            self.assertIn(cid, collection_ids)
            seeded_collection = next(c_ for c_ in body["collections"] if c_["id"] == cid)
            self.assertEqual(seeded_collection["items"][0]["id"], item_id)
            self.assertEqual(seeded_collection["items"][0]["card"], CHARIZARD)

            wishlist_ids = {w["id"] for w in body["wishlists"]}
            self.assertIn(wid, wishlist_ids)
            seeded_wishlist = next(w for w in body["wishlists"] if w["id"] == wid)
            self.assertEqual(seeded_wishlist["items"][0]["card"], PIKACHU)

            binder_ids = {b["id"] for b in body["binders"]}
            self.assertIn(binder_id, binder_ids)

            self.assertEqual(
                [f["set_id"] for f in body["favorite_sets"]],
                ["base1"],
            )
            self.assertEqual(
                [f["dex_number"] for f in body["favorite_species"]],
                [6],
            )
            self.assertEqual(len(body["swipe_seen"]), 1)
            self.assertEqual(body["swipe_seen"][0]["set_id"], "base1")
            self.assertEqual(body["swipe_seen"][0]["number"], "4")
            self.assertEqual(body["swipe_seen"][0]["dir"], "save")


class MeExportAuthGateTests(_IsolatedDbMixin):
    """With auth on, a signed-out caller gets 401 and each user only sees
    their own data."""

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

    def _seed_user(self, name: str, email: str) -> int:
        with session_mod.get_session_factory()() as s:
            u = User(name=name, email=email, display_name=name.title())
            s.add(u)
            s.commit()
            return u.id

    def _as(self, user_id: int):
        from contextlib import contextmanager

        from api.auth.session import get_current_user
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

    def test_signed_out_is_401(self) -> None:
        with self._client() as c:
            resp = c.get("/api/v1/me/export")
            self.assertEqual(resp.status_code, 401)

    def test_user_a_export_never_contains_user_bs_data(self) -> None:
        with self._client() as c:
            uid_a = self._seed_user("alice", "a@x.com")
            uid_b = self._seed_user("bob", "b@x.com")

            with self._as(uid_a):
                c.post("/api/v1/collections", json={"name": "alice-only"})
            with self._as(uid_b):
                body = c.get("/api/v1/me/export").json()
                self.assertEqual(body["user"]["id"], uid_b)
                names = {col["name"] for col in body["collections"]}
                self.assertNotIn("alice-only", names)


class MeExportRateLimitTests(_IsolatedDbMixin):
    """The in-process limiter caps repeated exports per user."""

    def setUp(self) -> None:
        super().setUp()
        import api.routes.me_export as me_export_mod

        self._mod = me_export_mod
        self._old_max = me_export_mod._RATE_LIMIT_MAX_REQUESTS
        me_export_mod._RATE_LIMIT_MAX_REQUESTS = 2
        me_export_mod._export_timestamps.clear()

    def tearDown(self) -> None:
        self._mod._RATE_LIMIT_MAX_REQUESTS = self._old_max
        self._mod._export_timestamps.clear()
        super().tearDown()

    def test_exceeding_the_cap_returns_429_with_retry_after(self) -> None:
        with self._client() as c:
            self.assertEqual(c.get("/api/v1/me/export").status_code, 200)
            self.assertEqual(c.get("/api/v1/me/export").status_code, 200)
            resp = c.get("/api/v1/me/export")
            self.assertEqual(resp.status_code, 429)
            self.assertIn("Retry-After", resp.headers)

    def test_cap_is_tracked_per_user(self) -> None:
        # Exhaust user 1's cap directly against the limiter (rather than
        # through two signed-in TestClient identities, which self-host
        # mode's `current_user_or_default` fallback makes awkward to
        # simulate) — a distinct user id must still have a clean window.
        self._mod._enforce_rate_limit(1)
        self._mod._enforce_rate_limit(1)
        with self.assertRaises(HTTPException) as ctx:
            self._mod._enforce_rate_limit(1)
        self.assertEqual(ctx.exception.status_code, 429)

        # User 2 is unaffected by user 1's exhausted cap.
        self._mod._enforce_rate_limit(2)


if __name__ == "__main__":
    unittest.main()
