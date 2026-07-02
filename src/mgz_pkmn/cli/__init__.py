"""Click CLI entry point.

The actual commands live in per-surface submodules (`lookup`, `set_cards`,
`cache`). This module assembles the root group, wires the easter-egg flag in,
and re-exports the helpers that tests still reach into."""

from __future__ import annotations

import click

from .. import __version__
from ._cache_warn import _format_age, _format_bytes, _warn_if_cache_large
from ._styling import _dedupe_rows, _format_price
from .exeggutor import _print_exeggutor_egg


class FallbackGroup(click.Group):
    """A Click group that forwards unknown subcommands to `lookup`.

    Lets `pkmn cards.txt` keep working alongside `pkmn lookup cards.txt`
    and `pkmn set-cards` — preserves the historical, no-subcommand CLI
    while still surfacing real subcommands in `--help`.

    Two parser stages need the fallback. An unknown *first positional*
    (`pkmn cards.txt`) trips `resolve_command`; an unknown *option*
    (`pkmn --no-images cards.txt`) trips `parse_args` on the root group
    before `resolve_command` ever runs, so both are caught."""

    def parse_args(self, ctx: click.Context, args: list[str]) -> list[str]:
        try:
            return super().parse_args(ctx, list(args))
        except click.NoSuchOption:
            if "lookup" not in self.commands:
                raise
            # An option meant for `lookup` hit the root group's parser.
            # Re-parse with an explicit subcommand so the option lands on
            # lookup's parser instead. `list(args)` above keeps the
            # original `args` intact for this retry.
            return super().parse_args(ctx, ["lookup", *args])

    def resolve_command(
        self, ctx: click.Context, args: list[str]
    ) -> tuple[str | None, click.Command | None, list[str]]:
        try:
            return super().resolve_command(ctx, args)
        except click.UsageError:
            lookup_cmd = self.commands.get("lookup")
            if lookup_cmd is None:
                raise
            return "lookup", lookup_cmd, args


@click.group(
    cls=FallbackGroup,
    context_settings={"help_option_names": ["-h", "--help"]},
    invoke_without_command=True,
)
@click.version_option(__version__, "-V", "--version", prog_name="pkmn")
@click.option(
    "--exeggutor",
    is_flag=True,
    hidden=True,
    is_eager=True,
    expose_value=False,
    callback=_print_exeggutor_egg,
)
@click.pass_context
def cli(ctx: click.Context) -> None:
    """Pokémon card lookup, pricing, and binder/PDF output tools.

    Without a subcommand, behaves like `pkmn lookup ...` for backward
    compatibility — pass input files as positional arguments. Use
    `pkmn set-cards` to generate printable set identification cutouts."""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


# Register every command surface onto the root group. Imports are kept here
# (not at module top) so each submodule can import names back from this
# package — e.g. `from .cli import cli` from a test helper — without
# circular-import pain.
from .. import plugins as _plugins  # noqa: E402
from . import cache as _cache_module  # noqa: E402
from . import lookup as _lookup_module  # noqa: E402
from . import set_cards as _set_cards_module  # noqa: E402

_lookup_module.register(cli)
_set_cards_module.register(cli)
_cache_module.register(cli)

# Plugin commands mount last so built-ins win any name collision
# (docs/plugins.md, ADR-0012).
_plugins.register_plugin_commands(cli)


__all__ = [
    "FallbackGroup",
    "_dedupe_rows",
    "_format_age",
    "_format_bytes",
    "_format_price",
    "_warn_if_cache_large",
    "cli",
]


if __name__ == "__main__":
    cli()
