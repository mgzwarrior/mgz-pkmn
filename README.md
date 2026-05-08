# mgz-pkmn

[![CI](https://github.com/mgzwarrior/mgz-pkmn/actions/workflows/ci.yml/badge.svg)](https://github.com/mgzwarrior/mgz-pkmn/actions/workflows/ci.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/downloads/)

A toolkit for prepping Pokemon card binders for a card show: take a list of
cards, look each one up across **three open data sources**, download images,
and write an `.xlsx` with embedded thumbnails, current market price, and
80 / 85 / 90 / 95 % negotiation comps.

Two ways to drive it:

- **CLI** — `./pkmn cards.txt` produces xlsx + (optional) PDF binder + JSON report.
- **Web UI** — FastAPI backend in [api/](api/) and a React + Vite frontend in [web/](web/)
  put the same pipeline behind a live in-browser interface with streaming results
  and one-click export. See [Web UI](#web-ui) below.

The tool tries sources in this order:

1. **[pokemontcg.io]** — primary. Best coverage of English / international
   English releases, with TCGPlayer (USD) + Cardmarket (EUR) prices.
2. **[TCGdex]** — multilingual fallback (`en`, `ja`, `ko`, `zh-tw`, `zh-cn`,
   `de`, `fr`, `es`, `it`, `pt`, …). Has Cardmarket prices for many cards.
3. **[PriceCharting]** — opt-in via an explicit URL on the line. Ideal for
   region-exclusive products neither aggregator indexes (Chinese Gem Pack,
   etc.). Returns USD loose / new / graded prices.

[pokemontcg.io]: https://pokemontcg.io
[TCGdex]: https://tcgdex.dev
[PriceCharting]: https://www.pricecharting.com

## Requirements

- Python 3.11+
- [`uv`](https://docs.astral.sh/uv/) for dependency management

```bash
brew install uv                                   # macOS (Homebrew)
curl -LsSf https://astral.sh/uv/install.sh | sh   # any platform
```

## Setup

```bash
uv sync
```

`uv` reads [pyproject.toml](pyproject.toml), creates `.venv/`, installs
runtime + dev dependencies, and registers a `pkmn` console script.

### API key (optional but recommended)

The pokemontcg.io API works without a key (~1000 requests/day, 30/min) but a
free key raises that to 20k/day. Grab one at <https://dev.pokemontcg.io>, then
set it as an environment variable so it isn't recorded in shell history or
process listings:

```bash
export POKEMONTCG_IO_API_KEY=your-key-here          # current shell
echo 'export POKEMONTCG_IO_API_KEY=your-key-here' >> ~/.zshrc   # persistent
```

The CLI also accepts `--api-key …`, but **prefer the env var** — flags get
saved to shell history and are visible to other processes via `ps`. If you
ever expose a key (committing it, pasting in chat, etc.), rotate it
immediately at the dev portal.

## Usage

```bash
./pkmn sample_cards.txt                      # one file
./pkmn list-a.txt list-b.txt                 # multiple files
./pkmn input/                                # a directory of *.txt files
./pkmn input/ extras.txt                     # mix of dirs + files
uv run pkmn input/ -o output/cards.xlsx --pdf output/binder.pdf
python -m mgz_pkmn input/
```

Each input file's stem becomes a "Source" tag — every row in the spreadsheet
records its source list, and the PDF binder starts a new section (with a
banner showing the tag + card count) at each file boundary.

### Options

| Flag | Default | Purpose |
|---|---|---|
| `INPUTS...` | (required) | One or more text files **and / or directories** of `.txt` files. |
| `-o, --output PATH` | `cards.xlsx` | Spreadsheet output path. |
| `--images-dir PATH` | `output/images/` | Where to save downloaded card images. |
| `--api-key TEXT` | `$POKEMONTCG_IO_API_KEY` | pokemontcg.io API key (raises rate limits). |
| `--no-images` | off | Skip image downloads + embedding. |
| `--max-price FLOAT` | (none) | Per-card budget cap. **Bulk** `top:N` / `All …` lookups respect it strictly — candidates above the cap are excluded *before* the top-N cut, so an "affordable top 10" still returns 10. **Single-card** lookups always appear in every artifact even when above the cap, but get a visual flag (amber-fill on the Market cell in xlsx, red `! MP $X` line in the PDF, `over_max_price: true` in JSON). Applied to the raw market figure regardless of currency — keep your input list single-currency for it to mean what you'd expect. |
| `--dedupe` | off | Remove duplicate matched cards across all queries (keyed by card id), keeping the first occurrence in xlsx / PDF / JSON. |
| `--report-json PATH` | (none) | Also dump a structured JSON report. |
| `--pdf PATH` | (none) | Also write a 3×3 binder-style PDF for vendor scanning. |
| `--no-cache` | off | Skip the disk cache; force every lookup to hit the network. |
| `-v, --verbose` | off | Echo each API request URL (cached entries are flagged). |
| `-h, --help` | | Show usage. |

### Examples

```bash
./pkmn cards.txt
./pkmn cards.txt --no-images -o quick.xlsx
POKEMONTCG_IO_API_KEY=xxx ./pkmn cards.txt -v
./pkmn cards.txt -o show.xlsx --report-json show.json
./pkmn cards.txt -o show.xlsx --pdf binder.pdf       # spreadsheet + PDF binder
./pkmn cards.txt --max-price 50 --pdf binder.pdf     # only show cards ≤ $50
```

### Sample run

The wishlists I actually used at the show, plus a sample full-pipeline run:

```bash
./pkmn input/ \
  -o output/cards.xlsx \
  --pdf output/binder.pdf \
  --report-json output/summary.json \
  --max-price 100
```

`input/` and `output/` in this repo are the **real files** from that run — input
lists per source (`151-cards.txt`, `surging-sparks-cards.txt`, etc.) and the
generated spreadsheet, binder PDF, JSON summary, and downloaded card art.

## Web UI

A browser interface lives alongside the CLI: a FastAPI backend in [api/](api/)
and a React + Vite SPA in [web/](web/). Both share the parser, lookup, and
export pipeline used by the CLI — no logic is duplicated.

What you get over the CLI:

- live results table — rows stream in via SSE as each lookup resolves
- inline parse-preview as you type a card line
- one-click `.xlsx` / PDF download
- persisted settings (API key, max-price cap, dedupe, source tag) in `localStorage`
- inline "Add PriceCharting URL" action for unmatched rows that records a
  sticky override and re-runs that line

Run both processes (two terminals):

```bash
# Terminal 1 — API (from repo root)
uv sync --extra api
uv run uvicorn api.main:app --reload --port 8000

# Terminal 2 — frontend
cd web
npm install
npm run dev
```

`--extra api` pulls in `fastapi` + `uvicorn`, which aren't part of the
default CLI install — they're an opt-in extra so plain `pip install mgz-pkmn`
stays lightweight.

Then open <http://localhost:5173>. The Vite dev server proxies `/api/*` to
the FastAPI server on `:8000`. Swagger UI is at <http://localhost:8000/docs>.

For deeper docs (endpoint reference, troubleshooting, architecture), see
[api/README.md](api/README.md) and [web/README.md](web/README.md).

## Input format

One card per line. Blank lines and `#` comments are ignored. The parser is
intentionally loose — leading list markers are stripped, a card-number token is
detected if present (`4/102`, `SWSH286`, `SV20/SV94`, …), and the rest is
treated as `name [- set]`.

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

# Bulk "top-N chase cards" — one input line expands to multiple rows
All Exeggutor cards                # → 5 highest-priced Exeggutor variants
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

A bulk line is detected by the explicit `top:N` / `top N` prefix, or by the
phrase `All <subject> (cards|prints|versions)` (the suffix is required to
avoid stomping on real card names like *All Energy Removal*). Lines that
contain `|` or ` - ` are always treated as structured single-card lookups,
so `All Charizard | Base | 4/102` is *not* bulk.

Number is **optional** — if you don't know it, just provide name and set:

```text
- [ ] Mewtwo - Hidden Fates
Charizard | Base
```

Recognised variants for `[…]`: `normal`, `holofoil`, `reverseHolofoil`,
`1stEditionHolofoil`, `unlimitedHolofoil`, `1stEdition`, `unlimited`. If you
omit it, the highest-priority variant with a market price is used.

## Sources & coverage

### pokemontcg.io (default)

Searched first for every line. Best for English / international English
releases. Prices in USD (TCGPlayer) with EUR (Cardmarket) fallback. ~1000
requests/day without a key (30/min); free key at
<https://dev.pokemontcg.io> raises that to 20k/day.

### TCGdex (automatic fallback)

Engaged automatically when pokemontcg.io has no match. The tool detects
language hints in your input (`Chinese`, `Japanese`, `Korean`, …) and queries
the matching TCGdex locale, then falls back to TCGdex `en`. Useful for some
Japanese promos and a subset of regional Chinese / Korean releases.

### PriceCharting URL (manual override)

When neither database has a card — typically the Chinese **Gem Pack** /
**寶石包** lineup, certain Japanese collector products, etc. — paste the
PriceCharting product URL onto the line. The scraper extracts:

- Image (`og:image`)
- "Loose" / used price (USD) → used as the market price for comps
- "New" and "Graded" prices retained internally

Why opt-in (URL) rather than auto-search? PriceCharting's search is
ambiguous for similarly-named cards across regional variants; the URL
guarantees you've picked the right product page.

### Failure messages

When pokemontcg.io and TCGdex both have hits for the name but none in your
hinted set, you get:

```text
- card name has hits but none in set 'Gem Pack Vol 3' (set may not be indexed
  by pokemontcg.io or TCGdex — try adding a PriceCharting URL on the line)
```

The row is still written so you can fill it in manually.

Region / rarity descriptors (`Chinese`, `Japanese`, `SIR`, `SAR`, `FA`, …)
are stripped from the database query but kept in the **Input** column
verbatim.

## Bulk "top-N" lookups

`All <subject> cards` and `top:N <subject>` ask the tool for the most
expensive variants of a subject. The subject can be:

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
- **A card subtype** (`top 4 tag team cards`, `top 4 vmax cards`) — when the
  subject exactly matches a known subtype keyword it's routed to a
  `subtypes:…` filter instead of a name search. Recognised: `tag team`, `v`,
  `vmax`, `vstar`, `v-union`, `gx`, `ex`, `mega`, `break`, `ultra beast`,
  `radiant`.
- **An evolution line** (`top 4 Charmander/Charmeleon/Charizard cards`) —
  slash-separated names are searched independently and the pools are unioned
  before ranking, so "top 4" returns the four highest-priced cards across
  the whole line.
- **A concept keyword** (`top 9 puppy cards`, `top 9 starter evolution cards`)
  — subjective subjects that don't map to a single name, set, or subtype.
  Each is hand-curated to a Pokemon name list, then handled exactly like an
  evolution line. Recognised: `puppy`, `dog`, `kitty`, `cat`, `starter`,
  `starter evolution`, `eeveelution`, `pseudo-legendary`, `baby`. Concept
  queries skip the set/flavorText fallback so a no-hit result returns
  empty rather than overshooting (e.g. `starter evolution` previously
  matched the unrelated "Mega Evolution" set).

The flow in all cases:

1. Subject is a subtype keyword → `subtypes:…` query (other paths skipped).
2. Otherwise: name search (per-name for evolution lines) → set fallback →
   flavorText fallback. Name results are word-boundary filtered, so
   `top 4 Mew` no longer pulls in Mewtwo from prefix-wildcard matches.
3. Drop candidates without a TCGPlayer / Cardmarket market price (they
   can't be ranked meaningfully — usually too new or never indexed).
4. Sort descending by market price, keep the top *N*.

Each surviving card becomes its own row in the spreadsheet and its own
cell in the PDF binder.

## PDF binder output

Pass `--pdf binder.pdf` to also produce a 3×3 binder-style PDF (US Letter
portrait). Each cell shows eight caption lines below a smaller card image:

1. **Name** (bold)
2. `(#X/Y)` — card number / set printed total
3. **Set name**
4. **`MP $X.XX`** (highlighted) — explicit market-price label so the figure is unambiguous
5. `80% $A` — comp tier 1
6. `85% $B` — comp tier 2
7. `90% $C` — comp tier 3
8. `95% $D` — comp tier 4

Pages break every 9 cards. When the input came from multiple files (or a
directory), each file gets its **own section**, separated by a slate
"Source: <tag>" banner and a forced page break. That way a vendor flipping
through the binder can immediately see which cards belong to which list.

Images are downsampled to ~200 DPI on the way in (Pillow JPEG, quality 85)
so the PDF stays small even for 60+ cards.

The PDF is meant for vendor recognition at a card show — pair it with the
xlsx (the spreadsheet has the full price/comp data and clickable listing
links).

## Output

| Column | Notes |
|---|---|
| Image | Embedded 96 × 134 thumbnail. |
| **Source** | The input file's stem — groups rows by which list they came from. |
| Input | Your original line. |
| Name / Set / Series / Number / Rarity | From the matched card. |
| Variant | Which price tier was used (`holofoil`, `loose`, …). |
| Database | `pokemontcg.io`, `tcgdex (zh-tw)`, `pricecharting`, … |
| Market | Currency-aware (`$` / `€`). |
| 80% / 85% / 90% / 95% | Comps for negotiating at the table. |
| Price Source | `tcgplayer`, `cardmarket`, or `pricecharting`. |
| Listing URL | Hyperlink to the live listing. |

A totals row at the bottom sums each price column. **Note:** the totals row
ignores currency, so a mixed USD + EUR run yields an arithmetic-but-not-
meaningful total — consult the **Database** column if a number looks off.

Full-resolution PNGs land in `output/images/` by default (named after the
matched card id).

### JSON report (`--report-json`)

Pass `--report-json output/summary.json` to get a structured digest alongside
the spreadsheet. Top-level keys:

| Key | Contents |
|---|---|
| `generated_at`, `version`, `elapsed_seconds` | Run metadata. |
| `summary` | Counts (rows / matched / missed / priced / bulk-expanded), `totals_by_currency` (sum of market + each comp tier), `stats_by_currency` (avg / median / min / max), and frequency tables for `by_database`, `by_price_source`, `by_rarity`. |
| `tags` | Same shape as `summary` but per input file (per "Source" tag), plus the `highest_value_card` in that section. |
| `highlights.most_valuable` | Top 5 priced cards across the whole run. |
| `highlights.missing` | Every unmatched line + its tag, so you can iterate the input. |
| `rows` | The full per-row payload (input, matched card, pricing, comps, image path). |

Mixed USD + EUR runs keep currencies separate in `totals_by_currency` and
`stats_by_currency`. The headline `highest_value_card` per tag picks by raw
market figure regardless of currency — fine when a tag is single-currency,
worth a glance otherwise.

## Cache

The CLI keeps a small disk cache under `$XDG_CACHE_HOME/mgz-pkmn`
(`~/.cache/mgz-pkmn` by default) so consecutive runs over the same card list
don't keep re-spending API quota. Two stores live there:

| Path | What it holds | TTL |
|---|---|---|
| `api/<sha1>.json` | One file per pokemontcg.io request URL. | 7 days (mtime-based). |
| `url_overrides.json` | `(name, set_hint)` → PriceCharting URL, recorded whenever you paste a PC URL on a line. | None — sticky until you overwrite or delete. |

Behavior:

- **API responses** are cached after every successful HTTP 200 (including
  empty result lists) and consulted before each network fetch. A cold run
  (~30 s for the sample input) becomes ~1 s on a warm cache. With `-v` the
  log shows `cached <url>` for hits and `GET <url>` for misses.
- **URL overrides** turn one-shot manual lookups into permanent ones. Paste
  a PriceCharting URL on a line once; on the next run, drop the URL and
  the card still resolves via PriceCharting (matched on `(name, set)`,
  case-insensitive). Lookups happen between the explicit-URL path and the
  pokemontcg.io path so a saved override behaves exactly like a re-pasted
  URL would.
- **`--no-cache`** disables both stores for the run (sets
  `MGZ_PKMN_NO_CACHE=1` internally). Use it when you suspect a stale entry
  is masking a fix or when checking for cards added since the cache was
  warmed.
- **Clearing the cache** is a manual `rm -rf ~/.cache/mgz-pkmn` — there's
  no LRU eviction. The cache is small (a few MB after a typical run).

## Known limitations / TODO

Things that work well enough for personal use but are rough edges worth
fixing if this turns into something more:

- **Inline price filtering is approximate.** The comparator parser handles
  `>=`, `<=`, `>`, `<` correctly and intersects with `--max-price`, but
  it's currency-blind, treats `>` like `>=`, and silently drops conditions
  on single-card lookups. A line like `Charizard | Base | 4 >= $100` parses
  the bound but doesn't act on it. Acceptable for bulk budgeting; not a
  general-purpose query language.
- **No structural / vague-term search.** Phrases like `evolution line of
  Eevee`, `SIRs only`, `V, Vmax, EX, or GX cards`, or `modern <subject>`
  fall through the name → set-name → flavorText fallback chain — they
  *might* hit something via flavorText, but there's no real understanding
  of subtypes (`subtypes:V`, `subtypes:VMAX`), card families, or "modern"
  as a recency filter. Adding a structured `top:N subtype:V,VMAX in Surging
  Sparks` syntax (or even plain English with a small DSL on top of
  pokemontcg.io's `subtypes:` field) is the next big win.

## Contributing

Project layout, dev workflow, pre-commit hooks, CI, and release process live in
[CONTRIBUTORS.md](CONTRIBUTORS.md).

## Notes

- Set-name matching boosts exact matches so `Base` resolves to the original
  Base Set rather than Base Set 2. For ambiguous sets, prefer the canonical
  pipe form (`Name | Set | Number`).
- "Secret rare" cards are often numbered higher than the printed set total
  (e.g. Champion's Path Charizard V is `79/73`). Use the database number
  when in doubt.
- TCGdex Cardmarket prices are EUR; the spreadsheet formats those cells
  with `€`. Comps are still computed at 80/85/90/95% of that figure.
