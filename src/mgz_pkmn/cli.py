"""Click CLI entry point."""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
import time
from pathlib import Path

import click
import requests

from . import __version__
from . import cache as disk_cache
from .binder import CONDENSED_LAYOUT, STANDARD_LAYOUT, write_binder_pdf
from .checklist import write_checklist_pdf
from .images import download_image
from .lookup import find_card, find_top_cards
from .parser import CardQuery, read_input
from .pricing import Pricing, extract_pricing
from .report import build_json_report
from .set_cards import fetch_all_sets, write_set_cards_pdf
from .sorting import DEFAULT_SORT, SORT_MODES, sort_rows
from .sources import PriceChartingClient, TCGClient, TCGDexClient
from .sources.base import MatchResult
from .spreadsheet import Row, write_spreadsheet

# ---------------------------------------------------------------------------
# Pretty-print helpers — keep all the colour/styling logic in one place.
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Easter eggs: a small Exeggutor trail. The CLI flag (--exeggutor) and the
# bulk-lookup checkpoint share a banner; each surfaces a unique claim code
# (EGG-PALMS, EGG-ALOLA). The Wall of Eggs lives in the repo — finders find
# it via the closing pointer in each egg.
# ---------------------------------------------------------------------------

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


class FallbackGroup(click.Group):
    """A Click group that forwards unknown subcommands to `lookup`.

    Lets `pkmn cards.txt` keep working alongside `pkmn lookup cards.txt`
    and `pkmn set-cards` — preserves the historical, no-subcommand CLI
    while still surfacing real subcommands in `--help`."""

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


