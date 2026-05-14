# CLI reference

`pkmn` is a Click group exposing three subcommands:

- **`pkmn lookup INPUTS...`** — the original card-lookup pipeline (xlsx,
  binder PDFs, checklist, JSON report). Documented below.
- **`pkmn set-cards`** — generate printable set identification cutouts
  for binder section dividers; takes no positional arguments. See
  [PDF binder → Set identification cards](binder-pdf.md#set-identification-cards-pkmn-set-cards).
- **`pkmn cache stats`** — print on-disk cache health (total size,
  oldest API entry, URL-override count). See
  [Cache → Inspecting the cache](cache.md#inspecting-the-cache).

For backward compatibility, **invoking `pkmn` with input paths and no
subcommand is forwarded to `lookup`** — `./pkmn cards.txt` and
`./pkmn lookup cards.txt` are equivalent.

## Invocation patterns

```bash
./pkmn sample_cards.txt                      # one file (forwards to lookup)
./pkmn lookup list-a.txt list-b.txt          # explicit, multiple files
./pkmn lookup input/                         # a directory of *.txt files
./pkmn lookup input/ extras.txt              # mix of dirs + files
./pkmn set-cards                             # all-sets cutout PDF, no args
uv run pkmn lookup input/ -o output/cards.xlsx --pdf output/binder.pdf
python -m mgz_pkmn lookup input/
```

Each input file's stem becomes a **Source tag** — every row in the
spreadsheet records its source list, and the PDF binder starts a new
section (with a banner showing the tag + card count) at each file
boundary.

## `pkmn lookup` options

| Flag | Default | Purpose |
|---|---|---|
| `INPUTS...` | (required) | One or more text files **and / or directories** of `.txt` files. |
| `-o, --output PATH` | `cards.xlsx` | Spreadsheet output path. |
| `--images-dir PATH` | `output/images/` | Where to save downloaded card images. |
| `--api-key TEXT` | `$POKEMONTCG_IO_API_KEY` | pokemontcg.io API key (raises rate limits). |
| `--no-images` | off | Skip image downloads + embedding. |
| `--max-price FLOAT` | (none) | Per-card budget cap. **Bulk** `top:N` / `All …` lookups respect it strictly — candidates above the cap are excluded *before* the top-N cut, so an "affordable top 10" still returns 10. **Single-card** lookups always appear in every artifact even when above the cap, but get a visual flag (amber-fill on the Market cell in xlsx, red `! MP $X` line in the PDF, `over_max_price: true` in JSON). Applied to the raw market figure regardless of currency — keep your input list single-currency for it to mean what you'd expect. |
| `--dedupe` | off | Remove duplicate matched cards across all queries (keyed by card id), keeping the first occurrence in xlsx / PDF / JSON. |
| `--report-json PATH` | (none) | Also dump a structured JSON report. See [Outputs](outputs.md#json-report). |
| `--pdf PATH` | (none) | Also write a 3×3 binder-style PDF (9 cards/page) — image-forward, sized to print and slip into 9-pocket pages as physical placeholders. See [PDF binder](binder-pdf.md). |
| `--condensed-pdf PATH` | (none) | Also write a denser binder PDF (6×4 grid, 24 cards/page) with the same caption block as `--pdf`. See [PDF binder](binder-pdf.md#condensed-binder). |
| `--checklist PATH` | (none) | Also write a printable checklist PDF (one section per input file). See [Checklist PDF](checklist.md). |
| `--no-cache` | off | Skip the disk cache; force every lookup to hit the network and don't write back. Equivalent to exporting `MGZ_PKMN_NO_CACHE=1` for non-CLI callers (FastAPI service, library use). See [Cache → Environment variables](cache.md#environment-variables). |
| `--clear-cache` | off | Wipe the API response cache before the run, then continue normally so fresh data is re-cached. URL overrides preserved. |
| `--lang CODE` | (none) | Default TCGdex language for lines that don't name one. Per-line keywords (`japanese`, `chinese`, …) still take priority. See [Languages](languages.md). |
| `--sort MODE` | `number` | Row order applied to xlsx, binder, and checklist. Tag is always the outermost group; this changes order WITHIN each tag. Choices: `number` (group by set then card # asc — default), `number-desc`, `price-asc`, `price-desc`, `release-date` (chronological by set release date), `alpha` (by card name). |
| `-v, --verbose` | off | Echo each API request URL (cached entries are flagged). |
| `-h, --help` | | Show usage. |

## `pkmn set-cards` options

| Flag | Default | Purpose |
|---|---|---|
| `-o, --output PATH` | `set-cards.pdf` | PDF output path. |
| `--api-key TEXT` | `$POKEMONTCG_IO_API_KEY` | pokemontcg.io API key. |
| `--logos-dir PATH` | `output/images/set-logos/` | Where to cache downloaded set logos. |
| `--no-images` | off | Skip logo downloads and render text-only cutouts. |
| `-v, --verbose` | off | Echo each API request URL. |
| `-h, --help` | | Show usage. |

## `pkmn cache stats` options

Takes no flags beyond `-h, --help`. Reports on-disk state directly, so
it runs even when `MGZ_PKMN_NO_CACHE=1` is set. See
[Cache → Inspecting the cache](cache.md#inspecting-the-cache).

## Examples

```bash
./pkmn cards.txt                                     # forwards to lookup
./pkmn lookup cards.txt --no-images -o quick.xlsx
POKEMONTCG_IO_API_KEY=xxx ./pkmn lookup cards.txt -v
./pkmn lookup cards.txt -o show.xlsx --report-json show.json
./pkmn lookup cards.txt -o show.xlsx --pdf binder.pdf       # spreadsheet + PDF binder
./pkmn lookup cards.txt --max-price 50 --pdf binder.pdf     # only show cards ≤ $50
./pkmn lookup input/ --pdf binder.pdf --checklist checklist.pdf
./pkmn set-cards                                            # all-sets ID cutouts
./pkmn set-cards -o output/set-cards.pdf
./pkmn cache stats                                          # disk cache health snapshot
```

## Worked examples

[`input/`](../input/) ships three small, self-contained example lists that
together cover every input syntax and lookup mode the tool supports:

| File | What it shows |
|---|---|
| [`example-set-checklist.txt`](../input/example-set-checklist.txt) | `All <set> cards` — full-set bulk lookup, ~250 priced rows, drives a multi-page checklist + binder. |
| [`example-evolution-line.txt`](../input/example-evolution-line.txt) | Slash-separated evolution lines and curated concept keywords (`eeveelution`, `puppy`, …). |
| [`example-format-survey.txt`](../input/example-format-survey.txt) | Pipe / dash / markdown-task input forms, variant hints, subtype + inline price filters. |

Run all three at once and produce every artifact:

```bash
./pkmn lookup input/ --no-images \
  -o output/cards.xlsx \
  --pdf output/binder.pdf \
  --condensed-pdf output/binder-condensed.pdf \
  --checklist output/checklist.pdf \
  --report-json output/summary.json
```

The tracked files in [`output/`](../output/) were generated by exactly that
command (with `--no-images` so the PDFs stay small for source control).
Drop the flag to embed card thumbnails — the binder PDF balloons to ~25 MB
at full art for this size of run, but the visual layout is identical.
