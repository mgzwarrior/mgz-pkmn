"""Pin that api.main configures logging so `_log.info` reaches stderr.

Regression coverage for the warm-bootstrap log invisibility on Render
(#378): without `logging.basicConfig(level=INFO)` plus an explicit
`_log.setLevel(INFO)` at module import, every `_log.info(...)` from
the warm bootstraps is silently dropped — Python's default behavior
only emits WARNING and above through the "last resort" handler, AND a
pre-configured root logger (pytest's capture, custom uvicorn
`--log-config`, etc.) typically has WARNING as its level too.

The tests below explicitly drive both branches of api.main's logging
config — fresh root vs pre-configured root — instead of trusting
whatever state the test runner happens to leave the root logger in.
That's the only way to actually pin the production behavior; an
implicit "pytest configured the root already" precondition would make
this suite a tautology.

Pattern per test:

1. Snapshot the root logger's handlers + level in setUp.
2. Reset it to the state the test cares about (clean or
   pre-configured-with-WARNING) just before reloading api.main.
3. Reload api.main so its module-level config block runs against the
   reset state.
4. Assert against `isEnabledFor(INFO)` — that's the canonical Python
   check ("would my `_log.info(...)` actually emit?"), not a numeric
   comparison against `getEffectiveLevel`.
5. Restore root state in tearDown so other tests aren't perturbed.
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
    """Re-import api.main so its module-level logging config block fires
    again against the current root-logger state."""
    if "api.main" in sys.modules:
        return importlib.reload(sys.modules["api.main"])
    import api.main as main

    return main


class _RootLoggerMixin(unittest.TestCase):
    """Snapshot + restore the root logger's handlers and level so each
    test can deterministically reset root to the precondition it wants
    to assert against — without polluting later tests in the same
    runner."""

    def setUp(self) -> None:
        self._old_automigrate = os.environ.get("MGZ_PKMN_AUTOMIGRATE")
        os.environ["MGZ_PKMN_AUTOMIGRATE"] = "0"
        root = logging.getLogger()
        self._snapshot_handlers = root.handlers[:]
        self._snapshot_level = root.level
        # Also snapshot api.main's level — _log.setLevel(INFO) at module
        # import persists across reloads via the Python logging registry,
        # so without a restore the next test could see the level our
        # reload set.
        self._snapshot_api_main_level = logging.getLogger("api.main").level

    def tearDown(self) -> None:
        root = logging.getLogger()
        root.handlers[:] = self._snapshot_handlers
        root.setLevel(self._snapshot_level)
        logging.getLogger("api.main").setLevel(self._snapshot_api_main_level)
        if self._old_automigrate is None:
            os.environ.pop("MGZ_PKMN_AUTOMIGRATE", None)
        else:
            os.environ["MGZ_PKMN_AUTOMIGRATE"] = self._old_automigrate

    @staticmethod
    def _reset_root_to_fresh() -> None:
        """Mimic a clean uvicorn boot: no handlers on root, default level."""
        root = logging.getLogger()
        root.handlers.clear()
        root.setLevel(logging.WARNING)
        logging.getLogger("api.main").setLevel(logging.NOTSET)

    @staticmethod
    def _reset_root_to_pre_configured() -> None:
        """Mimic pytest log capture / custom uvicorn --log-config: root
        already has a handler, level is WARNING (so naive `basicConfig`
        is a no-op and `_log.info` would drop without our explicit
        `_log.setLevel(INFO)`)."""
        root = logging.getLogger()
        root.handlers.clear()
        root.addHandler(logging.NullHandler())
        root.setLevel(logging.WARNING)
        logging.getLogger("api.main").setLevel(logging.NOTSET)


class LoggingConfigBranchTests(_RootLoggerMixin):
    def test_fresh_root_gets_a_streamhandler_at_info(self) -> None:
        """Branch 1 of the two-case setup: clean root → basicConfig
        adds a handler. After reload, root has a handler and the
        api.main logger emits INFO."""
        self._reset_root_to_fresh()
        _reload_main()

        root = logging.getLogger()
        self.assertGreater(len(root.handlers), 0)
        self.assertTrue(logging.getLogger("api.main").isEnabledFor(logging.INFO))

    def test_preconfigured_root_does_not_get_basicConfig_clobber(self) -> None:
        """Branch 2: root already has handlers + WARNING level. Our
        explicit `_log.setLevel(INFO)` rescues api.main's emission
        without touching root's handler list."""
        self._reset_root_to_pre_configured()
        root = logging.getLogger()
        handlers_before = root.handlers[:]
        level_before = root.level

        _reload_main()

        # We did not add to root's handler list; the caller's setup
        # survives untouched.
        self.assertEqual(root.handlers, handlers_before)
        self.assertEqual(root.level, level_before)
        # …but api.main is now enabled for INFO regardless. This is the
        # load-bearing assertion: if `_log.setLevel(INFO)` ever gets
        # removed, this test fails even though root looks "configured".
        self.assertTrue(logging.getLogger("api.main").isEnabledFor(logging.INFO))


