# Outputs

Reference for the data artifacts a run produces. The PDF binder and
checklist live in their own pages — see [PDF binder](binder-pdf.md) and
[Checklist PDF](checklist.md).

## Spreadsheet (`-o cards.xlsx`)

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

A totals row at the bottom sums each price column. **Note:** the totals
row ignores currency, so a mixed USD + EUR run yields an
arithmetic-but-not-meaningful total — consult the **Database** column if
a number looks off.

Full-resolution PNGs land in `output/images/` by default (named after
the matched card id).

## JSON report (`--report-json`)

Pass `--report-json output/summary.json` to get a structured digest
alongside the spreadsheet.

| Key | Contents |
|---|---|
| `generated_at`, `version`, `elapsed_seconds` | Run metadata. |
| `summary` | Counts (rows / matched / missed / priced / bulk-expanded), `totals_by_currency` (sum of market + each comp tier), `stats_by_currency` (avg / median / min / max), and frequency tables for `by_database`, `by_price_source`, `by_rarity`. |
| `tags` | Same shape as `summary` but per input file (per "Source" tag), plus the `highest_value_card` in that section. |
| `highlights.most_valuable` | Top 5 priced cards across the whole run. |
| `highlights.missing` | Every unmatched line + its tag, so you can iterate the input. |
| `rows` | The full per-row payload (input, matched card, pricing, comps, image path). |

Mixed USD + EUR runs keep currencies separate in `totals_by_currency`
and `stats_by_currency`. The headline `highest_value_card` per tag
picks by raw market figure regardless of currency — fine when a tag is
single-currency, worth a glance otherwise.

The report builder lives in [`src/mgz_pkmn/report.py`](../src/mgz_pkmn/report.py)
as a pure function (`build_json_report`) so you can call it directly
from your own code if you want a different output shape.
