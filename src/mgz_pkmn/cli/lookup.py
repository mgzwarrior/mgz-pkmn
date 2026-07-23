"""The `pkmn lookup` command: the spreadsheet/PDF/JSON build for card-show prep."""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import click
import requests

from .. import __version__, palette, plugins
from .. import cache as disk_cache
from ..binder import CONDENSED_LAYOUT, STANDARD_LAYOUT, write_binder_pdf
from ..checklist import write_checklist_pdf
from ..images import download_image
from ..lookup import find_card, find_top_cards
from ..parser import CardQuery, read_input
from ..pricing import Pricing, extract_pricing
from ..report import build_json_report
from ..sorting import DEFAULT_SORT, SORT_MODES, sort_rows
from ..sources import EbayClient, PriceChartingClient, TCGClient, TCGDexClient
from ..sources.base import MatchResult
from ..spreadsheet import Row, write_spreadsheet
from ._cache_warn import _warn_if_cache_large
from ._inputs import _expand_inputs
from ._styling import _dedupe_rows, _format_price, _print_banner, _print_section, _styled_tag
from .exeggutor import _exeggutor_checkpoint


def _read_tagged_inputs(input_paths: tuple[Path, ...]) -> list[tuple[str, CardQuery]]:
    """Resolve INPUTS to a list of (tag, query) tuples, logging each file."""
    files = _expand_inputs(input_paths)
    if not files:
        raise click.ClickException("No input files found.")

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
    return tagged


def _build_row(
    card: dict,
    query: CardQuery,
    tag: str,
    *,
    pkmn_client: TCGClient,
    images_dir: Path,
    no_images: bool,
    ebay: EbayClient | None = None,
    candidates: list[dict] | None = None,
) -> Row:
    """Build a spreadsheet row for a single matched card, optionally
    downloading its image into `images_dir`."""
    pricing = extract_pricing(card, query.variant_hint)
    if ebay is not None:
        pricing.ebay_sold_median, pricing.ebay_active_floor = ebay.comps_for_card(card)
    image_path: Path | None = None
    if not no_images:
        images = card.get("images") or {}
        img_url = images.get("large") or images.get("small")
        if img_url:
            ext = Path(img_url).suffix or ".png"
            safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", f"{card.get('id')}")
            image_path = images_dir / f"{safe}{ext}"
            download_image(img_url, image_path, pkmn_client.session)
    return Row(
        query=query,
        card=card,
        pricing=pricing,
        image_path=image_path,
        tag=tag,
        candidates=candidates,
    )


def _print_missed_reason(q: CardQuery, result: MatchResult) -> None:
    """Render the appropriate yellow ✗ line for an unmatched single-card result."""
    if result.reason == "set_mismatch":
        click.secho(
            f"      ✗ {q.name!r} found, but not in set {q.set_hint!r} "
            "(try adding a PriceCharting URL on the line)",
            fg="yellow",
        )
    elif result.reason == "scrape_failed":
        click.secho(f"      ✗ PriceCharting fetch failed for {result.url}", fg="yellow")
    elif result.reason == "price_mismatch":
        click.secho(
            f"      ✗ {q.name!r} found but price is outside the requested bound",
            fg="yellow",
        )
    else:
        click.secho("      ✗ no match in pokemontcg.io or TCGdex", fg="yellow")


def _print_matched_line(card: dict, pricing: Pricing, elapsed: float) -> None:
    set_name = (card.get("set") or {}).get("name") or "?"
    db_label = card.get("_database", "?")
    if pricing.market is not None:
        price_str = _format_price(pricing.market, pricing.currency) + click.style(
            f" ({pricing.variant or pricing.source})", fg="bright_black"
        )
    else:
        price_str = click.style("no price", fg="bright_black")
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