class WarmLogCaptureTests(_RootLoggerMixin):
    """End-to-end: drive the warm bootstraps with a fresh manifest so
    the freshness-gate short-circuit fires the "already fresh" log
    line. This is what an operator on Render would actually see —
    `assertLogs` captures it because our explicit level config makes
    the log call propagate."""

    def setUp(self) -> None:
        super().setUp()
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
        super().tearDown()

    def test_warm_sets_bootstrap_emits_already_fresh_log(self) -> None:
        # Pre-configured-root precondition is the harder of the two
        # cases (basicConfig won't run) — pin behavior there.
        self._reset_root_to_pre_configured()
        disk_cache.write_sets_warm(
            sets_warmed=173, logos_cached=173, symbols_cached=170, failures=0
        )
        main = _reload_main()

        with self.assertLogs("api.main", level="INFO") as cm:
            main._warm_sets_in_background()

        self.assertTrue(
            any("sets cache fresh" in line for line in cm.output),
            f"expected 'sets cache fresh' in logs, got: {cm.output}",
        )

    def test_warm_cards_bootstrap_emits_already_fresh_log(self) -> None:
        self._reset_root_to_pre_configured()
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

    def test_api_main_logger_isenabledfor_info_in_both_root_states(self) -> None:
        """Independent check that doesn't rely on `assertLogs` (which
        installs its own handler and would mask config bugs). Drives
        both root-state branches via subTest so the assertion is the
        same shape in both."""
        for label, reset in (
            ("fresh", self._reset_root_to_fresh),
            ("pre-configured", self._reset_root_to_pre_configured),
        ):
            with self.subTest(root_state=label):
                reset()
                # `sets_warm_is_fresh` patch keeps the bootstrap quiet —
                # we're testing logger state, not warm behavior.
                with patch("mgz_pkmn.cache.sets_warm_is_fresh", return_value=True):
                    main = _reload_main()
                self.assertTrue(
                    main._log.isEnabledFor(logging.INFO),
                    f"api.main logger should emit INFO under root_state={label}",
                )


class AlembicEnvLoggingTests(_RootLoggerMixin):
    """Pin that loading api.migrations.env doesn't disable the
    `api.main` logger via `fileConfig`'s default `disable_existing_loggers=True`.

    Regression coverage for #382: alembic.ini's `[loggers]` section only
    names `root, sqlalchemy, alembic`, so the default fileConfig call
    would flip `.disabled = True` on every other already-instantiated
    logger — including `api.main`. After that, every `_log.info(...)` /
    `_log.warning(...)` from the warm bootstraps is dropped at
    `Logger.handle`, before reaching any handler. The env.py override
    `disable_existing_loggers=False` is what keeps the warm logs alive
    across `automigrate -> command.upgrade -> env.py` on every boot.
    """

    def test_loading_env_does_not_disable_api_main_logger(self) -> None:
        from logging.config import fileConfig

        _reload_main()
        api_main = logging.getLogger("api.main")
        self.assertFalse(api_main.disabled)

        alembic_ini = Path(__file__).resolve().parents[1] / "api" / "alembic.ini"
        fileConfig(str(alembic_ini), disable_existing_loggers=False)

        self.assertFalse(
            api_main.disabled,
            "api.main logger was disabled by fileConfig — env.py must pass "
            "disable_existing_loggers=False so the warm-bootstrap log lines "
            "keep emitting after every automigrate (see #382).",
        )
        self.assertTrue(api_main.isEnabledFor(logging.INFO))


if __name__ == "__main__":
    unittest.main()
