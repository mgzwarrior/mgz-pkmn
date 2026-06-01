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
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.lookup import WarmCardsResult
from mgz_pkmn.set_cards import WarmResult


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
            patch.object(main, "_warm_sets_in_background") as mock_sets,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            mock_concepts.assert_called_once()
            mock_set_cards.assert_called_once()
            mock_sets.assert_called_once()

    def test_warm_env_unset_skips_warmers(self) -> None:
        os.environ.pop("MGZ_PKMN_WARM_ON_STARTUP", None)
        main = self._reload_main()
        with (
            patch.object(main, "_warm_concepts_in_background") as mock_concepts,
            patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
            patch.object(main, "_warm_sets_in_background") as mock_sets,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            mock_concepts.assert_not_called()
            mock_set_cards.assert_not_called()
            mock_sets.assert_not_called()

    def test_warm_env_truthy_variants_all_fire(self) -> None:
        """Pin the env-var parse rules so future churn doesn't drop a variant."""
        for value in ("1", "true", "True"):
            with self.subTest(value=value):
                os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = value
                main = self._reload_main()
                with (
                    patch.object(main, "_warm_concepts_in_background") as mock_concepts,
                    patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
                    patch.object(main, "_warm_sets_in_background") as mock_sets,
                ):
                    with TestClient(main.app) as c:
                        self.assertEqual(c.get("/health").status_code, 200)
                    mock_concepts.assert_called_once()
                    mock_set_cards.assert_called_once()
                    mock_sets.assert_called_once()

    def test_warm_env_falsy_variants_all_skip(self) -> None:
        """Same as above for the other side — empty / 0 / false do not fire."""
        for value in ("", "0", "false", "False"):
            with self.subTest(value=value):
                os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = value
                main = self._reload_main()
                with (
                    patch.object(main, "_warm_concepts_in_background") as mock_concepts,
                    patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
                    patch.object(main, "_warm_sets_in_background") as mock_sets,
                ):
                    with TestClient(main.app) as c:
                        self.assertEqual(c.get("/health").status_code, 200)
                    mock_concepts.assert_not_called()
                    mock_set_cards.assert_not_called()
                    mock_sets.assert_not_called()


class WarmCardsLifespanTests(unittest.TestCase):
    """Pin that `MGZ_PKMN_WARM_CARDS_ON_STARTUP` is wired through the
    lifespan and that it's *independent* of the standard
    `MGZ_PKMN_WARM_ON_STARTUP` flag — Phase 1 #370 wants a separate
    opt-in because the per-card pass is heavyweight."""

    def setUp(self) -> None:
        self._old_warm = os.environ.get("MGZ_PKMN_WARM_ON_STARTUP")
        self._old_warm_cards = os.environ.get("MGZ_PKMN_WARM_CARDS_ON_STARTUP")
        self._old_automigrate = os.environ.get("MGZ_PKMN_AUTOMIGRATE")
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"

    def tearDown(self) -> None:
        for key, prev in (
            ("MGZ_PKMN_WARM_ON_STARTUP", self._old_warm),
            ("MGZ_PKMN_WARM_CARDS_ON_STARTUP", self._old_warm_cards),
            ("MGZ_PKMN_AUTOMIGRATE", self._old_automigrate),
        ):
            if prev is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = prev

    def _reload_main(self):
        if "api.main" in sys.modules:
            return importlib.reload(sys.modules["api.main"])
        import api.main as main

        return main

    def test_warm_cards_env_set_kicks_off_card_warmer(self) -> None:
        os.environ["MGZ_PKMN_WARM_CARDS_ON_STARTUP"] = "1"
        os.environ.pop("MGZ_PKMN_WARM_ON_STARTUP", None)
        main = self._reload_main()
        with (
            patch.object(main, "_warm_concepts_in_background") as mock_concepts,
            patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
            patch.object(main, "_warm_sets_in_background") as mock_sets,
            patch.object(main, "_warm_cards_in_background") as mock_cards,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            # The cards warmer fired even though the standard flag is off.
            mock_cards.assert_called_once()
            # The standard three did NOT fire — the env vars are independent.
            mock_concepts.assert_not_called()
            mock_set_cards.assert_not_called()
            mock_sets.assert_not_called()

    def test_standard_warm_env_does_not_fire_card_warmer(self) -> None:
        # MGZ_PKMN_WARM_ON_STARTUP=1 alone must NOT trigger the per-card
        # warm — that's the whole point of the separate env var.
        os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = "1"
        os.environ.pop("MGZ_PKMN_WARM_CARDS_ON_STARTUP", None)
        main = self._reload_main()
        with (
            patch.object(main, "_warm_concepts_in_background"),
            patch.object(main, "_warm_set_cards_in_background"),
            patch.object(main, "_warm_sets_in_background"),
            patch.object(main, "_warm_cards_in_background") as mock_cards,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            mock_cards.assert_not_called()

    def test_both_envs_set_fire_all_four_warmers(self) -> None:
        os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = "1"
        os.environ["MGZ_PKMN_WARM_CARDS_ON_STARTUP"] = "1"
        main = self._reload_main()
        with (
            patch.object(main, "_warm_concepts_in_background") as mock_concepts,
            patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
            patch.object(main, "_warm_sets_in_background") as mock_sets,
            patch.object(main, "_warm_cards_in_background") as mock_cards,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            mock_concepts.assert_called_once()
            mock_set_cards.assert_called_once()
            mock_sets.assert_called_once()
            mock_cards.assert_called_once()


class WarmCardImagesLifespanTests(unittest.TestCase):
    """Pin that `MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP` is wired through
    the lifespan and that it stays independent of the other flags —
    Phase 2 (#371) makes this the heaviest opt-in (~3-5 GB on disk)."""

    def setUp(self) -> None:
        self._old_warm = os.environ.get("MGZ_PKMN_WARM_ON_STARTUP")
        self._old_warm_cards = os.environ.get("MGZ_PKMN_WARM_CARDS_ON_STARTUP")
        self._old_warm_images = os.environ.get("MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP")
        self._old_automigrate = os.environ.get("MGZ_PKMN_AUTOMIGRATE")
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"

    def tearDown(self) -> None:
        for key, prev in (
            ("MGZ_PKMN_WARM_ON_STARTUP", self._old_warm),
            ("MGZ_PKMN_WARM_CARDS_ON_STARTUP", self._old_warm_cards),
            ("MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP", self._old_warm_images),
            ("MGZ_PKMN_AUTOMIGRATE", self._old_automigrate),
        ):
            if prev is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = prev

    def _reload_main(self):
        if "api.main" in sys.modules:
            return importlib.reload(sys.modules["api.main"])
        import api.main as main

        return main

    def test_card_images_env_set_kicks_off_image_warmer(self) -> None:
        os.environ["MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP"] = "1"
        os.environ.pop("MGZ_PKMN_WARM_ON_STARTUP", None)
        os.environ.pop("MGZ_PKMN_WARM_CARDS_ON_STARTUP", None)
        main = self._reload_main()
        with (
            patch.object(main, "_warm_concepts_in_background") as mock_concepts,
            patch.object(main, "_warm_set_cards_in_background") as mock_set_cards,
            patch.object(main, "_warm_sets_in_background") as mock_sets,
            patch.object(main, "_warm_cards_in_background") as mock_cards,
            patch.object(main, "_warm_card_images_in_background") as mock_images,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            mock_images.assert_called_once()
            mock_concepts.assert_not_called()
            mock_set_cards.assert_not_called()
            mock_sets.assert_not_called()
            mock_cards.assert_not_called()

    def test_other_warm_envs_alone_do_not_fire_image_warmer(self) -> None:
        os.environ["MGZ_PKMN_WARM_ON_STARTUP"] = "1"
        os.environ["MGZ_PKMN_WARM_CARDS_ON_STARTUP"] = "1"
        os.environ.pop("MGZ_PKMN_WARM_CARD_IMAGES_ON_STARTUP", None)
        main = self._reload_main()
        with (
            patch.object(main, "_warm_concepts_in_background"),
            patch.object(main, "_warm_set_cards_in_background"),
            patch.object(main, "_warm_sets_in_background"),
            patch.object(main, "_warm_cards_in_background"),
            patch.object(main, "_warm_card_images_in_background") as mock_images,
        ):
            with TestClient(main.app) as c:
                self.assertEqual(c.get("/health").status_code, 200)
            mock_images.assert_not_called()


class WarmSetsBackgroundBodyTests(unittest.TestCase):
    """Drive the body of `_warm_sets_in_background` synchronously so the
    inner `_run` (TCGClient → warm_set_images → write_sets_warm + log)
    actually executes. The lifespan-level tests above mock the function
    out at the boundary, so they don't reach this code path — without
    these tests the entire warm body shows as uncovered on Codecov.

    Pattern: patch `threading.Thread` so `.start()` invokes the target
    inline, then patch `TCGClient` and `warm_set_images` so no network
    happens. Cache root is redirected at a tempdir so the manifest write
    doesn't touch the user's real cache.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(disk_cache._NO_CACHE_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(disk_cache._NO_CACHE_ENV, None)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(disk_cache._NO_CACHE_ENV, None)
        else:
            os.environ[disk_cache._NO_CACHE_ENV] = self._old_no_cache
        self._tmp.cleanup()

    def _make_sync_thread(self):
        """Return a Thread-shaped MagicMock whose `.start()` calls target() inline."""

        def _thread_factory(*, target=None, name=None, daemon=None, **_kwargs):
            instance = MagicMock()
            instance.start.side_effect = lambda: target() if target else None
            return instance

        return _thread_factory

    def test_sets_warm_body_writes_manifest_and_logs(self) -> None:
        """When the freshness gate misses, the body fetches via TCGClient,
        calls warm_set_images, writes the manifest, and logs success."""
        from api import main

        fake_result = WarmResult(sets=173, logos_cached=173, symbols_cached=170, failures=3)
        with (
            patch.object(main, "threading") as mock_threading,
            patch.object(main, "TCGClient") as mock_client_cls,
            patch.object(main, "warm_set_images", return_value=fake_result) as mock_warm,
            patch.object(main._log, "info") as mock_log,
        ):
            mock_threading.Thread.side_effect = self._make_sync_thread()
            main._warm_sets_in_background()

        # TCGClient constructed once; warm_set_images called with its instance.
        mock_client_cls.assert_called_once()
        mock_warm.assert_called_once_with(mock_client_cls.return_value)

        # Manifest landed on disk with the fake counts.
        manifest = disk_cache.read_sets_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None  # narrow for type checkers
        self.assertEqual(manifest["sets_warmed"], 173)
        self.assertEqual(manifest["logos_cached"], 173)
        self.assertEqual(manifest["symbols_cached"], 170)
        self.assertEqual(manifest["failures"], 3)

        # Success path logs the "complete" line.
        complete_logs = [call for call in mock_log.call_args_list if "complete" in str(call)]
        self.assertEqual(len(complete_logs), 1)

    def test_sets_warm_body_swallows_upstream_exception(self) -> None:
        """A TCGClient/warm_set_images failure must be logged and swallowed,
        not raised — the warm pass is best-effort and shouldn't crash the
        service. Manifest stays absent so the next startup retries."""
        from api import main

        with (
            patch.object(main, "threading") as mock_threading,
            patch.object(main, "TCGClient"),
            patch.object(main, "warm_set_images", side_effect=RuntimeError("upstream down")),
            patch.object(main._log, "exception") as mock_log_exception,
        ):
            mock_threading.Thread.side_effect = self._make_sync_thread()
            # Should not raise.
            main._warm_sets_in_background()

        self.assertIsNone(disk_cache.read_sets_warm())
        mock_log_exception.assert_called_once()

    def test_sets_warm_skipped_when_manifest_is_fresh(self) -> None:
        """When the freshness gate hits, the body short-circuits without
        constructing a TCGClient or starting a thread."""
        from api import main

        disk_cache.write_sets_warm(
            sets_warmed=173, logos_cached=173, symbols_cached=170, failures=0
        )

        with (
            patch.object(main, "threading") as mock_threading,
            patch.object(main, "TCGClient") as mock_client_cls,
            patch.object(main, "warm_set_images") as mock_warm,
            patch.object(main._log, "info") as mock_log_info,
        ):
            main._warm_sets_in_background()

        mock_client_cls.assert_not_called()
        mock_warm.assert_not_called()
        mock_threading.Thread.assert_not_called()
        # Logged the "already fresh" reason so an operator can tell why a
        # restart didn't trigger another walk.
        fresh_logs = [call for call in mock_log_info.call_args_list if "fresh" in str(call)]
        self.assertEqual(len(fresh_logs), 1)


class WarmCardsBackgroundBodyTests(unittest.TestCase):
    """Same pattern as WarmSetsBackgroundBodyTests — drive the body of
    `_warm_cards_in_background` synchronously by patching `threading.Thread`
    so `.start()` invokes the target inline. Covers the inner _run
    (TCGClient → warm_cards → write_card_warm + log) that the
    lifespan-level tests mock at the boundary."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(disk_cache._NO_CACHE_ENV)
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(disk_cache._NO_CACHE_ENV, None)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(disk_cache._NO_CACHE_ENV, None)
        else:
            os.environ[disk_cache._NO_CACHE_ENV] = self._old_no_cache
        self._tmp.cleanup()

    def _make_sync_thread(self):
        def _thread_factory(*, target=None, name=None, daemon=None, **_kwargs):
            instance = MagicMock()
            instance.start.side_effect = lambda: target() if target else None
            return instance

        return _thread_factory

    def test_card_warm_body_passes_throttle_and_writes_manifest(self) -> None:
        """The body fetches via TCGClient, calls warm_cards WITH a non-zero
        throttle (so a no-API-key deploy doesn't burst through the rate
        limit), writes the manifest, and logs success."""
        from api import main

        fake_result = WarmCardsResult(
            sets_attempted=173, cards_warmed=18_500, cards_failed=12, sets_failed=["ghost"]
        )
        with (
            patch.object(main, "threading") as mock_threading,
            patch.object(main, "TCGClient") as mock_client_cls,
            patch.object(main, "warm_cards", return_value=fake_result) as mock_warm,
            patch.object(main._log, "info") as mock_log,
        ):
            mock_threading.Thread.side_effect = self._make_sync_thread()
            main._warm_cards_in_background()

        mock_client_cls.assert_called_once()
        # Critically: throttle_ms is passed and non-zero. Without this the
        # startup warm would burst through pokemontcg.io's 30-rpm free-tier
        # ceiling on a no-API-key deploy and poison the manifest.
        mock_warm.assert_called_once()
        _, kwargs = mock_warm.call_args
        self.assertGreater(kwargs.get("throttle_ms", 0), 0)

        # Manifest landed on disk with the fake counts.
        manifest = disk_cache.read_card_warm()
        self.assertIsNotNone(manifest)
        assert manifest is not None
        self.assertEqual(manifest["cards_warmed"], 18_500)
        self.assertEqual(manifest["cards_failed"], 12)
        self.assertEqual(manifest["sets_attempted"], 173)
        self.assertEqual(manifest["sets_failed"], ["ghost"])

        # Success path logs the "complete" line.
        complete_logs = [call for call in mock_log.call_args_list if "complete" in str(call)]
        self.assertEqual(len(complete_logs), 1)

    def test_card_warm_body_swallows_upstream_exception(self) -> None:
        """A TCGClient/warm_cards failure is logged and swallowed — the warm
        is best-effort and must not crash the service. Manifest stays absent
        so the next startup retries."""
        from api import main

        with (
            patch.object(main, "threading") as mock_threading,
            patch.object(main, "TCGClient"),
            patch.object(main, "warm_cards", side_effect=RuntimeError("upstream down")),
            patch.object(main._log, "exception") as mock_log_exception,
        ):
            mock_threading.Thread.side_effect = self._make_sync_thread()
            main._warm_cards_in_background()

        self.assertIsNone(disk_cache.read_card_warm())
        mock_log_exception.assert_called_once()

    def test_card_warm_skipped_when_manifest_is_fresh(self) -> None:
        """When the freshness gate hits, the body short-circuits without
        constructing a TCGClient or spawning a thread."""
        from api import main

        disk_cache.write_card_warm(
            cards_warmed=18_500, cards_failed=0, sets_attempted=173, sets_failed=[]
        )

        with (
            patch.object(main, "threading") as mock_threading,
            patch.object(main, "TCGClient") as mock_client_cls,
            patch.object(main, "warm_cards") as mock_warm,
            patch.object(main._log, "info") as mock_log_info,
        ):
            main._warm_cards_in_background()

        mock_client_cls.assert_not_called()
        mock_warm.assert_not_called()
        mock_threading.Thread.assert_not_called()
        fresh_logs = [call for call in mock_log_info.call_args_list if "fresh" in str(call)]
        self.assertEqual(len(fresh_logs), 1)


if __name__ == "__main__":
    unittest.main()
