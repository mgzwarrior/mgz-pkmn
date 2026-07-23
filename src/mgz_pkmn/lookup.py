"""Top-level lookup coordinator: pokemontcg.io → URL hint → TCGdex (multilingual)."""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from . import cache as disk_cache
from .parser import CardQuery, detect_card_language, detect_languages, strip_noise
from .pricing import extract_pricing
from .sources import (
    PriceChartingClient,
    TCGClient,
    TCGDexClient,
    search_pokemontcg,
    search_tcgdex,
)
from .sources.base import MatchResult, name_clause

# Source filters accepted by `warm_concepts()` and the `--source` flag on
# `pkmn cache warm-concepts`. Kept as a tuple so the CLI can advertise the
# full set in help text without re-declaring it.
WARM_SOURCES = ("pokemontcg", "tcgdex", "all")

# Pipeline stages surfaced to the web UI via the bulk SSE stream. The lookup
# coordinator emits the intermediate stages (`looking_up` / `fallback` /
# `url_hint` / `pricing`) through the optional `on_stage` callback below; the
# API route brackets a run with `parsed` and resolves it into one of the
# terminal stages (`resolved` / `no_match` / `error`). `image` is part of the
# vocabulary the CLI uses when it downloads thumbnails, but the web flow runs
# image-free, so it never fires there. Kept here as the single source of truth
# so the API, the SPA, and the tests all agree on the spelling.
LOOKUP_STAGES = (
    "parsed",
    "url_hint",
    "looking_up",
    "fallback",
    "pricing",
    "image",
    "resolved",
    "no_match",
    "error",
)

# Type alias for the per-stage progress callback threaded through the lookup
# coordinator. Invoked with the stage name as the lookup advances through its
# sources; `None` (the default) disables emission entirely for callers — like
# the CLI and the single-line `/lookup` endpoint — that don't stream progress.
StageCallback = Callable[[str], None]

# Bulk subjects that aren't Pokemon names but card subtypes. When the user
# writes `top 4 tag team` they want cards whose subtype is "TAG TEAM" (cards
# featuring 2+ Pokemon), not cards literally named "tag team". Keys are
# matched case-insensitively against the cleaned subject, exact equality only
# — partial matches would over-trigger (e.g. "ex" appearing inside a name).
_SUBTYPE_KEYWORDS: dict[str, str] = {
    "tag team": "TAG TEAM",
    "v": "V",
    "vmax": "VMAX",
    "vstar": "VSTAR",
    "v-union": "V-UNION",
    "gx": "GX",
    "ex": "EX",
    "mega": "MEGA",
    "break": "BREAK",
    "ultra beast": "Ultra Beast",
    "radiant": "Radiant",
}

# Subjective concept subjects that don't map to a single Pokemon name, set,
# or subtype. Each value is a `/`-separated list of Pokemon names — once
# expanded, the rest of the lookup pipeline treats it identically to a
# slash-separated evolution line. Curated explicitly (rather than relying on
# flavorText fuzzy matches) because those produce false positives like
# "Spell Tag" surfacing for `puppy` because its flavor text mentions a dog.
#
# Add new concepts as they come up — anything subjective the user might
# reasonably type that doesn't have a precise database query equivalent.
_CONCEPT_KEYWORDS: dict[str, str] = {
    "puppy": (
        "Growlithe/Snubbull/Houndour/Poochyena/Electrike/Riolu/Lillipup/"
        "Furfrou/Rockruff/Yamper/Fidough"
    ),
    "dog": (
        "Growlithe/Arcanine/Snubbull/Granbull/Houndour/Houndoom/Poochyena/"
        "Mightyena/Electrike/Manectric/Riolu/Lucario/Lillipup/Herdier/"
        "Stoutland/Furfrou/Rockruff/Lycanroc/Yamper/Boltund/Fidough/Dachsbun"
    ),
    "kitty": "Meowth/Skitty/Glameow/Purrloin/Litten/Espurr/Sprigatito",
    "cat": (
        "Meowth/Persian/Skitty/Delcatty/Glameow/Purugly/Purrloin/Liepard/"
        "Litten/Torracat/Incineroar/Espurr/Meowstic/Sprigatito/Floragato/"
        "Meowscarada"
    ),
    "starter": (
        "Bulbasaur/Charmander/Squirtle/"
        "Chikorita/Cyndaquil/Totodile/"
        "Treecko/Torchic/Mudkip/"
        "Turtwig/Chimchar/Piplup/"
        "Snivy/Tepig/Oshawott/"
        "Chespin/Fennekin/Froakie/"
        "Rowlet/Litten/Popplio/"
        "Grookey/Scorbunny/Sobble/"
        "Sprigatito/Fuecoco/Quaxly"
    ),
    "starter evolution": (
        "Bulbasaur/Ivysaur/Venusaur/Charmander/Charmeleon/Charizard/"
        "Squirtle/Wartortle/Blastoise/"
        "Chikorita/Bayleef/Meganium/Cyndaquil/Quilava/Typhlosion/"
        "Totodile/Croconaw/Feraligatr/"
        "Treecko/Grovyle/Sceptile/Torchic/Combusken/Blaziken/"
        "Mudkip/Marshtomp/Swampert/"
        "Turtwig/Grotle/Torterra/Chimchar/Monferno/Infernape/"
        "Piplup/Prinplup/Empoleon/"
        "Snivy/Servine/Serperior/Tepig/Pignite/Emboar/"
        "Oshawott/Dewott/Samurott/"
        "Chespin/Quilladin/Chesnaught/Fennekin/Braixen/Delphox/"
        "Froakie/Frogadier/Greninja/"
        "Rowlet/Dartrix/Decidueye/Litten/Torracat/Incineroar/"
        "Popplio/Brionne/Primarina/"
        "Grookey/Thwackey/Rillaboom/Scorbunny/Raboot/Cinderace/"
        "Sobble/Drizzile/Inteleon/"
        "Sprigatito/Floragato/Meowscarada/Fuecoco/Crocalor/Skeledirge/"
        "Quaxly/Quaxwell/Quaquaval"
    ),
    "eeveelution": "Eevee/Vaporeon/Jolteon/Flareon/Espeon/Umbreon/Leafeon/Glaceon/Sylveon",
    "pseudo-legendary": (
        "Dragonite/Tyranitar/Salamence/Metagross/Garchomp/Hydreigon/"
        "Goodra/Kommo-o/Dragapult/Baxcalibur"
    ),
    "baby": (
        "Pichu/Cleffa/Igglybuff/Togepi/Tyrogue/Smoochum/Elekid/Magby/"
        "Azurill/Wynaut/Budew/Chingling/Bonsly/Mime Jr./Happiny/Munchlax/"
        "Riolu/Mantyke"
    ),
}