@cli.command(name="lookup", context_settings={"help_option_names": ["-h", "--help"]})
@click.argument(
    "input_paths",
    metavar="INPUTS...",
    type=click.Path(exists=True, dir_okay=True, file_okay=True, readable=True, path_type=Path),
    nargs=-1,
    required=True,
)
@click.option(
    "-o",
    "--output",
    type=click.Path(dir_okay=False, writable=True, path_type=Path),
    default=Path("cards.xlsx"),
    show_default=True,
    help="Output spreadsheet path.",
)
@click.option(
    "--images-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("output/images"),
    show_default=True,
    help="Where to save downloaded card images.",
)
@click.option(
    "--api-key",
    envvar="POKEMONTCG_IO_API_KEY",
    default=None,
    help="pokemontcg.io API key (or set POKEMONTCG_IO_API_KEY).",
)
@click.option(
    "--no-images",
    is_flag=True,
    help="Skip image downloads and embedding (faster, smaller xlsx).",
)
@click.option(
    "--max-price",
    type=click.FloatRange(min=0.0, min_open=True),
    default=None,
    help=(
        "Drop any priced card whose market exceeds this number. Applied to the "
        "raw market figure regardless of currency, so €X is treated like $X — "
        "pass a single-currency input list to keep the cap meaningful. Cards "
        "with no price pass through (you can still triage them by hand)."
    ),
)
@click.option(
    "--dedupe",
    is_flag=True,
    help=(
        "Remove duplicate matched cards across all queries, keeping the first "
        "occurrence by card id."
    ),
)
@click.option(
    "--report-json",
    type=click.Path(dir_okay=False, writable=True, path_type=Path),
    default=None,
    help="Also dump a structured JSON report.",
)
@click.option(
    "--pdf",
    type=click.Path(dir_okay=False, writable=True, path_type=Path),
    default=None,
    help="Also write a 3x3 binder-style PDF for vendor scanning.",
)
@click.option(
    "--condensed-pdf",
    "condensed_pdf_path",
    type=click.Path(dir_okay=False, writable=True, path_type=Path),
    default=None,
    help=(
        "Also write a denser binder PDF (6x4 grid, 24 cards/page) with the "
        "same caption block as --pdf. Lives alongside the standard binder "
        "for visual scanning when you don't need printable placeholder cells."
    ),
)
@click.option(
    "--checklist",
    "checklist_path",
    type=click.Path(dir_okay=False, writable=True, path_type=Path),
    default=None,
    help=(
        "Also write a printable checklist PDF for the front of the binder. "
        "One section per input file (tag), listing every matched card lookup "
        "returned with an empty checkbox to mark off by hand."
    ),
)
@click.option(
    "--no-cache",
    is_flag=True,
    help=(
        "Skip the disk cache (API responses, URL overrides). Forces every "
        "lookup to hit the network — useful when checking for newly added "
        "cards or when a cached entry seems stale."
    ),
)
@click.option(
    "--clear-cache",
    is_flag=True,
    help=(
        "Wipe cached API responses before running, then proceed normally so "
        "fresh data is fetched and re-cached. URL overrides are preserved. "
        "Use after a normalizer schema change (e.g. a new card field) when "
        "stale cached payloads no longer reflect current code."
    ),
)
@click.option(
    "--lang",
    "default_lang",
    type=str,
    default=None,
    help=(
        "Default TCGdex language code applied to lines that don't name one "
        "themselves (e.g. `--lang ja`). Per-line keywords like 'japanese' or "
        "'chinese' still take priority. Useful for input lists that are "
        "predominantly non-English. Common codes: en, ja, fr, de, es, it, "
        "ko, zh-tw, zh-cn, pt, pt-br."
    ),
)
@click.option(
    "--sort",
    "sort_mode",
    type=click.Choice(SORT_MODES, case_sensitive=False),
    default=DEFAULT_SORT,
    show_default=True,
    help=(
        "Row order applied uniformly to xlsx, binder, and checklist outputs. "
        "Tag (input file) is always the outermost group; this option only "
        "changes order WITHIN each tag. Choices: number (group by set, then "
        "card number asc — the default), number-desc, price-asc, price-desc, "
        "release-date (chronological by set release date), alpha (by card name)."
    ),
)
@click.option("-v", "--verbose", is_flag=True, help="Verbose output.")
def lookup(
    input_paths: tuple[Path, ...],
    output: Path,
    images_dir: Path,
    api_key: str | None,
    no_images: bool,
    max_price: float | None,
    dedupe: bool,
    report_json: Path | None,
    pdf: Path | None,
    condensed_pdf_path: Path | None,
    checklist_path: Path | None,
    no_cache: bool,
    clear_cache: bool,
    default_lang: str | None,
    sort_mode: str,
    verbose: bool,
) -> None:
    """Look up Pokemon cards, fetch images and prices, and emit an .xlsx for card-show prep.

    INPUTS are one or more text files (or directories of text files), each
    holding one card per line. Each file's stem is used as a "Source" tag so
    rows / PDF cells stay grouped by their list of origin. Pipe-, dash-, or
    position-delimited line formats are accepted; markdown task-list / bullet
    prefixes are stripped. Append a PriceCharting URL on the line for cards in
    regional sets that the public databases don't index.
    """
    if no_cache:
        # Surfaced as an env var so subprocess-spawned helpers (none today,
        # but the cache module checks it) inherit the setting.
        os.environ["MGZ_PKMN_NO_CACHE"] = "1"
    _print_banner(__version__)
    _warn_if_cache_large()
    disk_cache.reset_api_counters()

    if clear_cache:
        cleared = disk_cache.clear_api_cache()
        click.secho("▸ ", fg="bright_blue", nl=False)
        click.echo(
            click.style(
                f"Cleared {cleared} cached API response{'s' if cleared != 1 else ''}",
                bold=True,
            )
            + click.style("  (URL overrides preserved)", fg="bright_black")
        )

    files = _expand_inputs(input_paths)
    if not files:
        raise click.ClickException("No input files found.")

    # Read each file, tag every CardQuery with that file's stem.
    _print_section(f"Reading inputs ({len(files)} file{'s' if len(files) != 1 else ''})")
    tagged: list[tuple[str, CardQuery]] = []
    for f in files:
        qs = read_input(f)
        if not qs:
            click.secho(f"  ✗ {f}", fg="yellow", nl=False)
            click.echo("  (no card lines, skipped)")
            continue
        tag = f.stem
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(f"{f}  ", nl=False)
        click.echo(
            click.style(f"({len(qs)} line{'s' if len(qs) != 1 else ''})", fg="bright_black") + "  ",
            nl=False,
        )
        click.echo(_styled_tag(tag))
        for q in qs:
            tagged.append((tag, q))

    if not tagged:
        raise click.ClickException("No card lines found in any input.")

    pkmn_client = TCGClient(api_key=api_key, verbose=verbose)
    tcgdex_client = TCGDexClient(verbose=verbose)
    pc_client = PriceChartingClient(verbose=verbose)

    _print_section(
        f"Looking up {len(tagged)} card{'s' if len(tagged) != 1 else ''} "
        "across pokemontcg.io · TCGdex · PriceCharting"
    )

    rows: list[Row] = []
    counters = {"matched": 0, "missed": 0, "bulk": 0}
    overall_start = time.monotonic()

    def _row_for(card: dict, query: CardQuery, tag: str) -> Row:
        """Build a spreadsheet row for a single matched card."""
        pricing = extract_pricing(card, query.variant_hint)
        image_path: Path | None = None
        if not no_images:
            images = card.get("images") or {}
            img_url = images.get("large") or images.get("small")
            if img_url:
                ext = Path(img_url).suffix or ".png"
                safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", f"{card.get('id')}")
                image_path = images_dir / f"{safe}{ext}"
                download_image(img_url, image_path, pkmn_client.session)
        return Row(query=query, card=card, pricing=pricing, image_path=image_path, tag=tag)

    total = len(tagged)
    width = len(str(total))

    for idx, (tag, q) in enumerate(tagged, start=1):
        prefix = click.style(f"[{idx:>{width}}/{total}]", fg="bright_black")
        click.echo(f"{prefix} {_styled_tag(tag)} {q}")

        t0 = time.monotonic()

        # Bulk "top N" path: pull a ranked list and emit one row per card.
        if q.bulk_top or q.bulk_all:
            try:
                effective_limit = None if q.bulk_all else q.bulk_top
                top = find_top_cards(pkmn_client, q, limit=effective_limit, max_price=max_price)
            except requests.RequestException as exc:
                click.secho(f"      ! API error: {exc}", fg="red", err=True)
                top = []
            if not top:
                counters["missed"] += 1
                click.secho(
                    f"      ✗ no priced matches for {q.name!r} "
                    "— try adding a PriceCharting URL or a different name",
                    fg="yellow",
                )
                rows.append(Row(query=q, card=None, pricing=Pricing(), tag=tag))
                continue
            counters["bulk"] += len(top)
            elapsed = time.monotonic() - t0
            # Easter egg: a small banner when someone runs a bulk lookup
            # against Exeggutor. Reveals claim code EGG-NUTS.
            if "exeggutor" in (q.name or "").lower():
                _exeggutor_checkpoint()
            click.echo(
                "      "
                + click.style("→", fg="cyan")
                + click.style(f" top {len(top)} chase cards by market price ", bold=True)
                + click.style(f"({elapsed:.1f}s)", fg="bright_black")
            )
            for card in top:
                pricing = extract_pricing(card, q.variant_hint)
                set_name = (card.get("set") or {}).get("name") or "?"
                rarity = card.get("rarity") or "—"
                price_str = _format_price(pricing.market, pricing.currency)
                line = (
                    f"          {price_str:>22}  "
                    + click.style(card.get("name") or "?", bold=True)
                    + click.style(f"  #{card.get('number')}", fg="bright_black")
                    + f"  {set_name}  "
                    + click.style(rarity, fg="bright_magenta")
                )
                click.echo(line)
                rows.append(_row_for(card, q, tag))
            continue

        # Single-card path.
        try:
            result = find_card(pkmn_client, tcgdex_client, pc_client, q, default_lang=default_lang)
        except requests.RequestException as exc:
            click.secho(f"      ! API error: {exc}", fg="red", err=True)
            result = MatchResult(None, "no_candidates")

        card = result.card
        if card is None:
            counters["missed"] += 1
            if result.reason == "set_mismatch":
                click.secho(
                    f"      ✗ {q.name!r} found, but not in set {q.set_hint!r} "
                    "(try adding a PriceCharting URL on the line)",
                    fg="yellow",
                )
            elif result.reason == "scrape_failed":
                click.secho(
                    f"      ✗ PriceCharting fetch failed for {result.url}",
                    fg="yellow",
                )
            else:
                click.secho(
                    "      ✗ no match in pokemontcg.io or TCGdex",
                    fg="yellow",
                )
            rows.append(Row(query=q, card=None, pricing=Pricing(), tag=tag))
            continue

        counters["matched"] += 1
        pricing = extract_pricing(card, q.variant_hint)
        set_name = (card.get("set") or {}).get("name") or "?"
        db_label = card.get("_database", "?")
        elapsed = time.monotonic() - t0
        price_str = (
            _format_price(pricing.market, pricing.currency)
            + click.style(f" ({pricing.variant or pricing.source})", fg="bright_black")
            if pricing.market is not None
            else click.style("no price", fg="bright_black")
        )
        click.echo(
            "      "
            + click.style("✓", fg="green")
            + " "
            + click.style(card.get("name") or "?", bold=True)
            + f"  #{card.get('number')}  "
            + click.style(set_name, fg="bright_white")
            + f"  {price_str}  "
            + click.style(f"[{db_label}]", fg="bright_black")
            + click.style(f"  ({elapsed:.1f}s)", fg="bright_black")
        )
        rows.append(_row_for(card, q, tag))

    overall_elapsed = time.monotonic() - overall_start
    deduped_rows = 0
    if dedupe:
        rows, deduped_rows = _dedupe_rows(rows)

    # Per-card price cap: enforced only when *fetching* bulk top-N candidates
    # (so an "affordable top 10" still returns 10). Specific single-card
    # lookups from input files always appear in every artifact even when
    # they exceed the cap — over-cap rows get a visual flag so the user can
    # spot them without losing the listing.
    over_cap = sum(
        1
        for r in rows
        if max_price is not None and r.pricing.market is not None and r.pricing.market > max_price
    )

    sort_rows(rows, sort_mode)

    _print_section("Summary")
    matched_total = len([r for r in rows if r.card is not None])
    missed_total = len(rows) - matched_total
    summary_parts = [
        click.style(f"✓ {matched_total} matched", fg="green"),
        (
            click.style(f"✗ {missed_total} missed", fg="yellow")
            if missed_total
            else click.style("✓ 0 missed", fg="bright_black")
        ),
    ]
    if dedupe:
        summary_parts.append(
            click.style(
                f"- {deduped_rows} duplicate{'s' if deduped_rows != 1 else ''} removed",
                fg="cyan" if deduped_rows else "bright_black",
            )
        )
    if max_price is not None:
        summary_parts.append(
            click.style(
                f"! {over_cap} above ${max_price:,.2f}",
                fg="yellow" if over_cap else "bright_black",
            )
        )
    non_en = sum(
        1 for r in rows if r.card is not None and ((r.card or {}).get("language") or "en") != "en"
    )
    if non_en:
        summary_parts.append(click.style(f"⚑ {non_en} non-English", fg="bright_red"))
    cache_hits, cache_fetches = disk_cache.api_counters()
    if cache_hits:
        # Only surface when caching actually helped this run — zero-hit runs
        # (first invocation, --no-cache, or an all-miss TTL refresh) would
        # just clutter the line without adding signal.
        summary_parts.append(
            click.style(f"{cache_hits} cached / {cache_fetches} fetched", fg="cyan")
        )
    summary_parts.append(click.style(f"{overall_elapsed:.1f}s total", fg="bright_black"))
    click.echo("  " + "  ·  ".join(summary_parts))

    _print_section("Writing outputs")
    write_spreadsheet(rows, output, max_price=max_price)
    click.secho("  ✓ ", fg="green", nl=False)
    click.echo(f"{output}  " + click.style(f"({len(rows)} rows)", fg="bright_black"))
    if not no_images:
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(f"images in {images_dir}/")

    if pdf:
        title = ", ".join(sorted({r.tag for r in rows if r.tag})) or pdf.stem
        write_binder_pdf(rows, pdf, title=title, max_price=max_price, layout=STANDARD_LAYOUT)
        sections = len({r.tag for r in rows if r.tag})
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{pdf}  "
            + click.style(
                f"({len(rows)} cards, {sections} section{'s' if sections != 1 else ''})",
                fg="bright_black",
            )
        )

    if condensed_pdf_path:
        title = ", ".join(sorted({r.tag for r in rows if r.tag})) or condensed_pdf_path.stem
        write_binder_pdf(
            rows,
            condensed_pdf_path,
            title=title,
            max_price=max_price,
            layout=CONDENSED_LAYOUT,
        )
        sections = len({r.tag for r in rows if r.tag})
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{condensed_pdf_path}  "
            + click.style(
                f"({len(rows)} cards, {sections} section{'s' if sections != 1 else ''}, condensed)",
                fg="bright_black",
            )
        )

    if checklist_path:
        written = write_checklist_pdf(rows, checklist_path)
        if written:
            click.secho("  ✓ ", fg="green", nl=False)
            click.echo(
                f"{checklist_path}  "
                + click.style(
                    f"({written} checklist section{'s' if written != 1 else ''})",
                    fg="bright_black",
                )
            )
        else:
            click.secho("  · ", fg="bright_black", nl=False)
            click.echo(
                click.style(
                    "checklist skipped — no matched cards to list",
                    fg="bright_black",
                )
            )

    if report_json:
        payload = build_json_report(
            rows=rows,
            counters=counters,
            input_lines=len(tagged),
            elapsed=overall_elapsed,
            max_price=max_price,
            deduped_rows=deduped_rows,
        )
        report_json.parent.mkdir(parents=True, exist_ok=True)
        report_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(f"{report_json}  " + click.style("(JSON report)", fg="bright_black"))

    missing = sum(1 for r in rows if r.card is None)
    click.echo()
    if missing:
        click.secho(f"Done with {missing} unmatched line(s).", fg="yellow")
        sys.exit(1)
    click.secho("Done!", fg="green", bold=True)