def _lookup_one_bulk(
    q: CardQuery,
    tag: str,
    *,
    pkmn_client: TCGClient,
    max_price: float | None,
    images_dir: Path,
    no_images: bool,
    counters: dict[str, int],
    t0: float,
    ebay: EbayClient | None = None,
) -> list[Row]:
    """Handle a bulk top-N / all-set query. Returns the rows it produced."""
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
        return [Row(query=q, card=None, pricing=Pricing(), tag=tag)]
    counters["bulk"] += len(top)
    elapsed = time.monotonic() - t0
    if "exeggutor" in (q.name or "").lower():
        _exeggutor_checkpoint()
    click.echo(
        "      "
        + click.style("→", fg="cyan")
        + click.style(f" top {len(top)} chase cards by market price ", bold=True)
        + click.style(f"({elapsed:.1f}s)", fg="bright_black")
    )
    rows: list[Row] = []
    for card in top:
        pricing = extract_pricing(card, q.variant_hint)
        set_name = (card.get("set") or {}).get("name") or "?"
        rarity = card.get("rarity") or "—"
        price_str = _format_price(pricing.market, pricing.currency)
        click.echo(
            f"          {price_str:>22}  "
            + click.style(card.get("name") or "?", bold=True)
            + click.style(f"  #{card.get('number')}", fg="bright_black")
            + f"  {set_name}  "
            + click.style(rarity, fg="bright_magenta")
        )
        rows.append(
            _build_row(
                card,
                q,
                tag,
                pkmn_client=pkmn_client,
                images_dir=images_dir,
                no_images=no_images,
                ebay=ebay,
            )
        )
    return rows


def _lookup_one_single(
    q: CardQuery,
    tag: str,
    *,
    pkmn_client: TCGClient,
    tcgdex_client: TCGDexClient,
    pc_client: PriceChartingClient,
    default_lang: str | None,
    images_dir: Path,
    no_images: bool,
    counters: dict[str, int],
    t0: float,
    ebay: EbayClient | None = None,
) -> Row:
    """Handle a single-card query. Returns the single row produced."""
    try:
        result = find_card(pkmn_client, tcgdex_client, pc_client, q, default_lang=default_lang)
    except requests.RequestException as exc:
        click.secho(f"      ! API error: {exc}", fg="red", err=True)
        result = MatchResult(None, "no_candidates")

    card = result.card
    if card is None:
        counters["missed"] += 1
        _print_missed_reason(q, result)
        return Row(query=q, card=None, pricing=Pricing(), tag=tag)

    counters["matched"] += 1
    pricing = extract_pricing(card, q.variant_hint)
    _print_matched_line(card, pricing, time.monotonic() - t0)
    if result.candidates:
        click.secho(
            f"      ⚑ {len(result.candidates)} cards matched {q.name!r}; picked the "
            "highest-scoring printing — add a set/number to `input.txt` to pin a different one",
            fg="yellow",
        )
    return _build_row(
        card,
        q,
        tag,
        pkmn_client=pkmn_client,
        images_dir=images_dir,
        no_images=no_images,
        ebay=ebay,
        candidates=result.candidates,
    )


def _build_summary_parts(
    rows: list[Row],
    *,
    dedupe: bool,
    deduped_rows: int,
    max_price: float | None,
    over_cap: int,
    overall_elapsed: float,
) -> list[str]:
    """Assemble the styled chips printed on the Summary line."""
    matched_total = len([r for r in rows if r.card is not None])
    missed_total = len(rows) - matched_total
    parts = [
        click.style(f"✓ {matched_total} matched", fg="green"),
        (
            click.style(f"✗ {missed_total} missed", fg="yellow")
            if missed_total
            else click.style("✓ 0 missed", fg="bright_black")
        ),
    ]
    if dedupe:
        parts.append(
            click.style(
                f"- {deduped_rows} duplicate{'s' if deduped_rows != 1 else ''} removed",
                fg="cyan" if deduped_rows else "bright_black",
            )
        )
    if max_price is not None:
        parts.append(
            click.style(
                f"! {over_cap} above ${max_price:,.2f}",
                fg="yellow" if over_cap else "bright_black",
            )
        )
    non_en = sum(
        1 for r in rows if r.card is not None and ((r.card or {}).get("language") or "en") != "en"
    )
    if non_en:
        parts.append(click.style(f"⚑ {non_en} non-English", fg="bright_red"))
    cache_hits, cache_fetches = disk_cache.api_counters()
    if cache_hits:
        parts.append(click.style(f"{cache_hits} cached / {cache_fetches} fetched", fg="cyan"))
    parts.append(click.style(f"{overall_elapsed:.1f}s total", fg="bright_black"))
    return parts


