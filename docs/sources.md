# Sources & coverage

The tool layers three open data sources. Each line is tried against them
in order; the first source that produces a usable match wins.

[pokemontcg.io]: https://pokemontcg.io
[TCGdex]: https://tcgdex.dev
[PriceCharting]: https://www.pricecharting.com

## pokemontcg.io (default)

Searched first for every line. Best for English / international English
releases. Prices in USD (TCGPlayer) with EUR (Cardmarket) fallback. ~1000
requests/day without a key (30/min); free key at <https://dev.pokemontcg.io>
raises that to 20k/day.

## TCGdex (automatic fallback)

Engaged automatically when [pokemontcg.io] has no match. The tool detects
language hints in your input (`Chinese`, `Japanese`, `Korean`, …) and
queries the matching [TCGdex] locale, then falls back to TCGdex `en`.
Useful for some Japanese promos and a subset of regional Chinese / Korean
releases. See [Languages](languages.md) for how detection chains work.

## PriceCharting URL (manual override)

When neither database has a card — typically the Chinese **Gem Pack** /
**寶石包** lineup, certain Japanese collector products, etc. — paste the
[PriceCharting] product URL onto the line. The scraper extracts:

- Image (`og:image`)
- "Loose" / used price (USD) → used as the market price for comps
- "New" and "Graded" prices retained internally

Why opt-in (URL) rather than auto-search? PriceCharting's search is
ambiguous for similarly-named cards across regional variants; the URL
guarantees you've picked the right product page.

## Failure messages

When pokemontcg.io and TCGdex both have hits for the name but none in
your hinted set, you get:

```text
- card name has hits but none in set 'Gem Pack Vol 3' (set may not be indexed
  by pokemontcg.io or TCGdex — try adding a PriceCharting URL on the line)
```

The row is still written so you can fill it in manually.

Region / rarity descriptors (`Chinese`, `Japanese`, `SIR`, `SAR`, `FA`,
…) are stripped from the database query but kept in the **Input** column
verbatim.