def _is_pricecharting_url(url: str) -> bool:
    """Return True when URL host is pricecharting.com or one of its subdomains."""
    try:
        host = urlparse(url).hostname
    except ValueError:
        return False
    if not host:
        return False
    host = host.lower()
    return host == "pricecharting.com" or host.endswith(".pricecharting.com")


def _apply_price_bounds(result: MatchResult, q: CardQuery) -> MatchResult:
    """Return a price_mismatch MatchResult when the card violates inline bounds.

    Both `price_min` and `price_max` on the query are checked. Cards with no
    pricing data pass through — filtering on an unknown price would silently
    swallow valid matches."""
    if result.card is None:
        return result
    if q.price_min is None and q.price_max is None:
        return result

    pricing = extract_pricing(result.card, q.variant_hint)
    if pricing.market is None:
        return result

    if q.price_min is not None:
        if q.price_min_exclusive:
            if pricing.market <= q.price_min:
                return MatchResult(None, "price_mismatch", cache_status=result.cache_status)
        else:
            if pricing.market < q.price_min:
                return MatchResult(None, "price_mismatch", cache_status=result.cache_status)

    if q.price_max is not None:
        if q.price_max_exclusive:
            if pricing.market >= q.price_max:
                return MatchResult(None, "price_mismatch", cache_status=result.cache_status)
        else:
            if pricing.market > q.price_max:
                return MatchResult(None, "price_mismatch", cache_status=result.cache_status)

    return result


def find_card(
    pkmn: TCGClient,
    tcgdex: TCGDexClient,
    pc: PriceChartingClient,
    q: CardQuery,
    default_lang: str | None = None,
    on_stage: StageCallback | None = None,
    cache_only: bool = False,
) -> MatchResult:
    """Coordinate lookups across pokemontcg.io, TCGdex (multilingual), and an
    optional explicit URL hint (currently PriceCharting). The first source
    that returns a usable match wins; the rest are skipped.

    PriceCharting URLs (explicit on the line, or auto-applied from a previous
    run via the URL-override store) take precedence over the public databases
    because the user has already disambiguated the card by hand.

    `default_lang` is consulted only as a fallback when the line itself didn't
    name a language. It's used by the CLI/API global ``--lang`` knob — set it
    to ``"ja"`` to make every untagged line fall through to TCGdex Japanese
    after pokemontcg.io misses.

    `cache_only` makes the whole coordinator non-network: pokemontcg.io disk
    misses degrade to MISS-CACHE-ONLY instead of fetching upstream, and the
    PriceCharting / TCGdex branches are skipped entirely (neither has disk
    persistence today, so any call would be a live HTTP request — exactly
    what hosted-demo anonymous traffic must not do).

    `on_stage`, when provided, is called with the name of each pipeline stage
    as the lookup advances (`url_hint` / `looking_up` / `fallback`) so the web
    UI can show finer-grained per-line progress. It's a pure passthrough of
    state that already drives control flow here — see `LOOKUP_STAGES`."""

    def _stage(name: str) -> None:
        if on_stage is not None:
            on_stage(name)

    # 1. Explicit URL hint takes precedence — the user already found the card.
    #    A scrape failure (404 / 500 / connection error) propagates as
    #    `scrape_failed` so the CLI can name the URL instead of pretending
    #    nothing matched. The override is recorded ONLY on success so a bad
    #    URL the user pastes once doesn't get pinned as a sticky override
    #    that quietly fails on every subsequent run.
    if not cache_only and q.url_hint and _is_pricecharting_url(q.url_hint):
        _stage("url_hint")
        result = pc.fetch(q.url_hint)
        if result.card:
            disk_cache.record_url_override(q.name, q.set_hint, q.url_hint)
            result = _apply_price_bounds(result, q)
        return result
    # Other URL hosts: not yet supported; fall through to DB search.

    # 2. URL override (sticky) — an earlier run recorded a PriceCharting URL
    #    for this (name, set). Treat it like an explicit hint so the user
    #    only has to paste a URL once per card across runs. If the override
    #    is stale or the scrape fails, fall through to DB sources rather than
    #    failing the lookup — the user didn't paste it this run.
    override = disk_cache.find_url_override(q.name, q.set_hint)
    if not cache_only and override and _is_pricecharting_url(override):
        _stage("url_hint")
        override_result = pc.fetch(override)
        if override_result.card:
            return _apply_price_bounds(override_result, q)

    # 3. pokemontcg.io — best for English / international English releases.
    _stage("looking_up")
    primary = search_pokemontcg(pkmn, q, cache_only=cache_only)
    if primary.card:
        return _apply_price_bounds(primary, q)
    # cache_only must short-circuit before the TCGdex fallback even when
    # pokemontcg.io served a cache HIT/STALE with zero candidates — TCGdex
    # has no disk cache, so any fallback call is a live upstream request.
    if cache_only:
        return primary

    # 3. TCGdex — fall back through any languages hinted in the input, then EN.
    langs = detect_languages(q.name) or []
    # Apply the global default *only* when the line itself didn't already name
    # a language. A per-line keyword like "Charizard japanese" should always
    # win over `--lang ja` (and over `--lang fr` — explicit beats default).
    if not langs and default_lang:
        langs.append(default_lang)
    if "en" not in langs:
        langs.append("en")

    saw_set_mismatch = primary.reason == "set_mismatch"
    _stage("fallback")
    for lang in langs:
        result = search_tcgdex(tcgdex, q, lang)
        if result.card:
            # TCGdex has no disk persistence today, so its MatchResult
            # cache_status is always MISS. Inherit pokemontcg.io's L2
            # status when we have a match — the user's lookup *was*
            # served via the cache path even if the eventual answer came
            # from TCGdex's in-memory layer. Disk persistence on TCGdex
            # is tracked separately; this branch will update naturally
            # when that lands.
            return _apply_price_bounds(
                MatchResult(
                    result.card,
                    result.reason,
                    url=result.url,
                    candidates=result.candidates,
                    cache_status=primary.cache_status,
                ),
                q,
            )
        if result.reason == "set_mismatch":
            saw_set_mismatch = True

    # Empty result: preserve the cache_status the pokemontcg.io read
    # actually observed. Without this the no_candidates / set_mismatch
    # path resets to the MatchResult default "MISS" and the /lookup route
    # reports a false MISS on a cached empty payload.
    return MatchResult(
        None,
        "set_mismatch" if saw_set_mismatch else "no_candidates",
        cache_status=primary.cache_status,
    )


