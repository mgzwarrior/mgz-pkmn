"""The `pkmn cache` subcommand group: inspect, clear, and warm the on-disk cache."""

from __future__ import annotations

import json
from dataclasses import asdict

import click
import requests

from .. import __version__
from .. import cache as disk_cache
from ..card_images import DEFAULT_SIZES, parse_bytes_budget, warm_card_images
from ..lookup import WARM_SOURCES, warm_cards, warm_concepts, warm_set_cards
from ..set_cards import warm_set_images
from ..sources import TCGClient, TCGDexClient
from ._cache_warn import _format_age, _format_bytes
from ._styling import _print_banner, _print_section


def _parse_sizes(ctx: click.Context, param: click.Parameter, value: str) -> tuple[str, ...]:
    """Validate / normalise the --sizes flag for `warm-card-images`."""
    parsed: list[str] = []
    for raw in value.split(","):
        token = raw.strip().lower()
        if not token:
            continue
        if token not in DEFAULT_SIZES:
            raise click.BadParameter(
                f"unknown size {token!r}; expected one of {','.join(DEFAULT_SIZES)}"
            )
        if token not in parsed:
            parsed.append(token)
    if not parsed:
        raise click.BadParameter("at least one size required")
    return tuple(parsed)


def _parse_max_bytes(ctx: click.Context, param: click.Parameter, value: str | None) -> int | None:
    """Validate / parse --max-bytes via card_images.parse_bytes_budget."""
    if value is None:
        return None
    try:
        return parse_bytes_budget(value)
    except ValueError as exc:
        raise click.BadParameter(str(exc)) from exc


def _make_progress_printer(verbose: bool):
    """Build a `(index, total, label) -> None` callback used by every warm command."""

    def _progress(index: int, total: int, label: str) -> None:
        if not verbose:
            return
        click.echo(
            click.style(f"  [{index}/{total}] ", fg="bright_black") + label,
            err=False,
        )

    return _progress


def _print_stats_storage(s) -> None:
    total_bytes = (
        s.api_bytes
        + s.api_structural_bytes
        + s.api_pricing_bytes
        + s.override_bytes
        + s.image_bytes
    )
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
    click.echo(
        "  "
        + click.style("Structural:    ", fg="bright_black")
        + f"{s.api_structural_entry_count} entries · "
        + f"{_format_bytes(s.api_structural_bytes)} · indefinite TTL"
    )
    pricing_age = _format_age(s.api_pricing_oldest_mtime)
    click.echo(
        "  "
        + click.style("Pricing:       ", fg="bright_black")
        + f"{s.api_pricing_entry_count} entries · "
        + f"{_format_bytes(s.api_pricing_bytes)} · oldest {pricing_age} · 24h SWR"
    )
    click.echo(
        "  "
        + click.style("Images:        ", fg="bright_black")
        + f"{s.image_entry_count} entries · {_format_bytes(s.image_bytes)} · indefinite TTL"
    )


def register(cli: click.Group) -> None:
    @cli.group(name="cache", context_settings={"help_option_names": ["-h", "--help"]})
    def cache_group() -> None:
        """Inspect and manage the on-disk cache."""

    _register_path(cache_group)
    _register_stats(cache_group)
    _register_clear(cache_group)
    _register_warm_sets(cache_group)
    _register_warm_concepts(cache_group)
    _register_warm_set_cards(cache_group)
    _register_warm_cards(cache_group)
    _register_warm_card_images(cache_group)


def _register_path(cache_group: click.Group) -> None:
    @cache_group.command(name="path", context_settings={"help_option_names": ["-h", "--help"]})
    def cache_path_command() -> None:
        """Print the cache root path for shell composition."""
        click.echo(str(disk_cache.cache_root()))


def _register_stats(cache_group: click.Group) -> None:
    @cache_group.command(name="stats", context_settings={"help_option_names": ["-h", "--help"]})
    @click.option("--json", "as_json", is_flag=True, help="Emit JSON instead of the human summary.")
    def cache_stats_command(as_json: bool) -> None:
        """Show on-disk cache health: total size, oldest entry, override count.

        Reports stats even when MGZ_PKMN_NO_CACHE is set — the user is asking
        about real on-disk state, not the effective behaviour of the current
        run."""
        s = disk_cache.stats()
        if as_json:
            payload = asdict(s)
            payload["root"] = str(s.root)
            click.echo(json.dumps(payload, indent=2))
            return

        _print_section("Cache stats")
        _print_stats_storage(s)
        _print_warm_slices(s)


