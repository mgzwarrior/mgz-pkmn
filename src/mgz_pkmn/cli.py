"""Click CLI entry point."""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from statistics import median

import click
import requests

from . import __version__
from . import cache as disk_cache
from .binder import write_binder_pdf
from .images import download_image
from .lookup import find_card, find_top_cards
from .parser import CardQuery, read_input
from .pricing import COMP_PERCENTS, Pricing, extract_pricing
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


# ---------------------------------------------------------------------------
# JSON report builder.
# ---------------------------------------------------------------------------


def _card_summary(r: Row) -> dict:
    """Compact card identity used in highlights / per-tag winners."""
    card = r.card or {}
    return {
        "tag": r.tag,
        "name": card.get("name"),
        "set": (card.get("set") or {}).get("name"),
        "number": card.get("number"),
        "rarity": card.get("rarity"),
        "market": r.pricing.market,
        "currency": r.pricing.currency,
        "variant": r.pricing.variant,
        "url": r.pricing.url,
    }


def _totals_by_currency(rs: list[Row]) -> dict:
    """Sum market + comps per currency. Mixed-currency runs stay separable."""
    out: dict[str, dict] = {}
    for r in rs:
        if r.pricing.market is None:
            continue
        bucket = out.setdefault(
            r.pricing.currency,
            {"row_count": 0, "market": 0.0, **{f"{p}%": 0.0 for p in COMP_PERCENTS}},
        )
        bucket["row_count"] += 1
        bucket["market"] += r.pricing.market
        for p in COMP_PERCENTS:
            bucket[f"{p}%"] += r.pricing.market * p / 100
    for bucket in out.values():
        for k in ("market", *(f"{p}%" for p in COMP_PERCENTS)):
            bucket[k] = round(bucket[k], 2)
    return out


def _stats_by_currency(rs: list[Row]) -> dict:
    """Avg / median / min / max market price per currency."""
    prices: dict[str, list[float]] = {}
    for r in rs:
        if r.pricing.market is None:
            continue
        prices.setdefault(r.pricing.currency, []).append(r.pricing.market)
    return {
        cur: {
            "average": round(sum(vs) / len(vs), 2),
            "median": round(median(vs), 2),
            "min": round(min(vs), 2),
            "max": round(max(vs), 2),
        }
        for cur, vs in prices.items()
    }


def _highest_value(rs: list[Row]) -> dict | None:
    """Highest market within a row group. Caveat: mixes currencies arithmetically;
    intended as a quick "what's the headline card here?" hint, not a comparator."""
    priced = [r for r in rs if r.pricing.market is not None]
    if not priced:
        return None
    return _card_summary(max(priced, key=lambda r: r.pricing.market or 0.0))


def _count_by(rs: list[Row], key_fn) -> dict[str, int]:
    """Frequency table sorted high-to-low. Skips None keys."""
    out: dict[str, int] = {}
    for r in rs:
        k = key_fn(r)
        if k is None:
            continue
        out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _comps(market: float | None) -> dict[str, float] | None:
    if market is None:
        return None
    return {f"{p}%": round(market * p / 100, 2) for p in COMP_PERCENTS}


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


