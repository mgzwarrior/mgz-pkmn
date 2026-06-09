"""Pretty-print helpers shared across CLI commands."""

from __future__ import annotations

import click

from ..spreadsheet import Row

# Stable colour per tag so a multi-file run is easy to scan visually.
_TAG_COLORS = ("cyan", "magenta", "green", "yellow", "blue", "bright_cyan", "bright_magenta")


def _tag_color(tag: str, _cache: dict[str, str] = {}) -> str:  # noqa: B006
    if tag not in _cache:
        _cache[tag] = _TAG_COLORS[len(_cache) % len(_TAG_COLORS)]
    return _cache[tag]


def _styled_tag(tag: str) -> str:
    return click.style(f"[{tag}]", fg=_tag_color(tag), bold=True)


def _print_banner(version: str) -> None:
    line = f"  mgz-pkmn · {version}  "
    bar = "─" * len(line)
    click.secho(f"\n┌{bar}┐", fg="bright_blue")
    click.echo(
        click.style("│", fg="bright_blue")
        + click.style(line, bold=True)
        + click.style("│", fg="bright_blue")
    )
    click.secho(f"└{bar}┘", fg="bright_blue")


def _print_section(title: str) -> None:
    click.secho(f"\n▸ {title}", fg="bright_blue", bold=True)


def _format_price(amount: float | None, currency: str = "USD") -> str:
    if amount is None:
        return click.style("—", fg="bright_black")
    sym = "€" if currency == "EUR" else "$"
    return click.style(f"{sym}{amount:,.2f}", fg="green", bold=True)


def _dedupe_rows(rows: list[Row]) -> tuple[list[Row], int]:
    """Drop duplicate matched cards by card id, preserving first occurrence."""
    out: list[Row] = []
    seen_ids: set[str] = set()
    removed = 0
    for r in rows:
        cid = (r.card or {}).get("id")
        if cid and cid in seen_ids:
            removed += 1
            continue
        if cid:
            seen_ids.add(cid)
        out.append(r)
    return out, removed