def _set_fallback_queries(subject: str) -> list[str]:
    """Generate set-name query variants for a free-form subject like
    'Surging Sparks', 'Mega Evolutions', or 'S&V 151'. Tries:
        * verbatim set.name match
        * S&V → Scarlet & Violet expansion
        * trailing-'s' singularization (Mega Evolutions → Mega Evolution)
        * series + set-name split (Scarlet & Violet 151 → series + name='151')
        * suffix-only set.name (handles sets the user mentally lumps with a
          series but pokemontcg.io classifies under their own — e.g.
          'S&V Mega Evolutions' → set 'Mega Evolution', series 'Mega Evolution')

    Returned in *most-specific-first* order: queries whose set.name component
    is longest run first so generic single-word matches like
    `set.name:"Evolutions"` (which would falsely capture Prismatic Evolutions
    et al.) only fire after every longer phrase has been ruled out."""
    import re as _re

    out: list[str] = []
    candidates: list[str] = [subject]
    expanded = _re.sub(r"\bs&v\b", "Scarlet & Violet", subject, flags=_re.IGNORECASE)
    if expanded != subject:
        candidates.append(expanded)
    if subject.endswith("s"):
        candidates.append(subject[:-1])
    if expanded.endswith("s") and expanded != subject:
        candidates.append(expanded[:-1])

    for cand in dict.fromkeys(candidates):
        out.append(f'set.name:"{cand}"')
        out.append(f'set.series:"{cand}"')
        tokens = cand.split()
        for i in range(1, len(tokens)):
            series = " ".join(tokens[:i])
            name = " ".join(tokens[i:])
            out.append(f'set.series:"{series}" set.name:"{name}"')
            out.append(f'set.name:"{name}"')

    deduped = list(dict.fromkeys(out))

    name_re = _re.compile(r'set\.name:"([^"]+)"')

    def _name_specificity(q: str) -> int:
        m = name_re.search(q)
        return len(m.group(1)) if m else 0

    deduped.sort(key=_name_specificity, reverse=True)
    return deduped


def _subtype_filter(subject: str) -> str | None:
    """Return a Lucene `subtypes:…` clause if the subject exactly matches a
    known card subtype keyword, else None.

    Matches the cleaned-and-lowercased subject against `_SUBTYPE_KEYWORDS`.
    We require exact equality so a query like `top 5 charizard ex` (where
    "ex" is part of the card name) doesn't get hijacked into a subtype
    search."""
    raw = _SUBTYPE_KEYWORDS.get(subject.lower().strip())
    if not raw:
        return None
    return f'subtypes:"{raw}"' if " " in raw else f"subtypes:{raw}"


def _split_evolution_line(name: str) -> list[str]:
    """Split slash-separated evolution lines into individual names.

    `Charmander/Charmeleon/Charizard` → `[Charmander, Charmeleon, Charizard]`.
    Whitespace around each name is trimmed; empty fragments are dropped."""
    if "/" not in name:
        return [name]
    parts = [p.strip() for p in name.split("/") if p.strip()]
    return parts or [name]