def _print_warm_slices(s) -> None:
    """Render the bottom half of `cache stats` — warm-manifest rows.

    Kept separate from `_print_stats_storage` so each block stays linear and
    radon doesn't see one giant function that walks every cache slice."""
    # Concepts.
    if s.concept_warm_timestamp is None:
        click.echo(
            "  "
            + click.style("Concepts:      ", fg="bright_black")
            + click.style("not warmed", fg="yellow")
            + " · run `pkmn cache warm-concepts` to prime"
        )
    else:
        click.echo(
            "  "
            + click.style("Concepts:      ", fg="bright_black")
            + f"{s.concept_warm_names} names · warmed {_format_age(s.concept_warm_timestamp)}"
        )
    # Set cards.
    if s.set_cards_warm_timestamp is None:
        click.echo(
            "  "
            + click.style("Set cards:     ", fg="bright_black")
            + click.style("not warmed", fg="yellow")
            + " · run `pkmn cache warm-set-cards` to prime"
        )
    else:
        click.echo(
            "  "
            + click.style("Set cards:     ", fg="bright_black")
            + f"{s.set_cards_warm_count} sets · warmed "
            + f"{_format_age(s.set_cards_warm_timestamp)}"
        )
    # Sets (logos/symbols).
    if s.sets_warm_timestamp is None:
        click.echo(
            "  "
            + click.style("Sets:          ", fg="bright_black")
            + click.style("not warmed", fg="yellow")
            + " · run `pkmn cache warm-sets` to prime"
        )
    else:
        click.echo(
            "  "
            + click.style("Sets:          ", fg="bright_black")
            + f"{s.sets_warm_count} sets · warmed {_format_age(s.sets_warm_timestamp)}"
        )
    # Per-card structural slice.
    if s.card_warm_timestamp is None:
        click.echo(
            "  "
            + click.style("Cards:         ", fg="bright_black")
            + click.style("not warmed", fg="yellow")
            + " · run `pkmn cache warm-cards` to prime"
        )
    else:
        line = (
            "  "
            + click.style("Cards:         ", fg="bright_black")
            + f"{s.card_warm_count} cards · warmed {_format_age(s.card_warm_timestamp)}"
        )
        if s.card_warm_failed_count:
            line += click.style(f" · {s.card_warm_failed_count} failed", fg="yellow")
        click.echo(line)
    # Card images.
    if s.card_images_warm_timestamp is None:
        click.echo(
            "  "
            + click.style("Card images:   ", fg="bright_black")
            + click.style("not warmed", fg="yellow")
            + " · run `pkmn cache warm-card-images` to prime"
        )
    else:
        line = (
            "  "
            + click.style("Card images:   ", fg="bright_black")
            + f"{s.card_images_warm_count} images · "
            + f"{_format_bytes(s.card_images_warm_bytes)} · warmed "
            + f"{_format_age(s.card_images_warm_timestamp)}"
        )
        if s.card_images_warm_budget_reached:
            line += click.style(" · budget reached", fg="yellow")
        click.echo(line)


def _register_clear(cache_group: click.Group) -> None:
    @cache_group.command(name="clear", context_settings={"help_option_names": ["-h", "--help"]})
    def cache_clear_command() -> None:
        """Wipe cached API responses; preserve URL overrides and images.

        Standalone counterpart to `pkmn lookup --clear-cache` — same wipe, no
        lookup required. Reclaims the regenerable API slice (`cache/api/*.json`)
        while leaving the user-supplied `url_overrides.json` and the
        indefinite-TTL image cache (`cache/images/`) untouched, since those
        take real effort to populate.

        Runs even when `MGZ_PKMN_NO_CACHE=1` is set: the user explicitly asked
        for a wipe, and a no-op surprise would defeat the purpose. No
        confirmation prompt — the action is recoverable (next run re-fetches)
        and prompts complicate scripting; the `clear` name is intent enough."""
        before = disk_cache.stats()
        count = disk_cache.clear_api_cache()

        _print_section("Clearing API response cache")
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{count} entr{'y' if count == 1 else 'ies'} cleared · "
            + click.style(f"{_format_bytes(before.api_bytes)} freed", bold=True)
            + click.style(" (overrides + images preserved)", fg="bright_black")
        )


