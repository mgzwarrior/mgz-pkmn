"""Top-level lookup coordinator: pokemontcg.io → URL hint → TCGdex (multilingual)."""

from __future__ import annotations

import re
from typing import Any

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


def find_card(
    pkmn: TCGClient,
    tcgdex: TCGDexClient,
    pc: PriceChartingClient,
    q: CardQuery,
    default_lang: str | None = None,
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
    after pokemontcg.io misses."""
    # 1. Explicit URL hint takes precedence — the user already found the card.
    #    Record it so future runs auto-pick it up without the user re-pasting.
    if q.url_hint and "pricecharting.com" in q.url_hint:
        disk_cache.record_url_override(q.name, q.set_hint, q.url_hint)
        card = pc.fetch(q.url_hint)
        if card:
            return MatchResult(card, "matched")
        return MatchResult(None, "no_candidates")
    # Other URL hosts: not yet supported; fall through to DB search.

    # 2. URL override (sticky) — an earlier run recorded a PriceCharting URL
    #    for this (name, set). Treat it like an explicit hint so the user
    #    only has to paste a URL once per card across runs.
    override = disk_cache.find_url_override(q.name, q.set_hint)
    if override and "pricecharting.com" in override:
        card = pc.fetch(override)
        if card:
            return MatchResult(card, "matched")

    # 3. pokemontcg.io — best for English / international English releases.
    primary = search_pokemontcg(pkmn, q)
    if primary.card:
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
    for lang in langs:
        result = search_tcgdex(tcgdex, q, lang)
        if result.card:
            return result
        if result.reason == "set_mismatch":
            saw_set_mismatch = True

    return MatchResult(None, "set_mismatch" if saw_set_mismatch else "no_candidates")


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


def find_top_cards(
    pkmn: TCGClient,
    q: CardQuery,
    limit: int | None = 5,
    max_price: float | None = None,
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
    `<= $50` further tightens the global cap."""
    cleaned = strip_noise(q.name) or q.name
    seen_ids: set[str] = set()
    pool: list[dict[str, Any]] = []

    set_clause = f' set.name:"{q.set_hint}"' if q.set_hint else ""
    series_clause = f' set.series:"{q.set_hint}"' if q.set_hint else ""

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

    # Subtype shortcut — e.g. `top 4 tag team` → subtypes:"TAG TEAM". When
    # the subject IS a subtype, skip the name-search path entirely (the
    # token-boundary post-filter would otherwise drop everything).
    subtype_clause = _subtype_filter(cleaned)
    name_search_skipped = subtype_clause is not None

    if subtype_clause:
        subtype_queries = (
            [subtype_clause + set_clause, subtype_clause + series_clause]
            if q.set_hint
            else [subtype_clause]
        )
        for query in dict.fromkeys(subtype_queries):
            for card in pkmn.search_all(query):
                cid = card.get("id")
                if not cid or cid in seen_ids:
                    continue
                seen_ids.add(cid)
                card.setdefault("_database", "pokemontcg.io")
                card.setdefault(
                    "language",
                    detect_card_language(card.get("name"), (card.get("set") or {}).get("name")),
                )
                pool.append(card)
            if q.set_hint and pool:
                break

    # Evolution-line / multi-name support. Each name is searched independently
    # and unioned. For a single name this is a list of one — same flow.
    names = _split_evolution_line(cleaned)

    if not name_search_skipped:
        queries: list[str] = []
        # Wildcard fallback (`name:Mew*` → catches "Mew V", "Mew VMAX") only
        # adds value for single-name queries. For multi-name lookups (concept
        # expansions, evolution lines) the explicit list is comprehensive
        # enough — wildcards just multiply API calls and dilute the pool.
        emit_wildcard = len(names) == 1
        for name in names:
            head_token = name.split(" ", 1)[0] if name else ""
            # Wildcards are only safe on plain alphanumeric tokens — anything
            # with special chars (&, :, parens) breaks Lucene parsing.
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
            for card in pkmn.search_all(query):
                cid = card.get("id")
                if not cid or cid in seen_ids:
                    continue
                seen_ids.add(cid)
                card.setdefault("_database", "pokemontcg.io")
                card.setdefault(
                    "language",
                    detect_card_language(card.get("name"), (card.get("set") or {}).get("name")),
                )
                pool.append(card)
            # If the user gave a set hint, a single matching query is enough —
            # we don't want unfiltered shapes to dilute the pool.
            if q.set_hint and pool:
                break

        # Word-boundary post-filter so `Mew` doesn't pull in `Mewtwo` from
        # the wildcard `name:Mew*` fallback. Skipped for set/flavor fallbacks
        # below because their results aren't keyed by name.
        pool = [c for c in pool if _name_token_match(c.get("name", ""), names)]

    # If a name search didn't find anything and the user didn't already give
    # a set hint, the subject might BE a set name (e.g. "top 10 Surging
    # Sparks cards" / "top 10 S&V 151 cards"). Try a few set-name shapes.
    # Skipped for concept queries — the curated name list is the source of
    # truth, and falling through previously caused `top 9 starter evolution`
    # to land on the unrelated "Mega Evolution" set.
    if not pool and not q.set_hint and not name_search_skipped and not is_concept:
        for set_query in _set_fallback_queries(cleaned):
            for card in pkmn.search_all(set_query):
                cid = card.get("id")
                if not cid or cid in seen_ids:
                    continue
                seen_ids.add(cid)
                card.setdefault("_database", "pokemontcg.io")
                card.setdefault(
                    "language",
                    detect_card_language(card.get("name"), (card.get("set") or {}).get("name")),
                )
                pool.append(card)
            if pool:
                break

    # Subjective / non-name queries (e.g. "top:10 cute cards") yield no hits
    # against `name:` or `set:`, so fall back to flavorText search across
    # the database. This catches any card whose flavor text mentions the term.
    # Skipped for subtype subjects — an empty `subtypes:V` pool genuinely
    # means no V cards matched the constraints, and a flavor fallback on "v"
    # would just be noise. Also skipped for concept queries: a flavor search
    # on "Bulbasaur" / "Ivysaur" / etc. (the expanded names) would only add
    # noise on top of what the explicit name search already returned.
    if not pool and not name_search_skipped and not is_concept:
        # Pull tokens from each evolution-line name so `Charmander/.../Charizard`
        # doesn't get fed in as a single broken `flavorText:"..."` clause.
        flavor_terms = [t for n in names for t in n.split() if len(t) >= 3]
        for term in dict.fromkeys(flavor_terms):
            flavor_query = f'flavorText:"{term}"'
            if q.set_hint:
                flavor_query += set_clause
            for card in pkmn.search_all(flavor_query):
                cid = card.get("id")
                if not cid or cid in seen_ids:
                    continue
                seen_ids.add(cid)
                card.setdefault("_database", "pokemontcg.io")
                card.setdefault(
                    "language",
                    detect_card_language(card.get("name"), (card.get("set") or {}).get("name")),
                )
                pool.append(card)

    # Set filter post-hoc for safety (the API filter is mostly precise but
    # we may have done a fallback wildcard that ignored set).
    if q.set_hint:
        from .sources.base import set_overlap

        pool = [c for c in pool if set_overlap(c, q.set_hint)]

    # Combine global cap with the per-query inline bounds. Both upper bounds
    # are intersected (most restrictive wins). The lower bound only comes
    # from the query — there's no global "minimum price" knob. The global
    # `--max-price` cap is always inclusive; if a strict `<` bound shares
    # the winning value with the cap, we keep the strict flag.
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