def _expand_concept(subject: str) -> str | None:
    """Return a `/`-joined Pokemon name list for a known concept keyword.

    Lets `top 9 puppy` resolve through the same code path as
    `top 9 Growlithe/Snubbull/...`. Returns None for unknown subjects so
    the caller falls through to the regular name → set → flavorText chain."""
    return _CONCEPT_KEYWORDS.get(subject.lower().strip())


def _name_token_match(card_name: str, query_names: list[str]) -> bool:
    """True if any query name appears as a complete word in card_name.

    Word-boundary matching: 'Mew' matches 'Mew', 'Mew V', 'Mew-EX' but NOT
    'Mewtwo'. Used to post-filter prefix/wildcard search results so we don't
    return Mewtwo when the user asked for Mew."""
    name_lower = (card_name or "").lower()
    for q in query_names:
        token = q.lower().strip()
        if not token:
            continue
        pattern = r"\b" + re.escape(token) + r"\b"
        if re.search(pattern, name_lower):
            return True
    return False


# Type alias for the per-query search callback the stage helpers below share.
# `find_top_cards` builds one closure over `pkmn` + `cache_only` + the optional
# `on_cache_status` sink, then hands it to each stage so the cache status keeps
# flowing out no matter which search path resolves the line.
SearchFn = Callable[[str], list[dict[str, Any]]]


def _set_clauses(q: CardQuery) -> tuple[str, str]:
    """Set-name + set-series Lucene clause fragments for a set hint.

    Returns a pair of leading-space clauses (`' set.name:"…"'`,
    `' set.series:"…"'`) to append onto a search query, or two empty strings
    when the query carries no set hint."""
    if not q.set_hint:
        return "", ""
    return f' set.name:"{q.set_hint}"', f' set.series:"{q.set_hint}"'


def _ingest_card(card: dict[str, Any], seen_ids: set[str], pool: list[dict[str, Any]]) -> None:
    """Dedupe `card` by id into `pool`, stamping the default database + language.

    Shared by every search stage so the id-dedupe, `_database` default, and
    `language` detection stay identical across the subtype / name / set-fallback
    / flavor paths. Cards without an id, or whose id is already pooled, are
    dropped."""
    cid = card.get("id")
    if not cid or cid in seen_ids:
        return
    seen_ids.add(cid)
    card.setdefault("_database", "pokemontcg.io")
    card.setdefault(
        "language",
        detect_card_language(card.get("name"), (card.get("set") or {}).get("name")),
    )
    pool.append(card)


def _search_subtypes(
    search: SearchFn,
    subtype_clause: str,
    q: CardQuery,
    seen_ids: set[str],
    pool: list[dict[str, Any]],
) -> None:
    """Subtype shortcut — e.g. `top 4 tag team` → subtypes:"TAG TEAM".

    When the subject IS a subtype, the name-search path is skipped entirely (the
    token-boundary post-filter would otherwise drop everything). A set hint adds
    name + series variants and short-circuits once one of them fills the pool."""
    set_clause, series_clause = _set_clauses(q)
    subtype_queries = (
        [subtype_clause + set_clause, subtype_clause + series_clause]
        if q.set_hint
        else [subtype_clause]
    )
    for query in dict.fromkeys(subtype_queries):
        for card in search(query):
            _ingest_card(card, seen_ids, pool)
        if q.set_hint and pool:
            break


def _search_names(
    search: SearchFn,
    names: list[str],
    q: CardQuery,
    seen_ids: set[str],
    pool: list[dict[str, Any]],
) -> None:
    """Name + wildcard search for each evolution-line / multi-name subject.

    Each name is searched independently and unioned. The wildcard fallback
    (`name:Mew*` → catches "Mew V", "Mew VMAX") only adds value for single-name
    queries; for multi-name lookups the explicit list is comprehensive enough,
    so wildcards just multiply API calls and dilute the pool. Wildcards are
    further gated to plain alphanumeric head tokens — anything with special
    chars (&, :, parens) breaks Lucene parsing. A set hint short-circuits once a
    matching query fills the pool so unfiltered shapes don't dilute it.

    A closing word-boundary post-filter keeps only cards whose name contains one
    of the query names as a complete word, so `Mew` doesn't pull in `Mewtwo`
    from the wildcard fallback. The pool is filtered in place (`pool[:]`) so the
    caller's reference still sees the result."""
    set_clause, series_clause = _set_clauses(q)
    queries: list[str] = []
    emit_wildcard = len(names) == 1
    for name in names:
        head_token = name.split(" ", 1)[0] if name else ""
        head_safe = head_token if (emit_wildcard and head_token.isalnum()) else ""
        if q.set_hint:
            queries.append(name_clause(name) + set_clause)
            queries.append(name_clause(name) + series_clause)
            if head_safe:
                queries.append(f"name:{head_safe}*" + set_clause)
        queries.append(name_clause(name))
        if head_safe:
            queries.append(f"name:{head_safe}*")

    for query in dict.fromkeys(queries):
        for card in search(query):
            _ingest_card(card, seen_ids, pool)
        if q.set_hint and pool:
            break

    pool[:] = [c for c in pool if _name_token_match(c.get("name", ""), names)]