def _register_warm_sets(cache_group: click.Group) -> None:
    @cache_group.command(name="warm-sets", context_settings={"help_option_names": ["-h", "--help"]})
    @click.option(
        "--api-key",
        envvar="POKEMONTCG_IO_API_KEY",
        default=None,
        help="pokemontcg.io API key (or set POKEMONTCG_IO_API_KEY).",
    )
    @click.option("-v", "--verbose", is_flag=True, help="Print each set as it warms.")
    def cache_warm_sets_command(api_key: str | None, verbose: bool) -> None:
        """Pre-download every set's logo + symbol into the unified image cache.

        Walks the pokemontcg.io set catalog (~200+ sets) and persists each
        logo + symbol into `cache/images/sets/` with no TTL — so the first
        `pkmn set-cards` (or web Set ID cards) run after a fresh install
        serves every image from disk instead of the network. Re-running is
        cheap: already-cached entries short-circuit on hit.

        Pairs with `pkmn cache stats`, which surfaces the indefinite-TTL
        image slice on its own line."""
        _print_banner(__version__)

        _print_section("Warming set image cache")
        client = TCGClient(api_key=api_key, verbose=verbose)

        try:
            result = warm_set_images(client, on_progress=_make_progress_printer(verbose))
        except requests.RequestException as exc:
            raise click.ClickException(f"set fetch failed: {exc}") from exc

        if result.sets == 0:
            raise click.ClickException("pokemontcg.io returned no sets")

        disk_cache.write_sets_warm(
            sets_warmed=result.sets,
            logos_cached=result.logos_cached,
            symbols_cached=result.symbols_cached,
            failures=result.failures,
        )

        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{result.sets} sets · "
            + click.style(f"{result.logos_cached} logos", fg="cyan")
            + " · "
            + click.style(f"{result.symbols_cached} symbols", fg="cyan")
            + (
                click.style(f" · {result.failures} failures", fg="yellow")
                if result.failures
                else ""
            )
        )

        count, total_bytes = disk_cache.image_cache_size()
        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(f"image cache now {count} entries · {_format_bytes(total_bytes)}")

        click.echo()
        click.secho("Done!", fg="green", bold=True)


def _register_warm_concepts(cache_group: click.Group) -> None:
    @cache_group.command(
        name="warm-concepts", context_settings={"help_option_names": ["-h", "--help"]}
    )
    @click.option(
        "--api-key",
        envvar="POKEMONTCG_IO_API_KEY",
        default=None,
        help="pokemontcg.io API key (or set POKEMONTCG_IO_API_KEY).",
    )
    @click.option(
        "--source",
        type=click.Choice(WARM_SOURCES, case_sensitive=False),
        default="all",
        show_default=True,
        help=(
            "Restrict the warm pass to a single source. 'all' walks pokemontcg.io "
            "first and falls back to TCGdex on miss. Note: only the pokemontcg.io "
            "path writes through to the disk cache — TCGdex caches in-memory only, "
            "so its branch is useful within a long-lived process (e.g. the FastAPI "
            "service) but a no-op across separate CLI runs."
        ),
    )
    @click.option("-v", "--verbose", is_flag=True, help="Print each name as it warms.")
    def cache_warm_concepts_command(api_key: str | None, source: str, verbose: bool) -> None:
        """Pre-prime the API cache for every name referenced by `_CONCEPT_KEYWORDS`.

        Concept lookups (`top 9 puppy`, `all eeveelution cards`, …) expand to N
        underlying name searches. On a cold cache that's N upstream calls per
        concept query; this command walks the curated dictionary up front so
        subsequent concept lookups resolve as cache hits.

        Writes a manifest at `concept_warm.json` in the cache root with a
        timestamp + count so `pkmn cache stats` can report freshness and the
        FastAPI startup hook (`MGZ_PKMN_WARM_ON_STARTUP=1`) can gate itself to
        run at most once per day."""
        _print_banner(__version__)

        _print_section(f"Warming concept cache · source={source}")
        pkmn = TCGClient(api_key=api_key, verbose=verbose)
        tcgdex = TCGDexClient(verbose=verbose)

        try:
            result = warm_concepts(
                pkmn, tcgdex, source=source, on_progress=_make_progress_printer(verbose)
            )
        except requests.RequestException as exc:
            raise click.ClickException(f"concept warm failed: {exc}") from exc

        if result.names_attempted == 0:
            raise click.ClickException("_CONCEPT_KEYWORDS produced no names — check the dictionary")

        disk_cache.write_concept_warm(
            names_warmed=result.names_warmed,
            names_failed=result.names_failed,
            source=source,
        )

        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{result.names_attempted} names · "
            + click.style(f"{result.names_warmed} warmed", fg="cyan")
            + (
                click.style(f" · {len(result.names_failed)} missed", fg="yellow")
                if result.names_failed
                else ""
            )
        )
        if result.names_failed and verbose:
            click.echo(
                "  " + click.style("missed: ", fg="bright_black") + ", ".join(result.names_failed)
            )

        click.echo()
        click.secho("Done!", fg="green", bold=True)


