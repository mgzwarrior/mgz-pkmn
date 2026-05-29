"""Engine, session factory, and FastAPI request-scoped dependency.

Module-level `engine` and `SessionLocal` are constructed lazily on first
access so importing `api.db.session` doesn't try to open a SQLite file on
disk (matters for tests that monkeypatch the URL before the engine binds)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from .url import resolve_database_url

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def _connect_args(url: str) -> dict[str, Any]:
    """Per-dialect connect args.

    SQLite needs `check_same_thread=False` because FastAPI may dispatch a
    single request's DB work across thread-pool workers (run_in_threadpool).
    Other dialects don't need this."""
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def get_engine() -> Engine:
    """Lazily build (and cache) the SQLAlchemy engine.

    Tests that swap `MGZ_PKMN_DATABASE_URL` between cases can call
    `reset_engine()` to force a rebuild on next access."""
    global _engine, _session_factory
    if _engine is None:
        url = resolve_database_url()
        _engine = create_engine(url, future=True, connect_args=_connect_args(url))
        _session_factory = sessionmaker(_engine, expire_on_commit=False, future=True)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    """Companion to `get_engine` — returns the bound session factory."""
    if _session_factory is None:
        get_engine()
    assert _session_factory is not None
    return _session_factory


def reset_engine() -> None:
    """Tear down the cached engine + session factory.

    Tests use this after pointing `MGZ_PKMN_DATABASE_URL` at a fresh tmp
    path so the next `get_engine()` call rebinds. Production code never
    calls this."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def get_db() -> Iterator[Session]:
    """FastAPI dependency — yields a session bound to the cached factory.

    The session is committed when the request handler returns normally and
    rolled back if the handler raises. Always closed."""
    session_factory = get_session_factory()
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
