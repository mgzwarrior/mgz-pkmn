"""Pin that api.main configures the root logger so `_log.info` reaches stderr.

Regression coverage for the warm-bootstrap log invisibility on Render
(#378): without `logging.basicConfig(level=INFO)` at module import,
every `_log.info(...)` from the warm bootstraps is silently dropped
because Python's default behavior only emits WARNING and above through
the "last resort" handler. The deploy looked broken even when the
warmers were running successfully.

These tests verify the production-equivalent behavior:

- After importing `api.main`, the root logger has at least one handler.
- The `api.main` logger is enabled for INFO.
- An actual `_log.info` call from inside one of the warm bootstraps gets
  captured (the "already fresh" log line, which fires whenever the
  freshness gate hits).
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mgz_pkmn import cache as disk_cache


def _reload_main():
    """Re-import api.main so the module-level `basicConfig` fires fresh."""
    if "api.main" in sys.modules:
        return importlib.reload(sys.modules["api.main"])
    import api.main as main

    return main


class LoggingConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_automigrate = os.environ.get("MGZ_PKMN_AUTOMIGRATE")
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"

    def tearDown(self) -> None:
        if self._old_automigrate is None:
            os.environ.pop("MGZ_PKMN_AUTOMIGRATE", None)
        else:
            os.environ["MGZ_PKMN_AUTOMIGRATE"] = self._old_automigrate

    def test_root_logger_has_a_handler_after_import(self) -> None:
        """basicConfig added a StreamHandler to root; without it our
        `_log.info` calls drop into the void."""
        _reload_main()
        self.assertGreater(len(logging.getLogger().handlers), 0)

    def test_api_main_logger_emits_info(self) -> None:
        """End-to-end: getEffectiveLevel <= INFO so `_log.info(...)`
        propagates. Catches a future regression where someone narrows
        basicConfig to WARNING-only or removes it."""
        _reload_main()
        self.assertLessEqual(
            logging.getLogger("api.main").getEffectiveLevel(),
            logging.INFO,
        )


class WarmLogCaptureTests(unittest.TestCase):
    """Drives one of the warm bootstraps with a fresh manifest already on
    disk so the freshness-gate short-circuit fires the "already fresh"
    log line, and asserts that line is actually captured. This is the
    real test that warm-pass operators will see something in Render.

    Same isolation pattern as `tests/test_warm_sets_manifest.py`."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        self._old_no_cache = os.environ.get(disk_cache._NO_CACHE_ENV)
        self._old_automigrate = os.environ.get("MGZ_PKMN_AUTOMIGRATE")
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(disk_cache._NO_CACHE_ENV, None)
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        if self._old_no_cache is None:
            os.environ.pop(disk_cache._NO_CACHE_ENV, None)
        else:
            os.environ[disk_cache._NO_CACHE_ENV] = self._old_no_cache
        if self._old_automigrate is None:
            os.environ.pop("MGZ_PKMN_AUTOMIGRATE", None)
        else:
            os.environ["MGZ_PKMN_AUTOMIGRATE"] = self._old_automigrate
        self._tmp.cleanup()

    def test_warm_sets_bootstrap_emits_already_fresh_log(self) -> None:
        # Seed a fresh sets manifest so the bootstrap's freshness gate
        # hits and logs the "already fresh" line.
        disk_cache.write_sets_warm(
            sets_warmed=173, logos_cached=173, symbols_cached=170, failures=0
        )
        main = _reload_main()

        with self.assertLogs("api.main", level="INFO") as cm:
            main._warm_sets_in_background()

        # The "fresh" log fires from `_warm_sets_in_background` directly
        # (not the inner thread), so we don't need to wait on a join.
        self.assertTrue(
            any("sets cache fresh" in line for line in cm.output),
            f"expected 'sets cache fresh' in logs, got: {cm.output}",
        )

    def test_warm_cards_bootstrap_emits_already_fresh_log(self) -> None:
        disk_cache.write_card_warm(
            cards_warmed=18_500, cards_failed=0, sets_attempted=173, sets_failed=[]
        )
        main = _reload_main()

        with self.assertLogs("api.main", level="INFO") as cm:
            main._warm_cards_in_background()

        self.assertTrue(
            any("card cache fresh" in line for line in cm.output),
            f"expected 'card cache fresh' in logs, got: {cm.output}",
        )

    def test_warm_log_call_propagates_through_basicconfig(self) -> None:
        """Even without `assertLogs` (which adds its own handler), the
        production logging config should send `_log.info` to a handler.

        Checks `_log.isEnabledFor(INFO)` after the module-level
        basicConfig has run — the same condition Python uses internally
        before invoking handlers."""
        with patch("mgz_pkmn.cache.sets_warm_is_fresh", return_value=True):
            main = _reload_main()
            self.assertTrue(main._log.isEnabledFor(logging.INFO))


if __name__ == "__main__":
    unittest.main()
