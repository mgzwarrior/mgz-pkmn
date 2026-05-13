# PDF binder

Two layouts, same data.

## Standard binder (`--pdf`)

Pass `--pdf binder.pdf` to also produce a 3×3 binder-style PDF (US
Letter portrait). Each cell shows eight caption lines below a smaller
card image:

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
"Source: <tag>" banner and a forced page break. That way a vendor
flipping through the binder can immediately see which cards belong to
which list.

Images are downsampled to ~200 DPI on the way in (Pillow JPEG, quality
85) so the PDF stays small even for 60+ cards.

The PDF is meant for vendor recognition at a card show — pair it with
the xlsx (the spreadsheet has the full price/comp data and clickable
listing links).

## Condensed binder (`--condensed-pdf`)

Pass `--condensed-pdf preview.pdf` (alongside or instead of `--pdf`) for
a denser version of the same layout — **6×4 grid, 24 cards per page,
all eight caption lines preserved.** The standard 3×3 stays exactly as
today, sized so cells print and slip into binder pockets as placeholder
cards. The condensed version is for visual scanning when you don't need
print-ready cells: at-a-glance prices, names, and rarity across a wider
page sweep.

Both can be produced in one run:

```bash
./pkmn input/ \
  --pdf output/binder.pdf \
  --condensed-pdf output/binder-condensed.pdf
```

## Customizing the layout

The two presets live in [`src/mgz_pkmn/binder.py`](../src/mgz_pkmn/binder.py)
as `STANDARD_LAYOUT` and `CONDENSED_LAYOUT` instances of the
`BinderLayout` dataclass. Add a third preset by instantiating another
one — every drawing function reads its constants from the layout
object, so adding a new size is a single dataclass call away.

## Set identification cards (`pkmn set-cards`)

`pkmn set-cards` is a **standalone subcommand** — it takes no positional
arguments and is unrelated to the lookup/checklist flow above. It fetches
every Pokémon TCG set from pokemontcg.io and emits one card-sized cutout
per set, laid out **3×3 on Letter** so a printed page slots straight into
a 9-pocket binder sheet. Cut out the set you want and drop it into the
first pocket of that section.

Each cutout shows:

- The **set logo** (when the set's API payload provides one)
- **Set name** and **series**
- **Release year**
- **N cards** — the set's printed total
- The **generation date** in small print at the bottom

```bash
./pkmn set-cards                                 # → ./set-cards.pdf
./pkmn set-cards -o output/set-cards.pdf         # custom path
./pkmn set-cards --no-images                     # skip logo downloads
POKEMONTCG_IO_API_KEY=xxx ./pkmn set-cards       # authenticated upstream
```

Set logos are downloaded into `output/images/set-logos/` (configurable
with `--logos-dir`) and reused on subsequent runs.

In the web UI, the **Set ID cards** button in the header downloads the
same PDF on demand. The button is always enabled — it doesn't depend on
the card list in the editor.

## Non-English cards

Non-English cards get a full-width dark-red banner above the card image
with the human-readable language name. See
[Languages](languages.md#where-languages-show-up) for the details.