def _warn_currency_blind_cap(rows: list[Row], max_price: float) -> None:
    """Warn when --max-price was applied to a multi-currency priced pool."""
    priced_rows = [r for r in rows if r.pricing.market is not None]
    pool_currencies = {r.pricing.currency for r in priced_rows}
    if len(pool_currencies) <= 1:
        return
    foreign_priced = [r for r in priced_rows if r.pricing.currency != "USD"]
    currencies = "/".join(sorted({r.pricing.currency for r in foreign_priced}))
    click.secho(
        f"  ⚠  --max-price is currency-blind: {len(foreign_priced)} card(s) priced in"
        f" {currencies} are compared against ${max_price:,.2f} as if USD."
        " Pass a single-currency input list or the cap may not mean what you expect.",
        fg="yellow",
    )


def _print_lookup_summary(
    rows: list[Row],
    *,
    dedupe: bool,
    deduped_rows: int,
    max_price: float | None,
    over_cap: int,
    overall_elapsed: float,
) -> None:
    _print_section("Summary")
    parts = _build_summary_parts(
        rows,
        dedupe=dedupe,
        deduped_rows=deduped_rows,
        max_price=max_price,
        over_cap=over_cap,
        overall_elapsed=overall_elapsed,
    )
    click.echo("  " + "  ·  ".join(parts))
    if max_price is not None:
        _warn_currency_blind_cap(rows, max_price)


def _write_lookup_artifacts(
    rows: list[Row],
    *,
    output: Path,
    images_dir: Path,
    no_images: bool,
    pdf: Path | None,
    condensed_pdf_path: Path | None,
    checklist_path: Path | None,
    report_json: Path | None,
    max_price: float | None,
    counters: dict[str, int],
    tagged_count: int,
    overall_elapsed: float,
    deduped_rows: int,
    sort_mode: str,
    plugin_writers: list[tuple[str, plugins.Writer, Path]],
) -> None:
    _print_section("Writing outputs")
    write_spreadsheet(rows, output, max_price=max_price)
    click.secho("  ✓ ", fg="green", nl=False)
    click.echo(f"{output}  " + click.style(f"({len(rows)} rows)", fg="bright_black"))
    if not no_images:
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(f"images in {images_dir}/")

    if pdf:
        _write_binder(rows, pdf, max_price=max_price, layout=STANDARD_LAYOUT)
    if condensed_pdf_path:
        _write_binder(
            rows, condensed_pdf_path, max_price=max_price, layout=CONDENSED_LAYOUT, condensed=True
        )
    if checklist_path:
        _write_checklist(rows, checklist_path)
    if report_json:
        _write_json_report(
            rows,
            report_json,
            counters=counters,
            tagged_count=tagged_count,
            overall_elapsed=overall_elapsed,
            max_price=max_price,
            deduped_rows=deduped_rows,
            sort_mode=sort_mode,
        )
    for name, write, writer_path in plugin_writers:
        _run_plugin_writer(name, write, rows, writer_path)


def _run_plugin_writer(name: str, write: plugins.Writer, rows: list[Row], path: Path) -> None:
    try:
        write(rows, path)
    except Exception as exc:
        # Unlike a plugin that fails to *load* (warn and skip), a writer the
        # user named on the command line failing to produce its artifact is a
        # hard error.
        detail = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        raise click.ClickException(f"writer {name!r} failed: {detail}") from exc
    click.secho("  ✓ ", fg="green", nl=False)
    click.echo(f"{path}  " + click.style(f"({name} writer)", fg="bright_black"))