def _search_set_fallback(
    search: SearchFn,
    cleaned: str,
    seen_ids: set[str],
    pool: list[dict[str, Any]],
) -> None:
    """Treat the subject as a set name when the name search came up empty.

    `top 10 Surging Sparks cards` / `top 10 S&V 151 cards` name nothing but a
    set, so try a few set-name shapes (see `_set_fallback_queries`) and stop at
    the first that returns cards."""
    for set_query in _set_fallback_queries(cleaned):
        for card in search(set_query):
            _ingest_card(card, seen_ids, pool)
        if pool:
            break


def _search_flavor(
    search: SearchFn,
    names: list[str],
    q: CardQuery,
    seen_ids: set[str],
    pool: list[dict[str, Any]],
) -> None:
    """Flavor-text fallback for subjective / non-name queries.

    `top:10 cute cards` yields no hits against `name:` or `set:`, so search
    `flavorText:` across the database for any card whose flavor text mentions
    the term. Tokens are pulled per evolution-line name so
    `Charmander/.../Charizard` isn't fed in as one broken `flavorText:"..."`
    clause; short tokens (< 3 chars) are dropped as noise."""
    set_clause, _ = _set_clauses(q)
    flavor_terms = [t for n in names for t in n.split() if len(t) >= 3]
    for term in dict.fromkeys(flavor_terms):
        flavor_query = f'flavorText:"{term}"'
        if q.set_hint:
            flavor_query += set_clause
        for card in search(flavor_query):
            _ingest_card(card, seen_ids, pool)


def _rank_and_cap(
    pool: list[dict[str, Any]],
    q: CardQuery,
    max_price: float | None,
    limit: int | None,
) -> list[dict[str, Any]]:
    """Price-filter, rank by market, and cut the pool to `limit`.

    Combines the global `max_price` cap with the per-query inline bounds
    (`q.price_min` / `q.price_max`): both upper bounds are intersected (most
    restrictive wins) while the lower bound only comes from the query. The
    global cap is inclusive, but a strict `<` query bound sharing the winning
    value keeps its strict flag. Cards without a usable market price are dropped
    (they can't be ranked); survivors sort descending and `limit=None` returns
    the full ranked pool."""
    effective_max = max_price
    effective_max_exclusive = False
    if q.price_max is not None:
        if effective_max is None or q.price_max < effective_max:
            effective_max = q.price_max
            effective_max_exclusive = q.price_max_exclusive
        elif q.price_max == effective_max and q.price_max_exclusive:
            effective_max_exclusive = True
    effective_min = q.price_min
    effective_min_exclusive = q.price_min_exclusive

    enriched: list[tuple[float, dict[str, Any]]] = []
    for card in pool:
        pricing = extract_pricing(card, q.variant_hint)
        if pricing.market is None:
            continue
        if effective_max is not None:
            if effective_max_exclusive:
                if pricing.market >= effective_max:
                    continue
            elif pricing.market > effective_max:
                continue
        if effective_min is not None:
            if effective_min_exclusive:
                if pricing.market <= effective_min:
                    continue
            elif pricing.market < effective_min:
                continue
        enriched.append((pricing.market, card))

    enriched.sort(key=lambda pair: pair[0], reverse=True)
    ranked = enriched if limit is None else enriched[:limit]
    return [card for _, card in ranked]


def find_top_cards(
    pkmn: TCGClient,
    q: CardQuery,
    limit: int | None = 5,
    max_price: float | None = None,
    on_stage: StageCallback | None = None,
    on_cache_status: Callable[[str], None] | None = None,
    cache_only: bool = False,
) -> list[dict[str, Any]]:
    """Return up to `limit` chase cards for a name, ranked by market price.

    `limit=None` returns the full ranked pool — used by "All <Pokemon> cards"
    queries that want every known card, not a top-N cut.

    "Chase" means most valuable — we ask pokemontcg.io for everything matching
    the name, keep only entries with a usable market price, and sort descending.
    Cards without prices (often very new releases) are dropped because they
    can't be ranked meaningfully. If `q.set_hint` is set, both the API filter
    and a post-hoc set-overlap check restrict results to that set.

    Subjects matching a card subtype (`tag team`, `v`, `vmax`, `gx`, …) are
    routed to a `subtypes:…` query. Slash-separated subjects
    (`Charmander/Charmeleon/Charizard`) are treated as an evolution line: each
    name is searched independently and the pool is unioned before ranking.

    `max_price` (currency-agnostic, applied to the raw market figure) filters
    candidates *before* the top-N cut so an affordable cap still returns N
    results when there are enough cheap variants in the pool. The per-query
    bounds (`q.price_min` / `q.price_max`) are AND-combined with `max_price`,
    so an inline `>= $20` on the line excludes cheap fillers and inline
    `<= $50` further tightens the global cap.

    `cache_only` applies to pokemontcg.io lookups. When True, cached results
    can still resolve but disk misses are treated as empty results instead of
    live upstream requests.

    `on_stage`, when provided, is called with `looking_up` before the upstream
    searches and `pricing` before the pool is ranked, so the web UI can show
    per-line progress for bulk (`top:N` / `All <set>`) queries."""
    if on_stage is not None:
        on_stage("looking_up")

    cleaned = strip_noise(q.name) or q.name
    seen_ids: set[str] = set()
    pool: list[dict[str, Any]] = []

    def search(query: str) -> list[dict[str, Any]]:
        """Wrap `pkmn.search_all` so the per-query cache status flows out
        through `on_cache_status` even when the result is iterated inline."""
        cards, status = pkmn.search_all(query, cache_only=cache_only)
        if on_cache_status is not None:
            on_cache_status(status)
        return cards

    # Concept expansion — `top 9 puppy` becomes a multi-name search across a
    # curated dog-Pokemon list. We replace `cleaned` with the expanded
    # slash-string so the rest of the pipeline treats it identically to a
    # user-typed evolution line. `is_concept` then suppresses the set/flavor
    # fallback chain — the curated list is the source of truth, and falling
    # through would surface noise (e.g. `top 9 starter evolution` previously
    # matched the "Mega Evolution" set).
    is_concept = False
    expanded = _expand_concept(cleaned)
    if expanded is not None:
        cleaned = expanded
        is_concept = True

    subtype_clause = _subtype_filter(cleaned)
    name_search_skipped = subtype_clause is not None
    if subtype_clause:
        _search_subtypes(search, subtype_clause, q, seen_ids, pool)

    # Evolution-line / multi-name support. Each name is searched independently
    # and unioned. For a single name this is a list of one — same flow.
    names = _split_evolution_line(cleaned)
    if not name_search_skipped:
        _search_names(search, names, q, seen_ids, pool)

    # The subject might BE a set name when the name search found nothing and the
    # user gave no set hint. Skipped for concept queries — the curated name list
    # is the source of truth, and falling through once landed `top 9 starter
    # evolution` on the unrelated "Mega Evolution" set.
    if not pool and not q.set_hint and not name_search_skipped and not is_concept:
        _search_set_fallback(search, cleaned, seen_ids, pool)

    # Flavor-text fallback for subjective subjects. Skipped for subtype subjects
    # (an empty `subtypes:V` pool genuinely means no matches, and a flavor
    # search on "v" is noise) and for concept queries (a flavor search on the
    # expanded names only adds noise to the explicit name search).
    if not pool and not name_search_skipped and not is_concept:
        _search_flavor(search, names, q, seen_ids, pool)

    # Set filter post-hoc for safety (the API filter is mostly precise but
    # we may have done a fallback wildcard that ignored set).
    if q.set_hint:
        from .sources.base import set_overlap

        pool = [c for c in pool if set_overlap(c, q.set_hint)]

    if on_stage is not None:
        on_stage("pricing")

    return _rank_and_cap(pool, q, max_price, limit)