def _build_json_report(
    rows: list[Row],
    counters: dict[str, int],
    input_lines: int,
    elapsed: float,
    max_price: float | None = None,
    deduped_rows: int = 0,
) -> dict:
    matched_rows = [r for r in rows if r.card is not None]
    priced_rows = [r for r in matched_rows if r.pricing.market is not None]

    # Per-tag aggregates, preserving first-appearance order.
    tag_order: list[str] = []
    tag_buckets: dict[str, list[Row]] = {}
    for r in rows:
        if r.tag not in tag_buckets:
            tag_order.append(r.tag)
            tag_buckets[r.tag] = []
        tag_buckets[r.tag].append(r)

    tags_payload = []
    for tag in tag_order:
        bucket = tag_buckets[tag]
        bucket_matched = [r for r in bucket if r.card is not None]
        bucket_priced = [r for r in bucket_matched if r.pricing.market is not None]
        tags_payload.append(
            {
                "tag": tag,
                "rows": len(bucket),
                "matched": len(bucket_matched),
                "missed": len(bucket) - len(bucket_matched),
                "priced": len(bucket_priced),
                "totals_by_currency": _totals_by_currency(bucket),
                "stats_by_currency": _stats_by_currency(bucket),
                "highest_value_card": _highest_value(bucket),
            }
        )

    summary = {
        "input_lines": input_lines,
        "rows_total": len(rows),
        "rows_deduped": deduped_rows,
        "rows_matched": len(matched_rows),
        "rows_missed": len(rows) - len(matched_rows),
        "rows_bulk_expanded": counters.get("bulk", 0),
        "rows_priced": len(priced_rows),
        "rows_unpriced_matched": len(matched_rows) - len(priced_rows),
        "totals_by_currency": _totals_by_currency(rows),
        "stats_by_currency": _stats_by_currency(rows),
        "by_database": _count_by(matched_rows, lambda r: (r.card or {}).get("_database")),
        "by_price_source": _count_by(matched_rows, lambda r: r.pricing.source),
        "by_rarity": _count_by(matched_rows, lambda r: (r.card or {}).get("rarity")),
        "by_language": _count_by(matched_rows, lambda r: (r.card or {}).get("language")),
    }

    def _over_cap(r: Row) -> bool:
        return (
            max_price is not None and r.pricing.market is not None and r.pricing.market > max_price
        )

    top5 = sorted(priced_rows, key=lambda r: r.pricing.market or 0.0, reverse=True)[:5]
    missing = [{"tag": r.tag, "input": r.query.raw} for r in rows if r.card is None]
    above_cap = [
        {
            "tag": r.tag,
            "input": r.query.raw,
            "name": (r.card or {}).get("name"),
            "market": r.pricing.market,
            "currency": r.pricing.currency,
        }
        for r in rows
        if _over_cap(r)
    ]

    rows_payload = [
        {
            "tag": r.tag,
            "input": r.query.raw,
            "matched": bool(r.card),
            "name": (r.card or {}).get("name"),
            "set": ((r.card or {}).get("set") or {}).get("name"),
            "number": (r.card or {}).get("number"),
            "rarity": (r.card or {}).get("rarity"),
            "language": (r.card or {}).get("language"),
            "database": (r.card or {}).get("_database"),
            "image_path": str(r.image_path) if r.image_path else None,
            "market": r.pricing.market,
            "currency": r.pricing.currency,
            "variant": r.pricing.variant,
            "source": r.pricing.source,
            "url": r.pricing.url,
            "comps": _comps(r.pricing.market),
            "over_max_price": _over_cap(r),
        }
        for r in rows
    ]

    summary["rows_above_max_price"] = len(above_cap)

    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version": __version__,
        "elapsed_seconds": round(elapsed, 2),
        "max_price": max_price,
        "summary": summary,
        "tags": tags_payload,
        "highlights": {
            "most_valuable": [_card_summary(r) for r in top5],
            "missing": missing,
            "above_max_price": above_cap,
        },
        "rows": rows_payload,
    }


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(__version__, "-V", "--version", prog_name="pkmn")
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
@click.option("-v", "--verbose", is_flag=True, help="Verbose output.")
def cli(
    input_paths: tuple[Path, ...],
    output: Path,
    images_dir: Path,
    api_key: str | None,
    no_images: bool,
    max_price: float | None,
    dedupe: bool,
    report_json: Path | None,
    pdf: Path | None,
    no_cache: bool,
    clear_cache: bool,
    default_lang: str | None,
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
        if q.bulk_top:
            try:
                top = find_top_cards(pkmn_client, q, limit=q.bulk_top, max_price=max_price)
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

    # Sort within each tag group: highest market price first. Tag order is
    # preserved (first-appearance) so the per-file sections stay in the order
    # the files were read. Rows without a price (no match / new releases) sink
    # to the bottom of their section. Stable across equal prices.
    tag_order: list[str] = []
    for r in rows:
        if r.tag not in tag_order:
            tag_order.append(r.tag)
    tag_rank = {t: i for i, t in enumerate(tag_order)}
    rows.sort(
        key=lambda r: (
            tag_rank.get(r.tag, len(tag_rank)),
            -(r.pricing.market or 0.0),
        )
    )

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
        write_binder_pdf(rows, pdf, title=title, max_price=max_price)
        sections = len({r.tag for r in rows if r.tag})
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{pdf}  "
            + click.style(
                f"({len(rows)} cards, {sections} section{'s' if sections != 1 else ''})",
                fg="bright_black",
            )
        )

    if report_json:
        payload = _build_json_report(
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


if __name__ == "__main__":
    cli()
