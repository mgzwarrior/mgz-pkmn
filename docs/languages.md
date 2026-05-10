# Languages

Every matched card is tagged with a language code (e.g. `en`, `ja`,
`zh-cn`, `ko`, `fr`).

## How detection works

The code is detected three ways, in order:

1. **From the card payload** — pokemontcg.io occasionally returns
   localized names (the Japanese Exeggutor `ナッシー[Exeggutor]`, etc.);
   the tool reads the script of the name (kana → `ja`, hangul → `ko`,
   kanji-only → `zh-cn`).
2. **From a PriceCharting URL slug** — `pokemon-chinese-gem-pack-3/...`
   tags the card as `zh-cn`; same for `japanese`, `korean`, etc.
3. **From the TCGdex locale that returned the card** — `tcgdex (ja)`
   matches always come back as `ja`, etc.

## Influencing detection

- **Per line** — write a language adjective in the input: `Cubone Chinese
  SIR — <PriceCharting URL>` or `Charizard japanese | VSTAR Universe`.
  Recognised: `chinese`, `japanese`, `korean`, `german`, `french`,
  `spanish`, `italian`, `portuguese`, `thai`, `indonesian`, `polish`,
  `dutch`. The keyword is stripped from the database query but routes
  TCGdex fallback to that locale.
- **Globally** — pass `--lang ja` (CLI) or `settings.lang = "ja"` (API).
  Applied as a fallback only — per-line keywords still win.

## Where languages show up

- **Spreadsheet** — the **Database** column carries the locale (e.g.
  `tcgdex (ja)`).
- **PDF binder** — non-English cards get a full-width **dark-red banner
  above the card image** with the human-readable language name
  (`JAPANESE`, `CHINESE`, `KOREAN`, `FRENCH`, …) so vendors spot them
  at a glance. Names that include CJK characters (Japanese, Chinese,
  Korean) render with ReportLab's built-in CID fonts, so cards like
  `ナッシー[Exeggutor]` display correctly instead of as tofu blocks.
- **JSON report** — every row has a `"language"` field, and the summary
  block contains a `by_language` tally.
- **CLI summary line** — `⚑ N non-English` shown alongside
  matched/missed counts when any non-English cards are in the run.

## Currency note

TCGdex Cardmarket prices are EUR; the spreadsheet formats those cells
with `€`. Comps are still computed at 80/85/90/95% of that figure.