# ---------------------------------------------------------------------------
# Concept warming — pre-prime the disk cache for every distinct name in
# `_CONCEPT_KEYWORDS` so that subsequent concept lookups (`top 9 puppy`,
# `all eeveelution cards`, …) resolve from cache with zero upstream calls.
#
# The warm pass MUST issue the exact query shapes the lookup path issues, or
# the cache keys won't line up. Concept queries go through `find_top_cards`,
# which calls `pkmn.search_all(name_clause(name))` directly (pageSize=50, all
# pages). We mirror that — calling `search_pokemontcg` here would prime the
# *wrong* cache key (`search()` / pageSize=12) and the user-facing lookup
# would still fan out to upstream.
#
# TCGdex caveat: `TCGDexClient` keeps an in-memory dict cache only, with no
# disk persistence. The TCGdex branch below is therefore useful within a
# single long-lived process (e.g. the FastAPI service with
# `MGZ_PKMN_WARM_ON_STARTUP=1`) but a no-op across separate CLI invocations.
# Adding a disk layer to TCGdex is tracked separately; until then the
# `--source tcgdex|all` flag's TCGdex pass is best-effort, not durable.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WarmConceptsResult:
    """Outcome of a `warm_concepts` run.

    `names_attempted` is the deduplicated count of names walked from
    `_CONCEPT_KEYWORDS`. `names_warmed` counts the names where at least one
    source returned a card (and therefore wrote through the disk cache).
    `names_failed` lists the names where every enabled source missed — useful
    for the operator to scan after the run and decide whether the curated
    dictionary has drifted from upstream catalogs (e.g. a typo in a
    `_CONCEPT_KEYWORDS` entry, or a name retired by the database)."""

    names_attempted: int
    names_warmed: int
    names_failed: list[str] = field(default_factory=list)


def iter_concept_names() -> set[str]:
    """Return the deduplicated set of distinct Pokemon names referenced by
    `_CONCEPT_KEYWORDS`.

    Splits every `/`-separated value, trims whitespace, drops empties, and
    folds duplicates — names like `Riolu` (appearing in both `puppy` and
    `baby`) only need to be warmed once."""
    return {
        n.strip() for value in _CONCEPT_KEYWORDS.values() for n in value.split("/") if n.strip()
    }


