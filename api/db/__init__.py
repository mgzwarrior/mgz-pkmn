"""Persistence layer for the mgz-pkmn API.

API-only — the CLI never touches this. See ADR-0013 for the design.

Shape:

- `url.resolve_database_url()` produces the SQLAlchemy URL the rest of the
  package binds to (default: `sqlite:///<absolute-path>/mgz-pkmn.db` under
  the existing cache root; overridable via `MGZ_PKMN_DATABASE_URL`).
- `session.get_engine()` / `session.get_session_factory()` lazily build and
  cache the long-lived engine and session factory; `session.get_db` is the
  FastAPI request-scoped dep.
- `models` defines `User`, `Run`, and `RunRow` with SQLAlchemy 2 typing.
- `migrate.run_migrations_with_lock(engine)` performs `alembic upgrade head`
  under a cross-worker lock (flock for SQLite, advisory for Postgres).
- `serialize.row_to_run_row()` / `run_row_to_row()` / `build_run_summary()`
  convert in-memory `Row`s to the persisted form (promoted columns + opaque
  JSON sub-payloads) and back.
"""

from __future__ import annotations
