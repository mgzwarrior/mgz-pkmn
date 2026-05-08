"""Top-level lookup coordinator: pokemontcg.io → URL hint → TCGdex (multilingual)."""

from __future__ import annotations

from typing import Any

from .parser import CardQuery, detect_languages, strip_noise
from .pricing import extract_pricing
from .sources import (
    PriceChartingClient,
    TCGClient,
    TCGDexClient,
    search_pokemontcg,
    search_tcgdex,
)
from .sources.base import MatchResult, name_clause


def find_card(
    pkmn: TCGClient,
    tcgdex: TCGDexClient,
    pc: PriceChartingClient,
    q: CardQuery,
) -> MatchResult:
    """Coordinate lookups across pokemontcg.io, TCGdex (multilingual), and an
    optional explicit URL hint (currently PriceCharting). The first source
    that returns a usable match wins; the rest are skipped."""
    # 1. Explicit URL hint takes precedence — the user already found the card.
    if q.url_hint and "pricecharting.com" in q.url_hint:
        card = pc.fetch(q.url_hint)
        if card:
            return MatchResult(card, "matched")
        return MatchResult(None, "no_candidates")
    # Other URL hosts: not yet supported; fall through to DB search.

    # 2. pokemontcg.io — best for English / international English releases.
    primary = search_pokemontcg(pkmn, q)
    if primary.card:
        return primary

    # 3. TCGdex — fall back through any languages hinted in the input, then EN.
    langs = detect_languages(q.name) or []
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


def find_top_cards(
    pkmn: TCGClient,
    q: CardQuery,
    limit: int = 5,
    max_price: float | None = None,
) -> list[dict[str, Any]]:
    """Return up to `limit` chase cards for a name, ranked by market price.

    "Chase" means most valuable — we ask pokemontcg.io for everything matching
    the name, keep only entries with a usable market price, and sort descending.
    Cards without prices (often very new releases) are dropped because they
    can't be ranked meaningfully. If `q.set_hint` is set, both the API filter
    and a post-hoc set-overlap check restrict results to that set.

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
    head_token = cleaned.split(" ", 1)[0] if cleaned else ""
    # Wildcards are only safe on plain alphanumeric tokens — anything with
    # special chars (&, :, parens) breaks Lucene parsing.
    head_safe = head_token if head_token.isalnum() else ""

    # Try a few query shapes — looser shapes broaden coverage to alt-arts and
    # regional variants. Set-name and set-series filters are tried in turn so
    # users can pass either (e.g. "Hidden Fates" set vs "Sword & Shield" series).
    queries: list[str] = []
    if q.set_hint:
        queries.append(name_clause(cleaned) + set_clause)
        queries.append(name_clause(cleaned) + series_clause)
        if head_safe:
            queries.append(f"name:{head_safe}*" + set_clause)
    queries.append(name_clause(cleaned))
    if head_safe:
        queries.append(f"name:{head_safe}*")

    for query in dict.fromkeys(queries):
        for card in pkmn.search_all(query):
            cid = card.get("id")
            if not cid or cid in seen_ids:
                continue
            seen_ids.add(cid)
            card.setdefault("_database", "pokemontcg.io")
            pool.append(card)
        # If the user gave a set hint, a single matching query is enough — we
        # don't want unfiltered shapes to dilute the pool.
        if q.set_hint and pool:
            break

    # If a name search didn't find anything and the user didn't already give
    # a set hint, the subject might BE a set name (e.g. "top 10 Surging
    # Sparks cards" / "top 10 S&V 151 cards"). Try a few set-name shapes.
    if not pool and not q.set_hint:
        for set_query in _set_fallback_queries(cleaned):
            for card in pkmn.search_all(set_query):
                cid = card.get("id")
                if not cid or cid in seen_ids:
                    continue
                seen_ids.add(cid)
                card.setdefault("_database", "pokemontcg.io")
                pool.append(card)
            if pool:
                break

    # Subjective / non-name queries (e.g. "top:10 cute cards") yield no hits
    # against `name:` or `set:`, so fall back to flavorText search across
    # the database. This catches any card whose flavor text mentions the term.
    if not pool:
        flavor_terms = [t for t in cleaned.split() if len(t) >= 3]
        for term in flavor_terms:
            flavor_query = f'flavorText:"{term}"'
            if q.set_hint:
                flavor_query += set_clause
            for card in pkmn.search_all(flavor_query):
                cid = card.get("id")
                if not cid or cid in seen_ids:
                    continue
                seen_ids.add(cid)
                card.setdefault("_database", "pokemontcg.io")
                pool.append(card)

    # Set filter post-hoc for safety (the API filter is mostly precise but
    # we may have done a fallback wildcard that ignored set).
    if q.set_hint:
        from .sources.base import set_overlap

        pool = [c for c in pool if set_overlap(c, q.set_hint)]

    # Combine global cap with the per-query inline bounds. Both upper bounds
    # are intersected (most restrictive wins). The lower bound only comes
    # from the query — there's no global "minimum price" knob.
    effective_max = max_price
    if q.price_max is not None:
        effective_max = q.price_max if effective_max is None else min(effective_max, q.price_max)
    effective_min = q.price_min

    enriched: list[tuple[float, dict[str, Any]]] = []
    for card in pool:
        pricing = extract_pricing(card, q.variant_hint)
        if pricing.market is None:
            continue
        if effective_max is not None and pricing.market > effective_max:
            continue
        if effective_min is not None and pricing.market < effective_min:
            continue
        enriched.append((pricing.market, card))

    enriched.sort(key=lambda pair: pair[0], reverse=True)
    return [card for _, card in enriched[:limit]]
