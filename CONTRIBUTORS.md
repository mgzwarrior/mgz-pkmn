# Contributing

Developer-facing setup, workflow, and release notes for `mgz-pkmn`. For end-user
installation and usage, see the [README](README.md).

## Project layout

```
src/mgz_pkmn/
├── __init__.py
├── __main__.py        # python -m mgz_pkmn
├── cli.py             # Click command, top-level orchestration
├── parser.py          # parse_line, CardQuery, language + bulk-phrase detection
├── lookup.py          # find_card + find_top_cards (pokemontcg → URL hint → tcgdex)
├── pricing.py         # extract_pricing, Pricing, COMP_PERCENTS
├── images.py          # download + thumbnail
├── spreadsheet.py     # write_spreadsheet, HEADERS, Row
├── binder.py          # 3x3 PDF binder layout (reportlab)
└── sources/
    ├── __init__.py
    ├── base.py            # MatchResult, scoring, set-overlap
    ├── pokemontcg.py      # TCGClient + search_pokemontcg
    ├── tcgdex.py          # TCGDexClient + search_tcgdex (multilingual)
    └── pricecharting.py   # URL-based scraper for region-exclusive cards
```

Adding a new source is a matter of dropping a module under `sources/` that
returns the normalized card shape, then adding it to `lookup.find_card`.

## Development

```bash
uv sync                                       # create .venv and install deps
uv run ruff check src/                        # lint
uv run ruff format src/                       # format
uv run ruff check --fix src/                  # autofix
uv run python -m unittest discover -s tests   # run tests
```

Ruff config lives in [pyproject.toml](pyproject.toml) under `[tool.ruff]`.

## Pre-commit hooks

Install [pre-commit](https://pre-commit.com) once as a uv tool, then register
the hook so lint and format checks run automatically before every commit:

```bash
uv tool install pre-commit
pre-commit install
```

The hooks are defined in [.pre-commit-config.yaml](.pre-commit-config.yaml) and
run `ruff check --fix` and `ruff format` on every staged file.

> **Why `uv tool install` and not `uv run --with pre-commit`?** `uv run --with`
> drops pre-commit into an ephemeral environment under `~/.cache/uv/builds-v0/`
> that uv eventually garbage-collects. The installed git hook bakes in the
> absolute path to that Python, so once the cache is cleaned you'll start
> seeing `` `pre-commit` not found.  Did you forget to activate your
> virtualenv? `` on every commit. `uv tool install` puts pre-commit in a
> stable location (`~/.local/bin`) that survives cache cleanup.

If you already hit that error, the fix is the same two commands above —
`uv tool install pre-commit` then `pre-commit install` regenerates the hook
with a stable Python path.

## CI

GitHub Actions runs three parallel jobs on every pull request and push to
`main`:

| Job | What it checks |
|---|---|
| `lint-and-test` | ruff lint + format check + full test suite, across Python 3.11 / 3.12 / 3.13 |
| `api-lint` | ruff lint + format check for `api/` (with the `api` extras installed) |
| `web-lint-and-build` | ESLint + TypeScript build (`tsc -b && vite build`) for `web/` |

## Releasing

Push a `v*` tag to trigger the release workflow:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow builds the package, runs the test suite, and publishes a GitHub
Release with the built distribution files attached.
