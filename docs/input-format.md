# Input format

One card per line. Blank lines and `#` comments are ignored. The parser is
intentionally loose — leading list markers are stripped, a card-number
token is detected if present (`4/102`, `SWSH286`, `SV20/SV94`, …), and the
rest is treated as `name [- set]`.

## Single-card lookups

```text
# Pipe-delimited (canonical, most precise)
Charizard | Base | 4/102

# Dash-delimited
Charizard - Base Set - 4/102

# Positional
Charizard 4/102 Base Set
Pikachu V SWSH286
Mewtwo GX 39/214

# Markdown task / bullet lists — prefixes are stripped automatically
- [ ] Meowth ex - Perfect Order
* [x] Charizard | Base | 4/102
1. Pikachu V SWSH286

# Variant hint in square brackets — selects the price tier
Lugia V 138/195 [holofoil]
Charizard 4/102 [1stEditionHolofoil]

# PriceCharting URL — appended in any position; takes precedence over DB lookup
- [ ] Cubone Chinese SIR - Gem Pack Vol 3 - https://www.pricecharting.com/game/pokemon-chinese-gem-pack-3/cubone-407
```

Number is **optional** — if you don't know it, just provide name and set:

```text
- [ ] Mewtwo - Hidden Fates
Charizard | Base
```

Recognised variants for `[…]`: `normal`, `holofoil`, `reverseHolofoil`,
`1stEditionHolofoil`, `unlimitedHolofoil`, `1stEdition`, `unlimited`. If
you omit it, the highest-priority variant with a market price is used.

## Bulk "top-N chase cards"

One input line expands to multiple rows.

```text
All Exeggutor cards                # → every priced Exeggutor variant, ranked by price
top:3 Charizard                    # → 3 highest-priced Charizards
top 10 charizard ex prints         # → 10 by name "Charizard ex"
top:5 Charizard | Hidden Fates     # → name + set filter
top 10 Surging Sparks cards        # → top from a SET (subject = set name)
top 10 S&V 151 cards               # → "S&V" expands to "Scarlet & Violet"
top 10 Mega Evolutions cards       # → singularised to set "Mega Evolution"
top 10 cute cards                  # → flavorText fallback (subjective)
top 4 Charmander/Charmeleon/Charizard cards  # → evolution line (each name searched, results unioned)
top 4 tag team cards               # → subtype TAG TEAM (cards with 2+ Pokemon)
top 4 vmax cards                   # → subtype VMAX (also: v, vstar, gx, ex, mega, break, ultra beast)
top 9 puppy cards                  # → curated dog-Pokemon list (also: dog, kitty, cat, baby)
top 9 starter cards                # → all first-stage starters across every generation
top 9 starter evolution cards      # → all stages of every starter line
top 9 eeveelution cards            # → Eevee + every evolution
top 9 pseudo-legendary cards       # → Dragonite, Tyranitar, Garchomp, etc.

# Inline price conditions on bulk lookups (combine with --max-price; most restrictive wins)
top 10 Charizard >= $20            # → exclude cheap fillers (only $20+)
top 5 Surging Sparks <= $50        # → cap at $50 just for this line
top 16 V GX cards >= $20 <= $100   # → range: only candidates in [$20, $100]
```

A bulk line is detected by the explicit `top:N` / `top N` prefix, or by
the phrase `All <subject> (cards|prints|versions)` (the suffix is required
to avoid stomping on real card names like *All Energy Removal*). Lines
that contain `|` or ` - ` are always treated as structured single-card
lookups, so `All Charizard | Base | 4/102` is *not* bulk.

### Subject types

The subject in `top:N <subject>` / `All <subject> cards` can be any of:

- **A Pokemon name** (`top:5 Exeggutor`) — direct name match.
- **A name + set filter** (`top:5 Charizard | Hidden Fates`).
- **A set name** (`top 10 Surging Sparks cards`) — when no name match is
  found, the subject is retried as a set. Common variants are normalized:
  `S&V` expands to `Scarlet & Violet`, plurals are singularized
  (`Mega Evolutions` → `Mega Evolution`), and `series + name` splits are
  tried (`Scarlet & Violet 151` → series `Scarlet & Violet`, set `151`).
- **A subjective term** (`top 10 cute cards`) — when neither a name nor a
  set matches, the term is searched against `flavorText` (every card whose
  flavor text contains the word). Works well for moods like *cute*,
  *legendary*, *fast*, etc.
- **A card subtype** (`top 4 tag team cards`, `top 4 vmax cards`) — when
  the subject exactly matches a known subtype keyword it's routed to a
  `subtypes:…` filter instead of a name search. Recognised: `tag team`,
  `v`, `vmax`, `vstar`, `v-union`, `gx`, `ex`, `mega`, `break`,
  `ultra beast`, `radiant`.
- **An evolution line** (`top 4 Charmander/Charmeleon/Charizard cards`) —
  slash-separated names are searched independently and the pools are
  unioned before ranking, so "top 4" returns the four highest-priced
  cards across the whole line.
- **A concept keyword** (`top 9 puppy cards`, `top 9 starter evolution
  cards`) — subjective subjects that don't map to a single name, set, or
  subtype. Each is hand-curated to a Pokemon name list, then handled
  exactly like an evolution line. Recognised: `puppy`, `dog`, `kitty`,
  `cat`, `starter`, `starter evolution`, `eeveelution`,
  `pseudo-legendary`, `baby`. Concept queries skip the set/flavorText
  fallback so a no-hit result returns empty rather than overshooting
  (e.g. `starter evolution` previously matched the unrelated "Mega
  Evolution" set).

### Lookup flow

1. Subject is a subtype keyword → `subtypes:…` query (other paths skipped).
2. Otherwise: name search (per-name for evolution lines) → set fallback
   → flavorText fallback. Name results are word-boundary filtered, so
   `top 4 Mew` no longer pulls in Mewtwo from prefix-wildcard matches.
3. Drop candidates without a TCGPlayer / Cardmarket market price (they
   can't be ranked meaningfully — usually too new or never indexed).
4. Sort descending by market price, keep the top *N*.

Each surviving card becomes its own row in the spreadsheet and its own
cell in the PDF binder.

## Known limitations

- **Inline price filtering is approximate.** The comparator parser
  distinguishes strict (`>`, `<`) from inclusive (`>=`, `<=`) and
  intersects with `--max-price`, but it's currency-blind and silently
  drops conditions on single-card lookups. A line like
  `Charizard | Base | 4 >= $100` parses the bound but doesn't act on
  it. Acceptable for bulk budgeting; not a general-purpose query
  language.
- **No structural / vague-term search.** Phrases like `evolution line of
  Eevee`, `SIRs only`, `V, Vmax, EX, or GX cards`, or `modern <subject>`
  fall through the name → set-name → flavorText fallback chain — they
  *might* hit something via flavorText, but there's no real understanding
  of subtypes (`subtypes:V`, `subtypes:VMAX`), card families, or
  "modern" as a recency filter. A structured `top:N subtype:V,VMAX in
  Surging Sparks` syntax (or even plain English with a small DSL on top
  of pokemontcg.io's `subtypes:` field) is the next big win.

## Notes

- Set-name matching boosts exact matches so `Base` resolves to the
  original Base Set rather than Base Set 2. For ambiguous sets, prefer
  the canonical pipe form (`Name | Set | Number`).
- "Secret rare" cards are often numbered higher than the printed set
  total (e.g. Champion's Path Charizard V is `79/73`). Use the database
  number when in doubt.
