# ADR 0006: A single `Row` shape feeds every output writer

- **Status:** Accepted
- **Date:** 2026-05-09
- **Tags:** data-model, outputs

## Context

A run produces five distinct artifacts:

- A spreadsheet (`cards.xlsx`) with embedded thumbnails and per-card
  comp tiers.
- A 3×3 binder PDF and a 6×4 condensed binder PDF.
- A printable per-tag checklist PDF.
- A structured JSON report.

Each artifact has its own writer (`spreadsheet.py`, `binder.py`,
`checklist.py`, `report.py`). Earlier iterations had each writer pull
from the lookup pipeline directly — that turned out to be a bad shape:
small differences in field handling drifted between writers (one used
`card.get("rarity") or "—"`, another used `card.get("rarity")`, …),
and tests for any given writer needed the full lookup machinery.

## Decision

The pipeline produces `list[Row]` exactly once, and every writer
consumes that list. `Row` is a dataclass in
[`src/mgz_pkmn/spreadsheet.py`](../../src/mgz_pkmn/spreadsheet.py):

```python
@dataclass
class Row:
    query: CardQuery
    card: dict[str, Any] | None
    pricing: Pricing
    image_path: Path | None = None
    tag: str = ""
```

- `query` is the parsed input line.
- `card` is the matched card payload (or `None` for unmatched lines).
- `pricing` is the extracted market price + currency + variant + url.
- `image_path` is local-disk only; writers can pretend it's optional.
- `tag` is the originating input file's stem.

Sorting (`sort_rows` in [`sorting.py`](../../src/mgz_pkmn/sorting.py))
operates on the same list, in place, before writers run. Each writer
gets the rows in their final order.

The JSON report builder (`build_json_report`) is a pure function of the
list — no I/O. The CLI handles serialization and writing.

## Consequences

- Writers stay narrow. `write_binder_pdf(rows, …)` does not need to
  know about lookup, sorting, or pricing extraction — it gets a list
  of `Row` and renders.
- The same `--sort` value uniformly affects every artifact. There's no
  per-writer sort divergence because there's no per-writer sort.
- Tests for each writer assemble fixture `Row` objects directly. No
  network, no API mocks, no lookup machinery. The checklist tests
  build five `Row` instances with hand-rolled card dicts; that's the
  whole setup.
- `Row.card` is intentionally a dict, not another dataclass. The
  underlying card shape is whatever pokemontcg.io / TCGdex /
  PriceCharting returned, normalized lightly. Adding a field to the
  card payload doesn't require touching `Row`.
- The web API reconstructs `Row` from JSON in
  [`api/routes/export.py`](../../api/routes/export.py) so the same
  writers serve browser exports too.

## Alternatives considered

- **Per-writer custom shapes.** What earlier iterations had. Drift
  between writers is the killer; even careful authors will reach for
  slightly different field-access patterns when handed the raw card
  payload.
- **Flat dict instead of `Row` dataclass.** Marginally less ceremony,
  significantly worse type errors when a writer reaches for a field
  that doesn't exist. The dataclass also makes it obvious where
  optionality is allowed (`image_path`, `card`).
- **One writer-of-everything.** A single function that emits all
  artifacts. Couples writers that don't otherwise need to change
  together; the current shape lets the binder PDF stay 5× the size of
  the checklist code without bleeding complexity into each other.