TEXT_FILE_SUFFIXES = {".txt", ".md", ".list"}


def _expand_inputs(paths: tuple[Path, ...]) -> list[Path]:
    """Resolve each INPUT to a concrete list of files.

    Plain files pass through unchanged. Directories are scanned (non-recursive)
    for files with text-y extensions, sorted by name so the run order is
    predictable. Hidden files (leading dot) are skipped."""
    out: list[Path] = []
    seen: set[Path] = set()
    for p in paths:
        candidates: list[Path]
        if p.is_dir():
            candidates = sorted(
                child
                for child in p.iterdir()
                if child.is_file()
                and not child.name.startswith(".")
                and child.suffix.lower() in TEXT_FILE_SUFFIXES
            )
        else:
            candidates = [p]
        for c in candidates:
            resolved = c.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            out.append(c)
    return out


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
@click.option("-v", "--verbose", is_flag=True, help="Verbose output.")
def set_cards_command(
    output: Path,
    api_key: str | None,
    logos_dir: Path,
    no_images: bool,
    verbose: bool,
) -> None:
    """Generate printable set ID cards for binder section dividers.

    Fetches every Pokémon TCG set from pokemontcg.io and emits one
    card-sized cutout per set, laid out 3x3 on Letter so a printed page
    drops straight into a 9-pocket binder sheet. Takes no positional
    arguments."""
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


