# Agent Guidance for mgz-pkmn

This file documents the code conventions and invariants that AI coding agents
(GitHub Copilot, Cursor, etc.) must follow when working in this repo.

**Workflow** — for the shared AI-assisted development loop, see
[.agent-workflow.md](.agent-workflow.md). For issue selection, branching, and PR
process, see [CLAUDE.md](CLAUDE.md) (Claude Code) or
[docs/contributing.md](docs/contributing.md) (all contributors).

---

## AI Pit Crew operating model

mgz-pkmn uses AI Pit Crew as a lightweight coordination layer, not as a runtime
framework or dependency. The repository is the shared workspace: every agent
works from the same docs, issue tracker, task board, tests, and PR process.

- The human developer owns product direction, prioritization, architecture
  decisions, merge approval, and release timing.
- GitHub issues, milestones, projects, and [docs/roadmap.md](docs/roadmap.md)
  own planned work and sequencing.
- [TASKS.md](TASKS.md) is only the active work board for work in progress,
  ready for review, blocked, or recently done.
- Agents should re-read [TASKS.md](TASKS.md) immediately before relying on task
  status or editing it.
- Prefer cross-agent review: code written by one AI tool should be reviewed by a
  different AI tool when practical, then approved by the human.

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

## PR verification artifacts

Every PR that is observable in the browser preview, or that fixes a
user-reported bug (even a backend one), must include a **verification
artifact** in the PR body — a screenshot, a [Jam](https://jam.dev)
recording, or a `curl` / log snippet — so reviewers can see the
change without reproducing it locally. Pick the form that matches the
change:

- **UI change** — a screenshot (or a before/after pair for
  positional or layout fixes) under **How to verify**, or under a
  dedicated **Proof** subsection. The asset should live on
  `user-images.githubusercontent.com` (uploaded via the GitHub
  PR-body image picker).
- **Multi-step interaction** (dropdown, drawer, tour, streaming
  results) — a short Jam clip.
- **Backend bug fix** that closes a user-reported issue — a `curl`
  or log artifact showing the fixed response, or a screenshot of the
  corrected surface in the SPA.

Exempt: dependency bumps, internal refactors with no behavior change,
test-only or docs-only PRs.

### Agents do not attach screenshots — they request them

AI agents (Claude Code, Copilot, Cursor, etc.) **do not** upload
screenshots or Jam clips when opening a PR. The `gh` CLI has no
endpoint for attaching to `user-images.githubusercontent.com`, and
committing screenshots to the repo as a workaround bloats `main` and
is not allowed. Instead, the agent should:

1. Leave a placeholder section in the PR body, e.g.
   `## Preview` _— screenshot to be attached by the developer._
2. Verify the change works locally (browser preview, manual reproduction,
   added tests) and call that out in **How to verify**.
3. Explicitly instruct the developer in the final turn to drag the
   screenshot or Jam link into the PR description (or as a comment)
   before requesting review.

The developer attaches the artifact — the agent's job is to make the
PR ready *except* for that one step.

**Required for merge.** All [CI checks](docs/contributing.md#ci) must
be green before a PR is merged. The verification artifact requirement
is enforced by reviewers, not by CI — a reviewer should withhold
approval (and re-request changes) on any in-scope PR that lacks one.

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
- Do not commit without `-s`. The `DCO` CI job fails on any non-merge commit
  missing the `Signed-off-by:` trailer (and will block merge once required in
  branch protection). The `commit-msg` pre-commit hook auto-appends the
  sign-off if installed, but always `git commit -s -m "..."` to be safe. See
  [docs/contributing.md](docs/contributing.md#signing-off-your-commits) for
  recovery commands.
