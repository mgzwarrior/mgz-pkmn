"""Exeggutor easter-egg surface — the CLI flag, the bulk-lookup checkpoint, and
the shared banner + repo pointer rendered by both."""

from __future__ import annotations

import click

_REPO_URL = "https://github.com/mgzwarrior/mgz-pkmn"


def _print_exeggutor_banner() -> None:
    """The shared framed wordmark used by every CLI-side egg."""
    click.echo()
    click.secho(
        "       ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        fg="green",
    )
    click.secho(
        "             🌴   E X E G G U T O R   🌴",
        fg="bright_green",
        bold=True,
    )
    click.secho(
        "       ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        fg="green",
    )
    click.echo()


def _print_wall_pointer() -> None:
    """The closing line surfaced by every egg, pointing at the wall + repo."""
    click.secho(
        "       The Wall of Eggs is somewhere in the repo —",
        fg="bright_black",
    )
    click.secho(
        "       find it to claim what you've collected.",
        fg="bright_black",
    )
    click.secho(f"       {_REPO_URL}", fg="bright_blue")
    click.echo()


def _print_exeggutor_egg(ctx: click.Context, param: click.Parameter, value: bool) -> None:
    """Print the hidden Exeggutor easter egg and exit cleanly.

    Uses Click's eager-callback pattern (same as ``--version``) so the flag
    fires before required-argument validation — running ``pkmn --exeggutor``
    works without an INPUTS path."""
    if not value or ctx.resilient_parsing:
        return
    _print_exeggutor_banner()
    click.secho(
        "       You found Exeggutor — the project's mascot, hidden on",
        fg="bright_green",
    )
    click.secho(
        "       purpose since v0.1. The maintainer's all-time favorite.",
        fg="bright_green",
    )
    click.echo()
    click.secho("       ✨ Claim code: ", nl=False, fg="white")
    click.secho("EGG-PALMS", fg="yellow", bold=True)
    click.echo()
    click.secho(
        "       There are two more eggs hidden in this project. Try a real",
        fg="bright_black",
    )
    click.secho(
        "       lookup, then poke around the web UI.",
        fg="bright_black",
    )
    _print_wall_pointer()
    ctx.exit()


def _exeggutor_checkpoint() -> None:
    """Print a 'checkpoint' screen and pause until the user presses any
    key. Fires when an Exeggutor bulk lookup is detected mid-run.

    On non-interactive runs (no TTY — CI, piped output, etc.) the pause
    is skipped automatically by ``click.pause``."""
    _print_exeggutor_banner()
    click.secho(
        "       Whoa, an Exeggutor! ナッシー waves from Alola.",
        fg="bright_green",
    )
    click.secho(
        "       Did you know Alolan Exeggutor is the only",
        fg="bright_black",
    )
    click.secho(
        "       Grass/Dragon-type in the franchise? You've",
        fg="bright_black",
    )
    click.secho(
        "       found a hidden checkpoint in the project.",
        fg="bright_black",
    )
    click.echo()
    click.secho("       ✨ Claim code: ", nl=False, fg="white")
    click.secho("EGG-ALOLA", fg="yellow", bold=True)
    click.echo()
    _print_wall_pointer()
    click.pause("       (Press Enter to continue your lookup…)")
    click.echo()
