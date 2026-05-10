# ADR 0003: Click for the CLI; uv for dependency management

- **Status:** Accepted
- **Date:** 2026-05-09
- **Tags:** cli, dependencies, tooling

## Context

The CLI surface is non-trivial: ~15 flags, several with custom validators
(price as positive float, sort mode as a constrained choice, paths with
existence checks), one-or-more positional INPUTS, environment-variable
fallback for the API key, and structured help output. The dependency
matrix has to satisfy three audiences: people running the CLI without
ever touching the API/web pieces, contributors who want a single
`make install` to bootstrap everything, and CI that runs the test suite
across three Python minor versions.

Python's standard `argparse` is fine for one-page CLIs but starts to
feel underpowered around composability and rich help. Dependency tooling
options (pip + venv, poetry, hatch, pipenv, uv) differ on speed, lockfile
quality, extras handling, and the experience of installing a console
script.

## Decision

- **CLI:** [Click](https://click.palletsprojects.com) for option parsing,
  group/sub-command structure, and styled output. The single command
  lives in [`src/mgz_pkmn/cli.py`](../../src/mgz_pkmn/cli.py) and is
  exposed as a `pkmn` console script.
- **Dependency management:** [uv](https://docs.astral.sh/uv/) for env
  management, lockfile, and console-script installation. The repo's
  `pyproject.toml` declares the runtime + dev deps; `uv sync` builds
  `.venv/` and registers `pkmn`. Optional API extras (FastAPI, uvicorn)
  are gated behind `uv sync --extra api` so the plain CLI install stays
  lightweight.
- Pre-commit hooks are installed via `uv tool install pre-commit`
  rather than `uv run --with pre-commit`, because the tool-install path
  yields a stable Python at `~/.local/bin` instead of the ephemeral
  cache path that `uv run --with` uses (which gets garbage-collected).

## Consequences

- CI is fast — `uv sync` is sub-second on a warm cache, much faster
  than pip resolving a similarly-sized lockfile.
- Click's styled help and `click.Choice` validators mean the CLI catches
  bad input at parse time rather than failing midway through a long
  lookup.
- The console-script registration ships out of the box — `make
  install-cli` immediately gives you `pkmn` on PATH (via the venv) and
  `./pkmn` (the wrapper at the repo root).
- New contributors need to install one extra tool (uv). The README and
  Makefile both lead with the `brew install uv` / curl install line.
- `uv sync --extra api` is a slight footgun — running plain `uv sync`
  doesn't pull FastAPI in, so a contributor who edits `api/` without
  running `make install` will see import errors. Mitigated by `make
  install` being the default contributor onboarding path.

## Alternatives considered

- **argparse + pip + venv.** Stdlib-only and no extra tooling, but the
  CLI ergonomics are markedly worse and pip's resolver is slow.
- **Typer** instead of Click. Nicer type-annotation-driven API, but the
  validator surface for things like `click.FloatRange(min=0, min_open=True)`
  isn't as cleanly mirrored, and Click is the more battle-tested
  underlying library.
- **Poetry** or **hatch**. Both work, both are fine. uv won on speed and
  on the cleanly-decoupled "extras" mechanism that lets the API stay
  optional.