def _register_warm_set_cards(cache_group: click.Group) -> None:
    @cache_group.command(
        name="warm-set-cards", context_settings={"help_option_names": ["-h", "--help"]}
    )
    @click.option(
        "--api-key",
        envvar="POKEMONTCG_IO_API_KEY",
        default=None,
        help="pokemontcg.io API key (or set POKEMONTCG_IO_API_KEY).",
    )
    @click.option(
        "--set",
        "set_ids",
        multiple=True,
        metavar="SET_ID",
        help=(
            "Restrict the warm pass to specific set ids (e.g. --set sv8 --set sv9). "
            "Repeatable. When omitted, every set in the Pokémon TCG catalog is warmed."
        ),
    )
    @click.option("-v", "--verbose", is_flag=True, help="Print each set as it warms.")
    def cache_warm_set_cards_command(
        api_key: str | None,
        set_ids: tuple[str, ...],
        verbose: bool,
    ) -> None:
        """Pre-prime the API cache for every set's card list.

        The Browse surface in the web SPA opens the per-set card grid via
        `GET /api/v1/sets/{set_id}/cards`. On a cold cache, every first
        pick of a set pays a multi-second upstream round trip. This
        command walks every set once, fires the exact same query the
        endpoint issues, and writes the responses to the on-disk API
        cache — turning the user-facing endpoint into a cache hit on
        first request.

        A full warm walks ~170 sets and pages each one (3 pages on
        average), so expect a multi-minute run on a fresh install
        bounded by pokemontcg.io's rate limit. The disk-cache TTL is one
        week; this command's manifest tracks that same window so
        `pkmn cache stats` and the API startup gate can decide when to
        re-warm.

        Pass `--set <id>` (repeatable) to warm only specific sets — useful
        for staging a single new set release without re-walking the whole
        catalog."""
        _print_banner(__version__)

        pkmn = TCGClient(api_key=api_key, verbose=verbose)

        section = "Warming set-cards cache"
        if set_ids:
            section += f" · {len(set_ids)} set(s)"
        _print_section(section)

        try:
            result = warm_set_cards(
                pkmn,
                set_ids=list(set_ids) if set_ids else None,
                on_progress=_make_progress_printer(verbose),
            )
        except requests.RequestException as exc:
            raise click.ClickException(f"set-cards warm failed: {exc}") from exc

        if result.sets_attempted == 0:
            raise click.ClickException(
                "no sets to warm — check `--set` ids or upstream catalog availability"
            )

        disk_cache.write_set_cards_warm(
            sets_warmed=result.sets_warmed,
            sets_failed=result.sets_failed,
        )

        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{result.sets_attempted} sets · "
            + click.style(f"{result.sets_warmed} warmed", fg="cyan")
            + (
                click.style(f" · {len(result.sets_failed)} missed", fg="yellow")
                if result.sets_failed
                else ""
            )
        )
        if result.sets_failed and verbose:
            click.echo(
                "  " + click.style("missed: ", fg="bright_black") + ", ".join(result.sets_failed)
            )

        click.echo()
        click.secho("Done!", fg="green", bold=True)