@cli.group(name="cache", context_settings={"help_option_names": ["-h", "--help"]})
def cache_group() -> None:
    """Inspect and manage the on-disk cache."""


def _format_bytes(n: int) -> str:
    """Render a byte count with a human-readable suffix (B/KB/MB/GB).

    Powers-of-1024 to match `du -h`; one decimal once we leave the B range
    so small caches still show "12 B" without a noisy ".0"."""
    units = ("B", "KB", "MB", "GB", "TB")
    size = float(n)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} {units[-1]}"  # unreachable, satisfies type-checkers


def _warn_if_cache_large() -> None:
    """Soft-warn when the on-disk cache exceeds the configured threshold.

    Stat-only check at run start (no payload reads). Threshold defaults to
    50 MB and is overridable via `MGZ_PKMN_CACHE_WARN_BYTES`; a non-positive
    value disables the warning. We surface this on the CLI's stderr so it
    doesn't pollute piped stdout output but is still visible interactively."""
    threshold = disk_cache.cache_warn_threshold()
    if threshold <= 0:
        return
    size = disk_cache.cache_size_bytes()
    if size <= threshold:
        return
    # `size > 0` implies the cache dir exists, so `cache_root()`'s mkdir is
    # a no-op here. Quote the path with shlex so a user can copy-paste the
    # `rm -rf` suggestion verbatim even when XDG_CACHE_HOME has spaces.
    root = str(disk_cache.cache_root())
    click.secho(
        f"⚠ cache directory is {_format_bytes(size)} "
        f"(threshold {_format_bytes(threshold)}). "
        f"Run with --clear-cache or `rm -rf {shlex.quote(root)}` to reclaim space.",
        fg="yellow",
        err=True,
    )


