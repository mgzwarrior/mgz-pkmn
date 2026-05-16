# Contributing

Developer-facing setup, workflow, and release notes for `mgz-pkmn`. For
end-user installation and usage, see the [README](../README.md).

> **AI agents** — see [AGENTS.md](../AGENTS.md) for the code conventions,
> invariants, and commit rules that agents must follow.

## Getting started

New here? Welcome — contributions are explicitly invited, including
AI-assisted ones. [AGENTS.md](../AGENTS.md) is there to make
agent-driven contributions supportable, not exotic; humans benefit
from the same conventions.

The fastest way in:

1. **Browse open issues** by label —
   [`good first issue`](https://github.com/mgzwarrior/mgz-pkmn/labels/good%20first%20issue)
   for the recommended starting point,
   [`help wanted`](https://github.com/mgzwarrior/mgz-pkmn/labels/help%20wanted)
   for anything where extra eyes are welcome, or filter by the
   `area:*` label that matches the part of the codebase you want to
   touch.
2. **Skim [AGENTS.md](../AGENTS.md)** for the project's invariants
   (single `Row` shape, pure-function writers, dataclass-driven
   layouts).
3. **Open a PR** following the [branch naming](#branch-naming) and
   [opening a PR](#opening-a-pr) sections below.

Stuck on scope or design? Open a [GitHub
Discussion](https://github.com/mgzwarrior/mgz-pkmn/discussions/new?category=general)
before writing code — it's cheaper to align early than to redo a PR.

## Curated starter issues

The live label filters above are the always-current source of truth.
Below is a smaller, hand-picked set designed specifically for a
first-time contributor: each is small, atomic, doesn't require deep
context, and ships as a complete PR (branch, code, tests where
relevant, CHANGELOG decision).

| Issue | What you'll do | Why it's a good starter |
|---|---|---|
| [#134](https://github.com/mgzwarrior/mgz-pkmn/issues/134) | Add `CITATION.cff` | One new file at the repo root. GitHub surfaces a "Cite this repository" button. Pure, atomic addition. |
| [#135](https://github.com/mgzwarrior/mgz-pkmn/issues/135) | Add a Troubleshooting section to `docs/cli.md` | Pure docs work. Mirrors the existing table in `api/README.md`. Pattern to copy, content to extend. |
| [#136](https://github.com/mgzwarrior/mgz-pkmn/issues/136) | Add a `py.typed` marker | One empty file + a packaging verify. Teaches you how the wheel build works without touching any runtime code. |
| [#137](https://github.com/mgzwarrior/mgz-pkmn/issues/137) | Surface Discussions in README and docs | A few targeted doc edits. Touches three files, each by 1–3 lines. |

Pick one, drop a comment on the issue saying you're picking it up, and
follow the [branch naming](#branch-naming) / [opening a PR](#opening-a-pr)
sections below.

## What makes a good starter issue

When triaging, the `good first issue` label is appropriate for any of:

- Adds a small CLI flag or subcommand that follows an existing
  pattern (e.g., a new `pkmn cache *` subcommand modeled on
  `pkmn cache stats`).
- Mirrors an existing implementation onto a new source / output /
  format (e.g., caching TCGdex responses the same way pokemontcg.io
  responses are cached).
- Documentation polish: filling a gap in `docs/` or correcting an
  inaccuracy against the actual code.
- Test coverage: adding missing tests against existing behavior.
- Pure-function rendering tweaks (spreadsheet formatting, checklist
  layout, PDF styling) that don't change the data shape.

Avoid the label for issues that need a new ADR, touch parser grammar,
introduce a new dependency, or coordinate across more than two
modules — those benefit from a design discussion first.

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
├── binder.py          # PDF binder layouts (standard 3×3 + condensed 6×4)
├── checklist.py       # printable per-tag checklist PDF
├── report.py          # JSON report builder (pure)
├── sorting.py         # row ordering applied before any output is written
└── sources/
    ├── __init__.py
    ├── base.py            # MatchResult, scoring, set-overlap
    ├── pokemontcg.py      # TCGClient + search_pokemontcg
    ├── tcgdex.py          # TCGDexClient + search_tcgdex (multilingual)
    └── pricecharting.py   # URL-based scraper for region-exclusive cards
```

Adding a new source is a matter of dropping a module under `sources/`
that returns the normalized card shape, then adding it to
`lookup.find_card`.

## Branch naming

Name feature/fix branches `<issueNumber>-<shortDescription>` (e.g.
`28-add-license-file`). The number prefix makes the related issue easy
to spot in `git branch` output and in the PR list at a glance.

The branch name alone does **not** make GitHub link the PR to the
issue — for that, either reference the issue in the PR body with a
closing keyword (`Fixes #28`, `Closes #28`, `Resolves #28`), or create
the branch from the issue's "Development" panel in the GitHub UI, which
records an explicit link.

If there is no tracking issue, open one first — every change should be
traceable back to an issue.

## Opening a PR

When opening a PR for an issue, mirror the issue's labels, milestone,
and project assignment onto the PR so the issue and PR move through
the project board together. None of this is automatic — branch name
prefix and closing keywords don't copy metadata.

`gh pr create` accepts these directly. Pull the values from the issue
first:

```bash
ISSUE=28
REPO=mgzwarrior/mgz-pkmn
gh issue view $ISSUE --repo $REPO --json labels,milestone,projectItems
```

Then pass them at create time:

```bash
gh pr create \
  --title "..." \
  --body  "...Resolves #$ISSUE..." \
  --label    "area:devops,version:v1,type:chore" \
  --milestone "v1.0" \
  --project   "DevOps & release"
```

If you've already opened the PR, sync after the fact:

```bash
gh pr edit <PR> --add-label "..." --milestone "..."
gh project item-add <project-number> --owner mgzwarrior --url <pr-url>
```

The PR body must still include a closing keyword (`Fixes #N`, `Closes
#N`, `Resolves #N`) — that's what GitHub uses for the issue/PR link
and for auto-closing the issue on merge.

If you have a question before you open the PR, use [GitHub Discussions](https://github.com/mgzwarrior/mgz-pkmn/discussions) for that first-pass conversation — it keeps exploratory design talk out of the issue tracker until there is a concrete change to make.

## Development

The Makefile at the repo root wraps the common dev commands. Run
`make help` to see every target.

```bash
make install            # one-shot: deps + pre-commit hook
make test               # python tests
make lint               # ruff + eslint
make format             # ruff format in-place
make fix                # ruff --fix + ruff format
make check              # CI-equivalent: lint + format-check + tests + web lint
make precommit          # run all pre-commit hooks against every file
```

Direct invocations still work if you'd rather skip Make:

```bash
uv sync                                       # create .venv and install deps
uv run ruff check src/                        # lint
uv run ruff format src/                       # format
uv run ruff check --fix src/                  # autofix
uv run python -m unittest discover -s tests   # run tests
```

Ruff config lives in [pyproject.toml](../pyproject.toml) under
`[tool.ruff]`.

## Pre-commit hooks

`make install-hooks` (or the full `make install`) does this for you:

```bash
make install-hooks
```

That runs `uv tool install pre-commit` and registers the git hook so
lint and format checks fire automatically before every commit.
Equivalent manual flow:

```bash
uv tool install pre-commit
pre-commit install
```

The hooks are defined in
[.pre-commit-config.yaml](../.pre-commit-config.yaml) and run
`ruff check --fix` and `ruff format` on every staged file.

> **Why `uv tool install` and not `uv run --with pre-commit`?**
> `uv run --with` drops pre-commit into an ephemeral environment under
> `~/.cache/uv/builds-v0/` that uv eventually garbage-collects. The
> installed git hook bakes in the absolute path to that Python, so once
> the cache is cleaned you'll start seeing
> `` `pre-commit` not found.  Did you forget to activate your virtualenv? ``
> on every commit. `uv tool install` puts pre-commit in a stable
> location (`~/.local/bin`) that survives cache cleanup.

If you already hit that error, the fix is the same two commands above
— `uv tool install pre-commit` then `pre-commit install` regenerates
the hook with a stable Python path.

## CI

GitHub Actions runs two parallel jobs on every pull request and push
to `main`:

| Job | What it checks |
|---|---|
| `api` | ruff lint + format check + full test suite (`src/` and `api/`), across Python 3.11 / 3.12 / 3.13 |
| `web` | ESLint + Vitest + TypeScript build (`tsc -b && vite build`) for `web/` |

## Changelog

[CHANGELOG.md](../CHANGELOG.md) follows the [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/) format. A PR with a
**user-facing** change — a new feature, bug fix, behaviour change,
deprecation, or removal — adds a bullet under the matching subsection
(`Added` / `Changed` / `Fixed` / `Deprecated` / `Removed`) of the
`[Unreleased]` section at the top of the file.

Skip the changelog for changes users never see: dependency bumps, CI
config, internal refactors, and test-only changes.

## Releasing

First, rotate the changelog: rename the `[Unreleased]` section to the
new version with today's date, add a fresh empty `[Unreleased]` above
it, and update the compare links at the bottom of the file.

Then push a `v*` tag to trigger the release workflow:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow builds the package, runs the test suite, and publishes a
GitHub Release with the built distribution files attached.