def _register_warm_cards(cache_group: click.Group) -> None:
    @cache_group.command(
        name="warm-cards", context_settings={"help_option_names": ["-h", "--help"]}
    )
    @click.option(
        "--api-key",
        envvar="POKEMONTCG_IO_API_KEY",
        default=None,
        help="pokemontcg.io API key (or set POKEMONTCG_IO_API_KEY).",
    )
    @click.option(
        "--set",
        "set_ids",
        multiple=True,
        metavar="SET_ID",
        help=(
            "Restrict the warm pass to specific set ids (e.g. --set sv8 --set sv9). "
            "Repeatable. When omitted, every set in the Pokémon TCG catalog is warmed."
        ),
    )
    @click.option(
        "--max-cards",
        type=int,
        default=None,
        metavar="N",
        help="Cap the total cards warmed across the whole pass. Useful for incremental warming.",
    )
    @click.option(
        "--skip-existing/--no-skip-existing",
        default=True,
        show_default=True,
        help=(
            "Skip cards whose per-card cache entry is already on disk. "
            "Re-runs are cheap by default."
        ),
    )
    @click.option(
        "--throttle-ms",
        type=int,
        default=0,
        metavar="MS",
        help="Sleep between sets to stay inside upstream rate limits (default: no throttle).",
    )
    @click.option("-v", "--verbose", is_flag=True, help="Print each set as it warms.")
    def cache_warm_cards_command(
        api_key: str | None,
        set_ids: tuple[str, ...],
        max_cards: int | None,
        skip_existing: bool,
        throttle_ms: int,
        verbose: bool,
    ) -> None:
        """Pre-warm the per-card structural cache for the entire English catalog.

        Phase 1 of the pre-Scrydex catalog-warm epic (#368). Walks every
        set, then fan-out-writes a per-card cache entry for every card in
        the set's payload. Reuses the data each set's search already
        returns — no extra HTTP calls vs `warm-set-cards`, just one extra
        disk entry per card so the Phase 3 lookup refactor can resolve
        cards directly by id.

        A full pass walks ~170 sets and writes one cache entry per card
        (~18,000 entries total for English). Re-runs honor
        `--skip-existing` (default on) so only the cards that have fallen
        out of the cache get re-written.

        Pass `--set <id>` (repeatable) to warm only specific sets — useful
        for staging a single new set release.

        Pass `--max-cards N` to do a partial warm bounded by total card
        count — useful for staging the first pass over multiple days if
        you're inside pokemontcg.io's free-tier rate limit.
        """
        _print_banner(__version__)

        pkmn = TCGClient(api_key=api_key, verbose=verbose)

        section = "Warming per-card cache"
        if set_ids:
            section += f" · {len(set_ids)} set(s)"
        if max_cards is not None:
            section += f" · max {max_cards} cards"
        _print_section(section)

        try:
            result = warm_cards(
                pkmn,
                set_ids=list(set_ids) if set_ids else None,
                max_cards=max_cards,
                skip_existing=skip_existing,
                throttle_ms=throttle_ms,
                on_progress=_make_progress_printer(verbose),
            )
        except requests.RequestException as exc:
            raise click.ClickException(f"card warm failed: {exc}") from exc

        if result.sets_attempted == 0:
            raise click.ClickException(
                "no sets to warm — check `--set` ids or upstream catalog availability"
            )

        disk_cache.write_card_warm(
            cards_warmed=result.cards_warmed,
            cards_failed=result.cards_failed,
            sets_attempted=result.sets_attempted,
            sets_failed=result.sets_failed,
        )

        click.secho("  ✓ ", fg="green", nl=False)
        click.echo(
            f"{result.sets_attempted} sets · "
            + click.style(f"{result.cards_warmed} cards warmed", fg="cyan")
            + (
                click.style(f" · {result.cards_failed} failed", fg="yellow")
                if result.cards_failed
                else ""
            )
            + (
                click.style(f" · {len(result.sets_failed)} sets missed", fg="yellow")
                if result.sets_failed
                else ""
            )
        )
        if result.sets_failed and verbose:
            click.echo(
                "  " + click.style("missed: ", fg="bright_black") + ", ".join(result.sets_failed)
            )

        click.echo()
        click.secho("Done!", fg="green", bold=True)


