"""The `pkmn set-cards` command: printable per-set ID cards for binder dividers."""

from __future__ import annotations

from pathlib import Path

import click
import requests

from .. import __version__
from ..set_cards import fetch_all_sets, filter_sets_by_ids, write_set_cards_pdf
from ..sources import TCGClient
from ._styling import _print_banner, _print_section


def register(cli: click.Group) -> None:
    @cli.command(name="set-cards", context_settings={"help_option_names": ["-h", "--help"]})
    @click.option(
        "-o",
        "--output",
        type=click.Path(dir_okay=False, writable=True, path_type=Path),
        default=Path("set-cards.pdf"),
        show_default=True,
        help="Where to write the PDF.",
    )
    @click.option(
        "--api-key",
        envvar="POKEMONTCG_IO_API_KEY",
        default=None,
        help="pokemontcg.io API key (or set POKEMONTCG_IO_API_KEY).",
    )
    @click.option(
        "--logos-dir",
        type=click.Path(file_okay=False, path_type=Path),
        default=Path("output/images/set-logos"),
        show_default=True,
        help="Where to cache downloaded set logos.",
    )
    @click.option(
        "--no-images",
        is_flag=True,
        help="Skip logo downloads and render text-only cutouts.",
    )
    @click.option(
        "-s",
        "--set",
        "set_ids",
        multiple=True,
        metavar="SET_ID",
        help=(
            "Restrict output to one or more set ids (repeatable; e.g. "
            "`-s sv8 -s sv7`). Omit to render every set."
        ),
    )
    @click.option("-v", "--verbose", is_flag=True, help="Verbose output.")
    def set_cards_command(
        output: Path,
        api_key: str | None,
        logos_dir: Path,
        no_images: bool,
        set_ids: tuple[str, ...],
        verbose: bool,
    ) -> None:
        """Generate printable set ID cards for binder section dividers.

        Fetches every Pokémon TCG set from pokemontcg.io and emits one
        card-sized cutout per set, laid out 3x3 on Letter so a printed page
        drops straight into a 9-pocket binder sheet. Takes no positional
        arguments.

        Pass `--set <id>` (repeatable) to restrict the output to specific
        sets — the SPA's set picker modal uses the same filter under the
        hood, so anything you can pick there is reachable from the CLI."""
        _print_banner(__version__)

        _print_section("Fetching set catalog from pokemontcg.io")
        client = TCGClient(api_key=api_key, verbose=verbose)
        try:
            sets = fetch_all_sets(client)
        except requests.RequestException as exc:
            raise click.ClickException(f"set fetch failed: {exc}") from exc
        if not sets:
            raise click.ClickException("pokemontcg.io returned no sets")
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(f"{len(sets)} set{'s' if len(sets) != 1 else ''}")

        if set_ids:
            sets = filter_sets_by_ids(sets, set_ids)
            if not sets:
                raise click.ClickException(
                    f"no sets matched the requested ids: {', '.join(set_ids)}"
                )
            click.secho("  ✓ ", fg="green", nl=False)
            click.echo(
                f"filtered to {len(sets)} set{'s' if len(sets) != 1 else ''} "
                + click.style(f"({', '.join(set_ids)})", fg="bright_black")
            )

        _print_section("Writing outputs")
        logos = None if no_images else logos_dir
        session = None if no_images else client.session
        written = write_set_cards_pdf(sets, output, logos_dir=logos, session=session)
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{output}  "
            + click.style(
                f"({written} cutout{'s' if written != 1 else ''})",
                fg="bright_black",
            )
        )
        if not no_images:
            click.secho("  ✓ ", fg="green", nl=False)
            click.echo(f"logos cached in {logos_dir}/")

        click.echo()
        click.secho("Done!", fg="green", bold=True)
