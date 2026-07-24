"""Tests for `DELETE /api/v1/me` — account deletion + cascade (#950).

Covers:

- 401 for a signed-out caller.
- 404 when auth is off (self-host has no account to delete).
- Cascade: every user-owned record (runs, collections + items, wishlists
  + items, binders, favorite sets/species, swipe history, linked
  identities) is gone after the call.
- Cross-account isolation: deleting user A never touches user B's rows.
- Post-delete signed-out state: the session cookie no longer resolves to
  a user, and re-authenticating via a previously-linked provider mints a
  fresh account rather than resurrecting the deleted one.

Mirrors the setup/fixture pattern from `tests/test_auth_links.py` and
`tests/test_me_export_api.py`.
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
from sqlalchemy import func, select

from api.auth.magic import sign_token
from api.auth.session import AUTH_ENABLED_ENV, SESSION_SECRET_ENV
from api.db import session as session_mod
from api.db.models import (
    PROVIDER_GITHUB,
    Binder,
    Collection,
    FavoriteSet,
    FavoriteSpecies,
    Run,
    RunRow,
    SwipeSeen,
    User,
    UserIdentity,
    Wishlist,
)

CHARIZARD = {
    "id": "base1-4",
    "name": "Charizard",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "4",
    "rarity": "Rare Holo",
}
PIKACHU = {
    "id": "base1-58",
    "name": "Pikachu",
    "set": {"id": "base1", "name": "Base Set"},
    "number": "58",
    "rarity": "Common",
}


class _IsolatedDbMixin(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "test.db"
        self._saved_env = {
            k: os.environ.get(k)
            for k in ("MGZ_PKMN_DATABASE_URL", AUTH_ENABLED_ENV, SESSION_SECRET_ENV)
        }
        os.environ["MGZ_PKMN_DATABASE_URL"] = f"sqlite:///{self._db_path}"
        os.environ[AUTH_ENABLED_ENV] = "1"
        os.environ[SESSION_SECRET_ENV] = "unit-test-secret-do-not-care"
        session_mod.reset_engine()

    def tearDown(self) -> None:
        session_mod.reset_engine()
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()

    def _client(self) -> TestClient:
        from api.main import app

        return TestClient(app)


def _sign_in_magic(client: TestClient, email: str) -> int:
    """Drive the real magic callback so the TestClient has a session cookie."""
    r = client.get(
        f"/api/v1/auth/magic/callback?token={sign_token(email)}",
        follow_redirects=False,
    )
    assert r.status_code == 302
    with session_mod.get_session_factory()() as s:
        user = s.scalar(select(User).where(User.email == email))
        assert user is not None
        return user.id


class DeleteMeGateTests(_IsolatedDbMixin):
    def test_signed_out_gets_401(self) -> None:
        with self._client() as c:
            r = c.delete("/api/v1/me")
            self.assertEqual(r.status_code, 401)
            self.assertEqual(r.json()["detail"], "sign-in required")

    def test_auth_off_gets_404(self) -> None:
        os.environ.pop(AUTH_ENABLED_ENV, None)
        with self._client() as c:
            r = c.delete("/api/v1/me")
            self.assertEqual(r.status_code, 404)


class DeleteMeCascadeTests(_IsolatedDbMixin):
    def _seed_everything(self, client: TestClient, user_id: int) -> None:
        with session_mod.get_session_factory()() as s:
            s.add(
                Run(
                    user_id=user_id,
                    input_text="Charizard",
                    summary_json={"total_rows": 1, "matched": 1},
                    rows=[
                        RunRow(
                            position=0,
                            tag="",
                            market_price=42.50,
                            currency="USD",
                            query_json={"raw": "Charizard"},
                            card_json={"id": "base1-4"},
                            pricing_json={"market": 42.50, "currency": "USD"},
                        )
                    ],
                )
            )
            s.add(
                UserIdentity(
                    user_id=user_id,
                    provider=PROVIDER_GITHUB,
                    provider_subject="deleteme",
                    email="deleteme@example.com",
                )
            )
            s.commit()

        cid = client.post("/api/v1/collections", json={"name": "Show Binder"}).json()["id"]
        client.post(f"/api/v1/collections/{cid}/items", json={"card": CHARIZARD})

        wid = client.post("/api/v1/wishlists", json={"name": "Hunt"}).json()["id"]
        client.post(f"/api/v1/wishlists/{wid}/items", json={"card": PIKACHU})

        client.post("/api/v1/binders", json={"name": "Trade Binder"})
        client.post("/api/v1/favorite-sets", json={"set_id": "base1"})
        client.post("/api/v1/favorite-pokemon", json={"dex_number": 6})
        client.post("/api/v1/swipe/seen", json={"set_id": "base1", "number": "4", "dir": "save"})

    def test_delete_cascades_every_owned_record_and_clears_session(self) -> None:
        with self._client() as c:
            user_id = _sign_in_magic(c, "deleteme@example.com")
            self._seed_everything(c, user_id)

            r = c.delete("/api/v1/me")
            self.assertEqual(r.status_code, 204)

            # Session cookie no longer resolves to a user.
            me = c.get("/api/v1/me")
            self.assertEqual(me.status_code, 200)
            self.assertIsNone(me.json()["user"])

        with session_mod.get_session_factory()() as s:
            self.assertIsNone(s.get(User, user_id))
            self.assertEqual(
                s.scalar(select(func.count()).select_from(Run).where(Run.user_id == user_id)), 0
            )
            self.assertEqual(
                s.scalar(
                    select(func.count())
                    .select_from(Collection)
                    .where(Collection.user_id == user_id)
                ),
                0,
            )
            self.assertEqual(
                s.scalar(
                    select(func.count()).select_from(Wishlist).where(Wishlist.user_id == user_id)
                ),
                0,
            )
            self.assertEqual(
                s.scalar(select(func.count()).select_from(Binder).where(Binder.user_id == user_id)),
                0,
            )
            self.assertEqual(
                s.scalar(
                    select(func.count())
                    .select_from(FavoriteSet)
                    .where(FavoriteSet.user_id == user_id)
                ),
                0,
            )
            self.assertEqual(
                s.scalar(
                    select(func.count())
                    .select_from(FavoriteSpecies)
                    .where(FavoriteSpecies.user_id == user_id)
                ),
                0,
            )
            self.assertEqual(
                s.scalar(
                    select(func.count()).select_from(SwipeSeen).where(SwipeSeen.user_id == user_id)
                ),
                0,
            )
            self.assertEqual(
                s.scalar(
                    select(func.count())
                    .select_from(UserIdentity)
                    .where(UserIdentity.user_id == user_id)
                ),
                0,
            )

    def test_delete_never_touches_another_users_data(self) -> None:
        with self._client() as c:
            victim_id = _sign_in_magic(c, "victim@example.com")
            self._seed_everything(c, victim_id)

        with self._client() as c:
            deleter_id = _sign_in_magic(c, "deleteme2@example.com")
            self.assertNotEqual(deleter_id, victim_id)
            r = c.delete("/api/v1/me")
            self.assertEqual(r.status_code, 204)

        with session_mod.get_session_factory()() as s:
            self.assertIsNotNone(s.get(User, victim_id))
            self.assertEqual(
                s.scalar(
                    select(func.count())
                    .select_from(Collection)
                    .where(Collection.user_id == victim_id)
                ),
                1,
            )

    def test_relinking_a_previously_deleted_identity_mints_a_fresh_account(self) -> None:
        with self._client() as c:
            _sign_in_magic(c, "reborn@example.com")
            cid = c.post("/api/v1/collections", json={"name": "Old Life"}).json()["id"]
            c.post(f"/api/v1/collections/{cid}/items", json={"card": CHARIZARD})
            r = c.delete("/api/v1/me")
            self.assertEqual(r.status_code, 204)

        with self._client() as c:
            # SQLite may reuse the deleted row's id (no AUTOINCREMENT
            # keyword) — what matters is the *data* doesn't come back.
            _sign_in_magic(c, "reborn@example.com")
            collections = c.get("/api/v1/collections").json()
            self.assertEqual(collections["items"], [])


if __name__ == "__main__":
    unittest.main()
