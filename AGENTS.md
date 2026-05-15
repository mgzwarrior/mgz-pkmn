# Agent Guidance for mgz-pkmn

This file documents the conventions, invariants, and workflow that AI coding
agents (Claude Code, GitHub Copilot, Cursor, etc.) must follow when working
on this repo.

For the human contributor workflow (issue selection, branching, PR process),
see [docs/contributing.md](docs/contributing.md).

---

## Architecture overview

```
src/mgz_pkmn/
├── cli.py             # Click entry point — orchestrates the pipeline, writes outputs
├── parser.py          # parse_line → CardQuery (pure, no I/O)
├── lookup.py          # find_card / find_top_cards — hits external APIs
├── pricing.py         # extract_pricing → Pricing (pure)
├── sorting.py         # sort_rows → list[Row] (pure)
├── report.py          # build_json_report → dict (pure, no I/O)
├── spreadsheet.py     # write_spreadsheet — the only xlsx writer; owns Row + HEADERS
├── binder.py          # write_binder_pdf (pure layout logic, then PDF I/O)
├── checklist.py       # write_checklist_pdf
├── images.py          # download_image, make_thumbnail (I/O)
├── cache.py           # DiskCache — filesystem persistence
└── sources/
    ├── base.py        # MatchResult, score_card, set_overlap, name_clause (pure)
    ├── pokemontcg.py  # TCGClient + search_pokemontcg
    ├── tcgdex.py      # TCGDexClient + search_tcgdex
    └── pricecharting.py  # URL-based scraper for region-exclusive cards
```

---

## Core invariants

### 1. Dataclass-driven data shapes

Every data structure that crosses module boundaries is a `@dataclass`:

- `CardQuery` (`parser.py`) — structured form of a parsed input line
- `Pricing` (`pricing.py`) — market price, comps, currency, source, URL
- `MatchResult` (`sources/base.py`) — card dict + reason string from a source
- `Row` (`spreadsheet.py`) — the single carrier that flows through the whole
  pipeline from lookup → sorting → all output writers

Never replace these with plain dicts or tuples at module boundaries. If you
need a new field, add it to the relevant dataclass (with a default so existing
call sites don't break).

### 2. Single `Row` shape

`spreadsheet.Row` is the canonical pipeline unit. Every output writer
(`write_spreadsheet`, `write_binder_pdf`, `write_checklist_pdf`,
`build_json_report`) takes `list[Row]`. Do not invent parallel data structures
— extend `Row` if you need to carry more state.

### 3. Pure-function writers

Business logic lives in pure functions; I/O lives at the edges:

- `parser.parse_line` — no I/O; returns `CardQuery | None`
- `pricing.extract_pricing` — no I/O; returns `Pricing`
- `sorting.sort_rows` — no I/O; returns a new list
- `report.build_json_report` — no I/O; returns a plain dict

The CLI (`cli.py`) is the only place that wires these together and performs
disk/network I/O. Keep it that way: if you find yourself adding `open()` or
`requests.get()` inside a pure module, stop and push it to the caller.

### 4. Adding a new lookup source

Drop a module under `sources/` that returns the normalized card shape (see
existing sources for the expected dict keys), then register it in
`lookup.find_card`. Do not touch `spreadsheet.py` or `cli.py` for this.

---

## Testing

- Write tests **before** changing behavior, not after.
- Tests live in `tests/`. Mirror the source layout: `tests/test_parser.py`
  covers `src/mgz_pkmn/parser.py`, etc.
- Pure functions are cheap to test — assemble a fixture, assert on the output,
  no mocking needed.
- I/O-heavy code (sources, images, cache) should be tested with real fixtures
  or lightweight stubs, not deep mock chains.
- Run the full suite before opening a PR:

```bash
make check
```

---

## Commit and branch conventions

- Branch names: `<issueNumber>-<short-description>` (e.g. `42-fix-pricing-scraper`).
- Commits must be signed (`git commit -S`).
- Every PR body must include a closing keyword (`Closes #N`) so GitHub
  auto-links and auto-closes the issue.
- One issue per PR — keep changes focused.

---

## Doc cross-link conventions

When adding or changing a public-facing behaviour:

1. Update the relevant section in [README.md](README.md).
2. If you add a new `make` target or dev command, add it to the table in
   [docs/contributing.md](docs/contributing.md).
3. Cross-link from both directions: if `docs/contributing.md` describes
   something, link back to it from the module docstring if the connection is
   non-obvious.

---

## What to avoid

- Do not introduce new runtime dependencies without strong justification and a
  `pyproject.toml` entry.
- Do not add I/O inside pure modules.
- Do not add print statements inside library code; use `logging` or surface
  errors through return values.
- Do not bypass pre-commit hooks (`--no-verify`).