def warm_concepts(
    pkmn: TCGClient,
    tcgdex: TCGDexClient,
    *,
    source: str = "all",
    on_progress: Callable[[int, int, str], None] | None = None,
) -> WarmConceptsResult:
    """Walk every distinct name in `_CONCEPT_KEYWORDS` and prime the cache
    for each one.

    `source` selects which database(s) to walk:
        * ``"pokemontcg"`` — pokemontcg.io only (writes through the disk
          cache; persists across runs)
        * ``"tcgdex"`` — TCGdex only (English; in-memory cache only —
          useful within a single long-lived process, not across CLI runs)
        * ``"all"`` — pokemontcg.io first; on miss, fall back to TCGdex

    The pokemontcg.io pass issues exactly `pkmn.search_all(name_clause(name))`
    — the same query `find_top_cards` issues for unconstrained concept
    lookups — so the cache keys line up and the user-facing concept query
    becomes a true cache hit.

    `on_progress`, when provided, is invoked once per name with
    `(index, total, name)` so callers can render a progress bar.

    Returns a `WarmConceptsResult` so the CLI / API can render a summary
    and write the on-disk manifest that `pkmn cache stats` reports against."""
    if source not in WARM_SOURCES:
        raise ValueError(f"unknown source {source!r}; expected one of {WARM_SOURCES}")

    names = sorted(iter_concept_names())
    total = len(names)
    warmed = 0
    failed: list[str] = []
    for index, name in enumerate(names, start=1):
        if on_progress is not None:
            on_progress(index, total, name)
        hit = False
        if source in ("pokemontcg", "all"):
            # MUST mirror `find_top_cards`' query shape so the cache keys
            # line up. See the section comment above.
            query = name_clause(name)
            results, _status = pkmn.search_all(query)
            if results:
                hit = True
        # Fall through to TCGdex on miss (or always, when source="tcgdex").
        # In-memory only — see TCGdex caveat in the section comment above.
        if not hit and source in ("tcgdex", "all"):
            q = CardQuery(raw=name, name=name)
            tcgdex_result = search_tcgdex(tcgdex, q, "en")
            if tcgdex_result.card is not None:
                hit = True
        if hit:
            warmed += 1
        else:
            failed.append(name)
    return WarmConceptsResult(
        names_attempted=total,
        names_warmed=warmed,
        names_failed=failed,
    )


# ---------------------------------------------------------------------------
# Set-cards warming — walk every set and prime the API cache for each one's
# card list, so the SPA's Browse → set-detail path becomes a true cache hit
# on first pick instead of a multi-second upstream round trip.
#
# This MUST mirror the query shape `api/routes/sets.py:_fetch_set_cards`
# issues — `client.search_all(f'set.id:"<id>"')` — or the cache keys won't
# line up and the user-facing endpoint will still fan out to upstream.
# The pokemontcg.io free tier rate-limits at 30 rpm; with ~170 sets at
# ~3 pages each, a full warm is a multi-minute background job.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WarmSetCardsResult:
    """Outcome of a `warm_set_cards` run.

    `sets_attempted` is the count of set ids walked (after any explicit
    filter). `sets_warmed` counts the sets where pokemontcg.io returned
    at least one card and we therefore wrote through to the disk cache.
    `sets_failed` lists the set ids where the search returned zero
    results — useful for the operator to spot ids that have been
    retired upstream or typo'd in a manual `--set` flag."""

    sets_attempted: int
    sets_warmed: int
    sets_failed: list[str] = field(default_factory=list)


def fetch_set_ids(pkmn: TCGClient) -> list[str]:
    """Return every Pokémon TCG set id from pokemontcg.io, oldest → newest.

    Single-call helper used by `warm_set_cards` so the warmer doesn't have
    to know about FastAPI's catalog endpoint. We deliberately don't go
    through the API response disk cache here — the warmer is what
    populates that cache, and a 7-day-old set list would mean newly
    released sets quietly miss the warm pass for up to a week. Set ids
    are short (~5 KB total for ~170 sets), so re-fetching every warm pass
    is negligible cost.

    Raises `requests.RequestException` on transport failure; callers
    surface that as a user-visible error rather than silently warming
    against an empty list."""
    from .sources.pokemontcg import API_BASE

    url = f"{API_BASE}/sets?orderBy=releaseDate&pageSize=250"
    resp = pkmn.session.get(url, timeout=30)
    resp.raise_for_status()
    return [s["id"] for s in resp.json().get("data", []) if s.get("id")]


