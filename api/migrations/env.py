"""Alembic environment.

Wires the alembic CLI / API auto-migrate path to the SQLAlchemy models
declared in `api.db.models` and resolves the database URL via
`api.db.url.resolve_database_url` so the same env-var precedence applies
whether the migration runs from `make migrate` or the API startup hook.
See ADR-0013.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from api.db.models import Base
from api.db.url import resolve_database_url

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Empty `sqlalchemy.url` in alembic.ini is intentional — the URL is
# resolved at runtime so MGZ_PKMN_DATABASE_URL wins everywhere. Code
# invoking `command.upgrade(...)` programmatically (api.db.migrate) sets
# the option directly, so this only runs for the bare `alembic` CLI.
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", resolve_database_url())

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Render migration SQL to stdout without a DBAPI connection."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live engine.

    `NullPool` is chosen so the migration runner doesn't hold connections
    open — important when running under the SQLite flock or the Postgres
    advisory lock, both of which want the migration session to release
    promptly.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # `render_as_batch=True` makes ALTER TABLE work on SQLite, which
            # otherwise lacks DDL for column changes. Cheap on Postgres too.
            render_as_batch=connection.dialect.name == "sqlite",
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
