"""Entry-point plugin surface for third-party extensions.

[ADR-0012](../docs/adr/0012-open-core-architecture.md) commits the OSS CLI
to a deliberate plugin surface so separately installed packages — the
private ``mgz-pkmn-vendor`` or any community plugin — can extend ``pkmn``
without coordination. Three ``importlib.metadata`` entry-point groups make
up the surface (see ``docs/plugins.md`` for the contributor guide):

- ``mgz_pkmn.commands`` — loads to a ``click.Command`` (or ``click.Group``)
  mounted onto the root ``pkmn`` group under the entry point's name.
- ``mgz_pkmn.writers`` — loads to a callable ``write(rows, path)`` that
  receives the resolved lookup rows (``list[mgz_pkmn.spreadsheet.Row]``)
  and a destination ``Path``. Invoked via ``pkmn lookup --writer NAME=PATH``.
- ``mgz_pkmn.sources`` — reserved for lookup-source adapters. Discovery
  works (``load_sources``), but the lookup pipeline doesn't consume plugin
  sources yet.

A broken plugin must never take the core CLI down: load failures warn on
stderr and the plugin is skipped. Invoking a discovered writer is different
— the user asked for that artifact by name, so a write failure is a hard
error.
"""

from __future__ import annotations

from collections.abc import Callable
from importlib.metadata import EntryPoint, entry_points
from pathlib import Path
from typing import Any

import click

COMMANDS_GROUP = "mgz_pkmn.commands"
WRITERS_GROUP = "mgz_pkmn.writers"
SOURCES_GROUP = "mgz_pkmn.sources"

# A writer receives the resolved rows and a destination path.
Writer = Callable[[list, Path], Any]


def _iter_entry_points(group: str) -> list[EntryPoint]:
    return list(entry_points(group=group))


def _warn(message: str) -> None:
    click.secho(f"warning: {message}", fg="yellow", err=True)


def _load(ep: EntryPoint) -> Any | None:
    try:
        return ep.load()
    except Exception as exc:
        _warn(f"plugin entry point {ep.name!r} ({ep.value}) failed to load: {exc}")
        return None


def register_plugin_commands(cli: click.Group) -> None:
    """Mount every ``mgz_pkmn.commands`` entry point onto the root group.

    Built-in commands always win a name collision; the plugin is skipped
    with a warning rather than shadowing core behavior.
    """
    for ep in _iter_entry_points(COMMANDS_GROUP):
        loaded = _load(ep)
        if loaded is None:
            continue
        if not isinstance(loaded, click.Command):
            _warn(f"plugin command {ep.name!r} ({ep.value}) is not a click.Command; skipped")
            continue
        if ep.name in cli.commands:
            _warn(f"plugin command {ep.name!r} collides with an existing command; skipped")
            continue
        cli.add_command(loaded, name=ep.name)


def load_writers() -> dict[str, Writer]:
    """Discover ``mgz_pkmn.writers`` entry points as a name → callable map."""
    writers: dict[str, Writer] = {}
    for ep in _iter_entry_points(WRITERS_GROUP):
        loaded = _load(ep)
        if loaded is None:
            continue
        if not callable(loaded):
            _warn(f"plugin writer {ep.name!r} ({ep.value}) is not callable; skipped")
            continue
        writers[ep.name] = loaded
    return writers


def load_sources() -> dict[str, Any]:
    """Discover ``mgz_pkmn.sources`` entry points (reserved; not consumed yet)."""
    sources: dict[str, Any] = {}
    for ep in _iter_entry_points(SOURCES_GROUP):
        loaded = _load(ep)
        if loaded is not None:
            sources[ep.name] = loaded
    return sources


def resolve_writer_specs(specs: tuple[str, ...]) -> list[tuple[str, Writer, Path]]:
    """Parse repeated ``--writer NAME=PATH`` values against discovered writers.

    Resolving up front (before any lookups run) means a typo fails fast
    instead of after a long network run.
    """
    if not specs:
        return []
    writers = load_writers()
    resolved: list[tuple[str, Writer, Path]] = []
    for spec in specs:
        name, sep, raw_path = spec.partition("=")
        if not sep or not name or not raw_path:
            raise click.BadParameter(f"expected NAME=PATH, got {spec!r}", param_hint="'--writer'")
        if name not in writers:
            available = ", ".join(sorted(writers)) or "none installed"
            raise click.BadParameter(
                f"unknown writer {name!r} (available: {available})", param_hint="'--writer'"
            )
        resolved.append((name, writers[name], Path(raw_path)))
    return resolved
