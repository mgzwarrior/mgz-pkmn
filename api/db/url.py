"""Resolve the SQLAlchemy database URL for the API.

`$MGZ_PKMN_DATABASE_URL` overrides the computed default end-to-end. Otherwise
the URL is built by resolving the cache root through `mgz_pkmn.cache.cache_root`
(the same helper today's disk cache uses) and prepending `sqlite:///` to the
absolute path — so SQLAlchemy never sees an un-expanded `$XDG_CACHE_HOME`.

A bare empty-string override falls back to the default; this matches how the
project handles `MGZ_PKMN_NO_CACHE` etc. and lets `env -u` style cleanups
return to the computed value without breakage."""

from __future__ import annotations

import os
from pathlib import Path

from mgz_pkmn.cache import cache_root

_DATABASE_URL_ENV = "MGZ_PKMN_DATABASE_URL"
_DB_FILENAME = "mgz-pkmn.db"


def default_sqlite_path() -> Path:
    """Compute the on-disk SQLite path (no side effects).

    Lives next to the existing disk cache so `rm -rf ~/.cache/mgz-pkmn`
    nukes both stores together — a single mental model for "wipe my data."
    """
    return cache_root() / _DB_FILENAME


def resolve_database_url() -> str:
    """Return the SQLAlchemy URL the API should bind to.

    Honours `MGZ_PKMN_DATABASE_URL` when set to a non-empty value; otherwise
    constructs a SQLite URL pointing at `<cache_root>/mgz-pkmn.db` as an
    absolute path."""
    override = os.environ.get(_DATABASE_URL_ENV, "").strip()
    if override:
        return override
    return f"sqlite:///{default_sqlite_path().resolve()}"
