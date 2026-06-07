# Copilot instructions for `mgz-pkmn`

## What this repository is
- Python CLI that parses card wishlist text files and produces:
  - Excel spreadsheet with embedded card thumbnails/pricing
  - Optional PDF binder
  - Optional JSON summary report
- Main package: `src/mgz_pkmn`
- Entry points:
  - `pkmn` script (via `pyproject.toml`)
  - `python -m mgz_pkmn`
  - repo wrapper script `./pkmn` (delegates to `uv run pkmn`)

## Key code locations
- `src/mgz_pkmn/cli.py`: CLI orchestration and output writing
- `src/mgz_pkmn/parser.py`: input line parsing and query shaping
- `src/mgz_pkmn/lookup.py`: lookup flow across sources
- `src/mgz_pkmn/pricing.py`: price extraction and comp calculations
- `src/mgz_pkmn/spreadsheet.py`: `.xlsx` output
- `src/mgz_pkmn/binder.py`: PDF binder output
- `src/mgz_pkmn/sources/`: source-specific clients (pokemontcg, tcgdex, pricecharting)
- `tests/`: unit tests (`unittest` style)

## Shared agent workflow
- Read `AGENTS.md` first for mgz-pkmn architecture invariants and PR verification rules.
- Read `.agent-workflow.md` for the AI Pit Crew development loop.
- Read `TASKS.md` fresh before relying on task status or editing it.
- Treat GitHub issues, milestones, projects, and `docs/roadmap.md` as the backlog.
- Treat `TASKS.md` as the active board only: in progress, ready for review, blocked, done.
- Prefer cross-agent review: code authored by Copilot should be reviewed by Claude or Codex when practical.

## Setup and run
From repo root:

```bash
python -m uv sync
python -m uv run pkmn --help
```

Example:

```bash
python -m uv run pkmn input/ -o output/cards.xlsx --pdf output/binder.pdf --report-json output/summary.json
```

## Validation commands
Use existing project tooling only. For normal PR work, prefer:

```bash
make fix
make check
```

If the change touches `web/`, also run:

```bash
cd web && npm run build
```

For narrow iteration, targeted `python -m uv run pytest ...` or
`python -m uv run ruff check ...` commands are fine.

## Working conventions for agents
- Keep changes targeted; avoid broad refactors unless requested.
- Prefer edits in `src/mgz_pkmn/*` and matching tests in `tests/*`.
- Do not commit secrets. If using pokemontcg.io API key, use env var `POKEMONTCG_IO_API_KEY`.
- Treat `input/` and `output/` as sample/runtime artifacts; do not modify unless the task explicitly requires it.
- Network-backed lookups can be variable; prefer unit tests for deterministic validation.

## Error encountered during onboarding + workaround
- Error seen in this environment: `uv: command not found`.
- Workaround used:

```bash
python -m pip install --user uv
python -m uv sync
```

- If `uv` is still not on `PATH`, continue using `python -m uv ...` instead of `uv ...`.
