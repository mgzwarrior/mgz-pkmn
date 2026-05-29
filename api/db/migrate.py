"""Run Alembic migrations on API startup, gated by a cross-worker lock.

See ADR-0013 for the rationale. The lock matters because production deploys
typically run multiple workers (`uvicorn --workers N`, Gunicorn, etc.) and
without a gate they'd race the `alembic upgrade head` call on startup.

Lock strategy (dialect-aware):

- **SQLite**: `fcntl.flock` on a sibling `<db>.migrate.lock` file.
  Held only for the duration of `alembic upgrade head`, which is a no-op on
  an already-current schema — so the overhead is one stat + one
  `alembic_version` read per worker boot.
- **Postgres**: `pg_advisory_lock(<fixed bigint>)` inside the upgrade
  connection — a *blocking* acquire, so a worker that loses the race waits
  for the migrating worker rather than skipping the upgrade. Released
  explicitly (and again when the connection closes).
- **Other / in-memory SQLite / fcntl-less platforms**: best effort — Alembic's
  own version_num check serialises concurrent attempts to the same head, so
  the worst case is wasted work on losers, not corruption.

`MGZ_PKMN_AUTOMIGRATE=0` (or `false`, `False`) disables the auto-upgrade
entirely so operators who'd rather run `make migrate` as a prestart step
(init container, Render pre-deploy, etc.) can do that and let the API boot
without touching DDL."""

from __future__ import annotations

import contextlib
import logging
import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, text

logger = logging.getLogger(__name__)

_AUTOMIGRATE_ENV = "MGZ_PKMN_AUTOMIGRATE"
# Fixed identifier for the Postgres advisory lock — derived from the ASCII
# bytes of "mgz-pkmn" so collisions with other apps sharing a database are
# astronomically unlikely.
_PG_ADVISORY_LOCK_ID = 0x6D677A2D706B6D6E

# The config lives at `api/alembic.ini`, alongside the migrations dir, so the
# same value works for `make migrate` and for the API runtime.
# `Path(__file__).resolve().parents[1]` resolves to the `api/` dir
# (api/db/migrate.py → api/).
_ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def automigrate_enabled() -> bool:
    """Honour `MGZ_PKMN_AUTOMIGRATE` — default on; explicit `0`/`false` opts out."""
    raw = os.environ.get(_AUTOMIGRATE_ENV, "").strip()
    return raw not in ("0", "false", "False")


def _sqlite_db_path(url: str) -> Path | None:
    """Extract the on-disk path from a `sqlite:///…` URL.

    Returns None for in-memory SQLite (`sqlite://` / `sqlite:///:memory:`)
    where there's nothing to flock against — concurrent workers in that
    case are a test concern only, and tests use a single process anyway.

    Delegates to SQLAlchemy's URL parser for the database component so
    relative URLs (`sqlite:///rel.db` → `rel.db`) and absolute ones
    (`sqlite:////abs.db` → `/abs.db`) resolve correctly instead of being
    mangled by naive prefix-stripping.
    """
    from sqlalchemy.engine import make_url

    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite":
        return None
    database = parsed.database
    if not database or database == ":memory:":
        return None
    return Path(database)


@contextlib.contextmanager
def _sqlite_flock(db_path: Path) -> Iterator[None]:
    """fcntl-based exclusive flock on `<db>.migrate.lock`.

    On platforms without fcntl (Windows), falls through with a warning —
    callers rely on Alembic's version_num check + SQLite's BEGIN IMMEDIATE
    to keep concurrent attempts safe."""
    try:
        import fcntl
    except ImportError:
        logger.warning("fcntl unavailable on this platform — running migrations without flock")
        yield
        return

    lockfile = db_path.parent / f"{db_path.name}.migrate.lock"
    lockfile.parent.mkdir(parents=True, exist_ok=True)
    # Open in append mode so the file is created without truncating any
    # ambient content; the file's contents don't matter, only the inode.
    with open(lockfile, "a") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextlib.contextmanager
def _postgres_advisory_lock(engine: Engine) -> Iterator[None]:
    """`pg_advisory_lock` for the duration of the upgrade.

    Blocks until the lock is acquired (which is fine — upgrades are
    bounded, and the worker can't serve traffic until startup completes
    anyway). The lock is released when the connection closes via `with`."""
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:lock_id)"), {"lock_id": _PG_ADVISORY_LOCK_ID})
        try:
            yield
        finally:
            conn.execute(
                text("SELECT pg_advisory_unlock(:lock_id)"),
                {"lock_id": _PG_ADVISORY_LOCK_ID},
            )


def _alembic_config():
    """Lazy import + construct an Alembic Config bound to api/alembic.ini.

    Alembic is an api-extras dep; importing at module load would tie the
    persistence layer to it even for unit tests that don't migrate."""
    from alembic.config import Config

    cfg = Config(str(_ALEMBIC_INI))
    return cfg


def upgrade_head(engine: Engine) -> None:
    """Run `alembic upgrade head` against `engine`.

    Caller is responsible for the cross-worker lock; this function only
    invokes Alembic."""
    from alembic import command

    cfg = _alembic_config()
    # Override sqlalchemy.url so a hosted instance's MGZ_PKMN_DATABASE_URL
    # wins over whatever's in alembic.ini.
    cfg.set_main_option("sqlalchemy.url", str(engine.url))
    command.upgrade(cfg, "head")


def run_migrations_with_lock(engine: Engine) -> None:
    """Take the appropriate cross-worker lock, then run migrations.

    Called from the FastAPI lifespan hook on startup. Dialect detection
    drives the lock choice; unknown dialects fall through unlocked with a
    warning."""
    url = str(engine.url)
    dialect = engine.url.get_dialect().name

    if dialect == "sqlite":
        db_path = _sqlite_db_path(url)
        if db_path is None:
            # In-memory or unparseable — skip the file lock, rely on Alembic.
            upgrade_head(engine)
            return
        with _sqlite_flock(db_path):
            upgrade_head(engine)
        return

    if dialect in ("postgresql", "postgres"):
        with _postgres_advisory_lock(engine):
            upgrade_head(engine)
        return

    logger.warning("no cross-worker lock implemented for dialect %r — running unguarded", dialect)
    upgrade_head(engine)