def _register_warm_card_images(cache_group: click.Group) -> None:
    @cache_group.command(
        name="warm-card-images", context_settings={"help_option_names": ["-h", "--help"]}
    )
    @click.option(
        "--api-key",
        envvar="POKEMONTCG_IO_API_KEY",
        default=None,
        help="pokemontcg.io API key (or set POKEMONTCG_IO_API_KEY).",
    )
    @click.option(
        "--set",
        "set_ids",
        multiple=True,
        metavar="SET_ID",
        help=(
            "Restrict the warm pass to specific set ids (e.g. --set sv8 --set sv9). "
            "Repeatable. When omitted, every set in the Pokémon TCG catalog is warmed."
        ),
    )
    @click.option(
        "--sizes",
        callback=_parse_sizes,
        default=",".join(DEFAULT_SIZES),
        show_default=True,
        metavar="LIST",
        help="Comma-separated image sizes to warm: any subset of large,small.",
    )
    @click.option(
        "--max-bytes",
        callback=_parse_max_bytes,
        default=None,
        metavar="SIZE",
        help=(
            "Hard cap on cumulative downloaded bytes for this pass "
            "(suffixes: KB, MB, GB, TB). Stops cleanly when reached."
        ),
    )
    @click.option(
        "--skip-existing/--no-skip-existing",
        default=True,
        show_default=True,
        help="Skip images already on disk. Re-runs are cheap by default.",
    )
    @click.option(
        "--throttle-ms",
        type=int,
        default=0,
        metavar="MS",
        help="Sleep between set fetches (default: no throttle).",
    )
    @click.option(
        "--prefer-popular",
        is_flag=True,
        default=False,
        help=(
            "Reserved for future lookup-frequency-aware ordering (see issue #371). "
            "Currently a no-op."
        ),
    )
    @click.option("-v", "--verbose", is_flag=True, help="Print each set as it warms.")
    def cache_warm_card_images_command(
        api_key: str | None,
        set_ids: tuple[str, ...],
        sizes: tuple[str, ...],
        max_bytes: int | None,
        skip_existing: bool,
        throttle_ms: int,
        prefer_popular: bool,
        verbose: bool,
    ) -> None:
        """Pre-download per-card image bytes to the persistent disk image cache.

        Phase 2 of the pre-Scrydex catalog-warm epic (#368). Walks every
        set, then for each card fetches the requested `--sizes`
        (`large,small` by default) and persists the bytes under
        `cache/images/cards/{size}/<card_id>.<ext>`. The API serving route
        at `/api/v1/cards/{id}/image/{size}` streams those files directly,
        and the SPA's `<img>` tags are transparently rewritten to use it.

        First-pass cost: ~36K image fetches (~18K cards x large + small)
        at ~80-150 KB each -> 3-5 GB on disk. `--max-bytes` caps the
        budget so a runaway pass can't fill the persistent disk; staging
        across multiple runs is supported by the default `--skip-existing`."""
        _print_banner(__version__)
        _ = prefer_popular  # currently a no-op; see issue #371.

        pkmn = TCGClient(api_key=api_key, verbose=verbose)

        section = "Warming card images"
        if set_ids:
            section += f" · {len(set_ids)} set(s)"
        section += f" · sizes={','.join(sizes)}"
        if max_bytes is not None:
            section += f" · max {_format_bytes(max_bytes)}"
        _print_section(section)

        try:
            result = warm_card_images(
                pkmn,
                set_ids=list(set_ids) if set_ids else None,
                sizes=sizes,
                max_bytes=max_bytes,
                skip_existing=skip_existing,
                throttle_ms=throttle_ms,
                on_progress=_make_progress_printer(verbose),
            )
        except requests.RequestException as exc:
            raise click.ClickException(f"card-image warm failed: {exc}") from exc

        if result.sets_attempted == 0:
            raise click.ClickException(
                "no sets to warm — check `--set` ids or upstream catalog availability"
            )

        disk_cache.write_card_images_warm(
            images_warmed=result.images_warmed,
            images_failed=result.images_failed,
            bytes_written=result.bytes_written,
            budget_reached=result.budget_reached,
            sets_attempted=result.sets_attempted,
            sets_failed=result.sets_failed,
        )

        click.secho("  ✓ ", fg="green", nl=False)
        summary = (
            f"{result.sets_attempted} sets · "
            + click.style(f"{result.images_warmed} images warmed", fg="cyan")
            + f" · {_format_bytes(result.bytes_written)} downloaded"
        )
        if result.images_failed:
            summary += click.style(f" · {result.images_failed} failed", fg="yellow")
        if result.sets_failed:
            summary += click.style(f" · {len(result.sets_failed)} sets missed", fg="yellow")
        if result.budget_reached:
            summary += click.style(" · budget reached", fg="yellow")
        click.echo(summary)

        if result.sets_failed and verbose:
            click.echo(
                "  " + click.style("missed: ", fg="bright_black") + ", ".join(result.sets_failed)
            )

        click.echo()
        click.secho("Done!", fg="green", bold=True)