def _format_age(mtime: float | None, *, now: float | None = None) -> str:
    """Render an mtime as a relative age (e.g. '3d ago', '5h ago').

    `now` is injectable so tests can pin the comparison instant — production
    callers leave it at None and get `time.time()`."""
    if mtime is None:
        return "—"
    delta = (now if now is not None else time.time()) - mtime
    if delta < 60:
        return "just now"
    if delta < 3600:
        return f"{int(delta // 60)}m ago"
    if delta < 86400:
        return f"{int(delta // 3600)}h ago"
    return f"{int(delta // 86400)}d ago"


@cache_group.command(name="stats", context_settings={"help_option_names": ["-h", "--help"]})
def cache_stats_command() -> None:
    """Show on-disk cache health: total size, oldest entry, override count.

    Reports stats even when MGZ_PKMN_NO_CACHE is set — the user is asking
    about real on-disk state, not the effective behaviour of the current
    run."""
    s = disk_cache.stats()
    total_bytes = s.api_bytes + s.override_bytes

    _print_section("Cache stats")
    click.echo("  " + click.style("Location:      ", fg="bright_black") + str(s.root))
    click.echo(
        "  "
        + click.style("Total size:    ", fg="bright_black")
        + click.style(_format_bytes(total_bytes), bold=True)
    )
    click.echo(
        "  "
        + click.style("API responses: ", fg="bright_black")
        + f"{s.api_entry_count} entries · {_format_bytes(s.api_bytes)} · "
        + f"oldest {_format_age(s.api_oldest_mtime)}"
    )
    click.echo(
        "  "
        + click.style("URL overrides: ", fg="bright_black")
        + f"{s.override_count} entries · {_format_bytes(s.override_bytes)}"
    )


if __name__ == "__main__":
    cli()