def warm_set_cards(
    pkmn: TCGClient,
    *,
    set_ids: list[str] | None = None,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> WarmSetCardsResult:
    """Pre-prime the API disk cache for every set's card list.

    `set_ids`, when provided, restricts the walk to that subset — handy
    for the CLI's `--set` flag to warm a single set on demand. When
    None (the default), the full Pokémon TCG catalog is fetched via
    `fetch_set_ids` and every id is walked.

    Each set fires exactly `pkmn.search_all(f'set.id:"{set_id}"')` — the
    same query `api/routes/sets.py:_fetch_set_cards` issues. The disk
    cache key (a sha1 of the request URL) is derived deep inside
    `TCGClient._fetch_page`, so as long as the query strings match, the
    keys line up and the user-facing endpoint becomes a cache hit on
    first request.

    `on_progress`, when provided, is invoked once per set with
    `(index, total, set_id)` so callers can render a progress bar.

    Returns a `WarmSetCardsResult` so the CLI / API can render a summary
    and write the on-disk manifest that `pkmn cache stats` reports
    against."""
    ids = set_ids if set_ids is not None else fetch_set_ids(pkmn)
    total = len(ids)
    warmed = 0
    failed: list[str] = []
    for index, set_id in enumerate(ids, start=1):
        if on_progress is not None:
            on_progress(index, total, set_id)
        # MUST mirror `_fetch_set_cards` so the disk-cache key lines up.
        query = f'set.id:"{set_id}"'
        results, _status = pkmn.search_all(query)
        if results:
            warmed += 1
        else:
            failed.append(set_id)
    return WarmSetCardsResult(
        sets_attempted=total,
        sets_warmed=warmed,
        sets_failed=failed,
    )


# ---------------------------------------------------------------------------
# warm_cards — Phase 1 of the pre-Scrydex catalog-warm epic (#368).
# Walks every English Pokémon TCG set and fan-out-writes per-card cache
# entries to the API disk slice. Reuses the data already in each set's
# search response — zero extra HTTP calls vs warm_set_cards — so the cost
# is the same as the set-cards pass, but the resulting cache has one
# entry per card-id (URL-keyed on `/v2/cards/{id}`) which Phase 3
# (#372) can resolve directly without a search query.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WarmCardsResult:
    """Outcome of a `warm_cards` run.

    `sets_attempted` is the number of sets walked. `sets_failed` lists
    set ids whose search returned no results (likely retired or
    mistyped).

    `cards_warmed` counts cards whose per-card cache entry was either
    newly written or already present (when `skip_existing=True`); both
    count as "warmed" because the post-condition is the same — the entry
    is on disk after the pass.

    `cards_failed` counts cards where the disk write raised — usually a
    full filesystem; rare in practice, but we surface it so an operator
    can spot a partial pass."""

    sets_attempted: int
    cards_warmed: int
    cards_failed: int
    sets_failed: list[str] = field(default_factory=list)


def warm_cards(
    pkmn: TCGClient,
    *,
    set_ids: list[str] | None = None,
    max_cards: int | None = None,
    skip_existing: bool = True,
    throttle_ms: int = 0,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> WarmCardsResult:
    """Walk every set's card list and write per-card cache entries.

    `set_ids`, when provided, restricts the walk to that subset — handy
    for `--sets` in the CLI. When None, walks the full Pokémon TCG
    catalog via `fetch_set_ids`.

    `max_cards` caps the number of *cards* written across the whole
    pass (not per-set). Useful for incremental warming on a tight
    upstream budget or for `--max-cards` in the CLI to do a partial
    walk. When None (default), every card in every walked set is
    processed.

    `skip_existing` (default True) probes the split cache before
    writing — so a re-run only re-writes the cards that have fallen out
    of the cache. The skipped entries still count toward `cards_warmed`
    in the result, since the post-condition (entry exists on disk) is
    satisfied either way.

    `throttle_ms`, when > 0, sleeps for that many milliseconds between
    set fetches. The per-card writes themselves don't hit upstream
    (they fan out from the set search response we already paid for),
    so the throttle only governs the set-level cadence — matters when
    you're inside pokemontcg.io's free-tier 30 rpm and want to stretch
    a full warm over multiple minutes/hours.

    `on_progress`, when provided, is invoked once per set with
    `(index, total, set_id)` so the CLI can render a progress bar.

    The disk cache key for each per-card entry is the URL
    `{API_BASE}/cards/{card_id}` — synthesized to match the shape a
    Phase 3 (#372) per-id read path will use. The payload is wrapped in
    a list (`[card]`) for consistency with the existing API-slice
    convention (every entry is a list of card objects)."""
    from .sources.pokemontcg import API_BASE

    ids = set_ids if set_ids is not None else fetch_set_ids(pkmn)
    total = len(ids)
    cards_warmed = 0
    cards_failed = 0
    sets_failed: list[str] = []

    for index, set_id in enumerate(ids, start=1):
        if on_progress is not None:
            on_progress(index, total, set_id)

        # Same query shape as warm_set_cards / api/routes/sets.py — the
        # disk-cache hit on `set.id:"X"` lets the set-cards endpoint
        # serve from disk for free. The data we get back is also what
        # we fan out into per-card entries below.
        query = f'set.id:"{set_id}"'
        cards, _status = pkmn.search_all(query)
        if not cards:
            sets_failed.append(set_id)
            if throttle_ms > 0:
                time.sleep(throttle_ms / 1000.0)
            continue

        for card in cards:
            card_id = card.get("id")
            if not card_id:
                cards_failed += 1
                continue
            card_url = f"{API_BASE}/cards/{card_id}"

            # `skip_existing=False` overwrites unconditionally, so don't
            # pay the read-probe cost on the overwrite path. Only probe
            # when we'd actually skip on a hit.
            if skip_existing:
                existing, _existing_status = disk_cache.read_api_split(card_url)
            else:
                existing = None
            if skip_existing and existing is not None:
                cards_warmed += 1
            else:
                # Wrap in a list to match the existing API-slice
                # convention (every cached entry is a list of card
                # objects, including single-result responses).
                #
                # `disk_cache.write_api_split` is best-effort and swallows
                # OSError/TypeError/ValueError internally. Verify the
                # write landed by reading the entry back — costs a stat
                # per card but ensures `cards_warmed` reflects what's
                # actually on disk. Without this, a read-only filesystem
                # or a serialization failure would write a "successful"
                # manifest and the freshness gate would suppress retries
                # for a week with the entries absent (the issue Copilot
                # flagged in #377's review).
                disk_cache.write_api_split(card_url, [card])
                verify, _verify_status = disk_cache.read_api_split(card_url)
                if verify is not None:
                    cards_warmed += 1
                else:
                    cards_failed += 1

            if max_cards is not None and cards_warmed >= max_cards:
                return WarmCardsResult(
                    sets_attempted=index,
                    cards_warmed=cards_warmed,
                    cards_failed=cards_failed,
                    sets_failed=sets_failed,
                )

        if throttle_ms > 0:
            time.sleep(throttle_ms / 1000.0)

    return WarmCardsResult(
        sets_attempted=total,
        cards_warmed=cards_warmed,
        cards_failed=cards_failed,
        sets_failed=sets_failed,
    )