def _write_binder(
    rows: list[Row], path: Path, *, max_price: float | None, layout, condensed: bool = False
) -> None:
    title = ", ".join(sorted({r.tag for r in rows if r.tag})) or path.stem
    write_binder_pdf(rows, path, title=title, max_price=max_price, layout=layout)
    sections = len({r.tag for r in rows if r.tag})
    click.secho("  ✓ ", fg="green", nl=False)
    suffix = f"({len(rows)} cards, {sections} section{'s' if sections != 1 else ''}"
    if condensed:
        suffix += ", condensed"
    suffix += ")"
    click.echo(f"{path}  " + click.style(suffix, fg="bright_black"))


def _write_checklist(rows: list[Row], path: Path) -> None:
    written = write_checklist_pdf(rows, path)
    if written:
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{path}  "
            + click.style(
                f"({written} checklist section{'s' if written != 1 else ''})",
                fg="bright_black",
            )
        )
    else:
        click.secho("  · ", fg="bright_black", nl=False)
        click.echo(click.style("checklist skipped — no matched cards to list", fg="bright_black"))


def _write_json_report(
    rows: list[Row],
    path: Path,
    *,
    counters: dict[str, int],
    tagged_count: int,
    overall_elapsed: float,
    max_price: float | None,
    deduped_rows: int,
    sort_mode: str,
) -> None:
    payload = build_json_report(
        rows=rows,
        counters=counters,
        input_lines=tagged_count,
        elapsed=overall_elapsed,
        max_price=max_price,
        deduped_rows=deduped_rows,
        sort_mode=sort_mode,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    click.secho("  ✓ ", fg="green", nl=False)
    click.echo(f"{path}  " + click.style("(JSON report)", fg="bright_black"))


def register(cli: click.Group) -> None:
    """Attach the `pkmn lookup` command to the root cli group."""

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
        "--writer",
        "writer_specs",
        multiple=True,
        metavar="NAME=PATH",
        help=(
            "Also send the resolved rows to an installed writer plugin, e.g. "
            "--writer csv=cards.csv. Repeatable. Writers come from packages "
            "registering a `mgz_pkmn.writers` entry point; see docs/plugins.md."
        ),
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
    @click.option(
        "--theme",
        type=click.Choice(palette.THEMES, case_sensitive=False),
        default="light",
        show_default=True,
        help=(
            "Color theme for the written artifacts (xlsx + PDFs). Light stays "
            "the default — the PDFs are print artifacts; dark matches the web "
            "app's dark mode for on-screen review."
        ),
    )
    @click.option(
        "--print-summary-only",
        is_flag=True,
        help=(
            "Print the run summary but write no artifacts — no xlsx, PDFs, "
            "checklist, JSON report, or images. Useful when iterating on input "
            "formatting without regenerating outputs on every run."
        ),
    )
    @click.option(
        "--ebay/--no-ebay",
        "ebay_opt",
        default=None,
        help=(
            "Fetch eBay sold/active listing comps for each matched card. "
            "Defaults to on when eBay credentials (MGZ_PKMN_EBAY_TOKEN, or the "
            "MGZ_PKMN_EBAY_CLIENT_ID / MGZ_PKMN_EBAY_CLIENT_SECRET pair) are "
            "configured, off otherwise."
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
        writer_specs: tuple[str, ...],
        condensed_pdf_path: Path | None,
        checklist_path: Path | None,
        no_cache: bool,
        clear_cache: bool,
        default_lang: str | None,
        sort_mode: str,
        theme: str,
        print_summary_only: bool,
        ebay_opt: bool | None,
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
            os.environ["MGZ_PKMN_NO_CACHE"] = "1"
        # Resolve writer plugins before any lookups run so a typo'd
        # --writer fails fast instead of after a long network run.
        plugin_writers = plugins.resolve_writer_specs(writer_specs)
        _print_banner(__version__)
        _warn_if_cache_large()
        disk_cache.reset_api_counters()

        if print_summary_only:
            # Suppress every output-artifact write, including image downloads.
            no_images = True

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

        tagged = _read_tagged_inputs(input_paths)

        pkmn_client = TCGClient(api_key=api_key, verbose=verbose)
        tcgdex_client = TCGDexClient(verbose=verbose)
        pc_client = PriceChartingClient(verbose=verbose)

        # eBay comps default to on when credentials are configured; --ebay /
        # --no-ebay forces it either way. Unconfigured + auto stays a no-op:
        # we pass no client, so a row's eBay fields stay blank and no warning
        # fires for the common case of a CLI user without eBay keys.
        ebay_client = EbayClient(verbose=verbose)
        use_ebay = ebay_client.auth.configured if ebay_opt is None else ebay_opt
        ebay = ebay_client if use_ebay else None

        sources_line = "pokemontcg.io · TCGdex · PriceCharting"
        if use_ebay:
            sources_line += " · eBay comps"
        _print_section(
            f"Looking up {len(tagged)} card{'s' if len(tagged) != 1 else ''} across {sources_line}"
        )

        rows: list[Row] = []
        counters = {"matched": 0, "missed": 0, "bulk": 0}
        overall_start = time.monotonic()

        total = len(tagged)
        width = len(str(total))
        for idx, (tag, q) in enumerate(tagged, start=1):
            prefix = click.style(f"[{idx:>{width}}/{total}]", fg="bright_black")
            click.echo(f"{prefix} {_styled_tag(tag)} {q}")
            t0 = time.monotonic()
            if q.bulk_top or q.bulk_all:
                rows.extend(
                    _lookup_one_bulk(
                        q,
                        tag,
                        pkmn_client=pkmn_client,
                        max_price=max_price,
                        images_dir=images_dir,
                        no_images=no_images,
                        counters=counters,
                        t0=t0,
                        ebay=ebay,
                    )
                )
            else:
                rows.append(
                    _lookup_one_single(
                        q,
                        tag,
                        pkmn_client=pkmn_client,
                        tcgdex_client=tcgdex_client,
                        pc_client=pc_client,
                        default_lang=default_lang,
                        images_dir=images_dir,
                        no_images=no_images,
                        counters=counters,
                        t0=t0,
                        ebay=ebay,
                    )
                )

        overall_elapsed = time.monotonic() - overall_start
        deduped_rows = 0
        if dedupe:
            rows, deduped_rows = _dedupe_rows(rows)

        over_cap = sum(
            1
            for r in rows
            if max_price is not None
            and r.pricing.market is not None
            and r.pricing.market > max_price
        )

        sort_rows(rows, sort_mode)

        _print_lookup_summary(
            rows,
            dedupe=dedupe,
            deduped_rows=deduped_rows,
            max_price=max_price,
            over_cap=over_cap,
            overall_elapsed=overall_elapsed,
        )

        if print_summary_only:
            click.echo()
            click.secho("  · outputs skipped (--print-summary-only)", fg="bright_black")
        else:
            with palette.use_theme(theme.lower()):
                _write_lookup_artifacts(
                    rows,
                    output=output,
                    images_dir=images_dir,
                    no_images=no_images,
                    pdf=pdf,
                    condensed_pdf_path=condensed_pdf_path,
                    checklist_path=checklist_path,
                    report_json=report_json,
                    max_price=max_price,
                    counters=counters,
                    tagged_count=len(tagged),
                    overall_elapsed=overall_elapsed,
                    deduped_rows=deduped_rows,
                    sort_mode=sort_mode,
                    plugin_writers=plugin_writers,
                )

        missing = sum(1 for r in rows if r.card is None)
        click.echo()
        if missing:
            click.secho(f"Done with {missing} unmatched line(s).", fg="yellow")
            raise SystemExit(1)
        click.secho("Done!", fg="green", bold=True)

    return lookup  # so callers can introspect the registered command
