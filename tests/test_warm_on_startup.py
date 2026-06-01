"""Pin that `MGZ_PKMN_WARM_ON_STARTUP=1` actually fires the warm bootstrap.

Regression coverage for #367: when the Alembic auto-migrate lifespan was
added, the warm bootstrap kept being wired via `@app.on_event("startup")`
— which Starlette silently ignores when a custom `lifespan` is provided.
The warm pass never fired on deployed instances; `concept_warm_timestamp`
and `set_cards_warm_timestamp` stayed `null` on `/api/v1/cache/stats`
despite the env var being set. This test would have caught it.

The shape mirrors `tests/test_persistence.py::AutomigrateOptOutTests` —
patch the warm helpers at the api.main module level, drive a TestClient
through the lifespan, then assert call counts. Auto-migrate is turned off
in setUp so these tests don't reach SQLite.
"""

from __future__ import annotations

import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient


class WarmOnStartupTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_warm = os.environ.get("MGZ_PKMN_WARM_ON_STARTUP")
        self._old_automigrate = os.environ.get("MGZ_PKMN_AUTOMIGRATE")
        # Disable automigrate so the lifespan doesn't try to touch SQLite —
        # we only care about the warm branch here.
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"

    def tearDown(self) -> None:
        if self._old_warm is None:
            os.environ.pop("MGZ_PKMN_WARM_ON_STARTUP", None)
        else:
            os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = self._old_warm
        if self._old_automigrate is None:
            os.environ.pop("MGZ_PKMN_AUTOMIGRATE", None)
        else:
            os.environ["MGZ_PKMN_AUTOMIGRATE"] = self._old_automigrate

    def _reload_main(self):
        """Re-import api.main so the freshly-set env vars are picked up.

        The lifespan reads `MGZ_PKMN_WARM_ON_STARTUP` per startup, so a
        reload isn't strictly required — but importing `app` from a stale
        module risks confusing future tests if api.main starts caching
        config at import time. Cheap to be safe.
        """
        if "api.main" in sys.modules:
            return importlib.reload(sys.modules["api.main"])
        import api.main as main

        return main

    def test_warm_env_set_kicks_off_both_warmers(self) -> None:
        os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = "1"
        main = self._reload_main()
        with (
            patch.object(main, "_warm_concepts_in_background") as mock_concepts,
            patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            mock_concepts.assert_called_once()
            mock_set_cards.assert_called_once()

    def test_warm_env_unset_skips_warmers(self) -> None:
        os.environ.pop("MGZ_PKMN_WARM_ON_STARTUP", None)
        main = self._reload_main()
        with (
            patch.object(main, "_warm_concepts_in_background") as mock_concepts,
            patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            mock_concepts.assert_not_called()
            mock_set_cards.assert_not_called()

    def test_warm_env_truthy_variants_all_fire(self) -> None:
        """Pin the env-var parse rules so future churn doesn't drop a variant."""
        for value in ("1", "true", "True"):
            with self.subTest(value=value):
                os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = value
                main = self._reload_main()
                with (
                    patch.object(main, "_warm_concepts_in_background") as mock_concepts,
                    patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
                ):
                    with TestClient(main.app) as c:
                        self.assertEqual(c.get("/health").status_code, 200)
                    mock_concepts.assert_called_once()
                    mock_set_cards.assert_called_once()

    def test_warm_env_falsy_variants_all_skip(self) -> None:
        """Same as above for the other side — empty / 0 / false do not fire."""
        for value in ("", "0", "false", "False"):
            with self.subTest(value=value):
                os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = value
                main = self._reload_main()
                with (
                    patch.object(main, "_warm_concepts_in_background") as mock_concepts,
                    patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
                ):
                    with TestClient(main.app) as c:
                        self.assertEqual(c.get("/health").status_code, 200)
                    mock_concepts.assert_not_called()
                    mock_set_cards.assert_not_called()


if __name__ == "__main__":
    unittest.main()
