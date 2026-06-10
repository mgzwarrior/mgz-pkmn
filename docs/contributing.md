# Contributing

Developer-facing setup, workflow, and release notes for `mgz-pkmn`. For
end-user installation and usage, see the [README](../README.md).

> **AI agents** — see [AGENTS.md](../AGENTS.md) for the code conventions,
> invariants, and commit rules that agents must follow. See
> [.agent-workflow.md](../.agent-workflow.md) for the shared AI-assisted
> development loop.

## Getting started

New here? Welcome — contributions are explicitly invited, including
AI-assisted ones. [AGENTS.md](../AGENTS.md) is there to make
agent-driven contributions supportable, not exotic; humans benefit
from the same conventions. All contributors are expected to follow the
[Code of Conduct](../CODE_OF_CONDUCT.md).

Before or after your first PR, feel free to pop into the
[Introduce yourself 👋](https://github.com/mgzwarrior/mgz-pkmn/discussions/160)
discussion and say hello — it's a nice place to meet the community.
For the full picture on contributing (including AI-assisted PRs and
current priorities), see the
[Contributing to mgz-pkmn](https://github.com/mgzwarrior/mgz-pkmn/discussions/141)
discussion.

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
3. **For AI-assisted work**, the active-work board is GitHub itself —
   `gh pr list` / `gh issue list` plus the `agent:*` label on each PR.
   No separate task file.
4. **Open a PR** following the [branch naming](#branch-naming) and
   [opening a PR](#opening-a-pr) sections below.

Stuck on scope or design? Open a [GitHub
Discussion](https://github.com/mgzwarrior/mgz-pkmn/discussions/new?category=general)
before writing code — it's cheaper to align early than to redo a PR.

## AI-assisted workflow

mgz-pkmn's AI-assisted workflow is inspired by
[@bobbylough](https://github.com/bobbylough)'s
[ai-pit-crew](https://github.com/bobbylough/ai-pit-crew) project: the
human sets direction, one agent implements, a different agent reviews,
and the human makes the final approval decision.

Expect the following when AI agents contribute:

- GitHub issues, milestones, projects, and [docs/roadmap.md](roadmap.md)
  remain the backlog and planning source of truth.
- GitHub itself is the active-work board: branches, PRs, draft/open
  state, the `blocked` label, and the `agent:<name>` label on each PR
  carry every piece of in-flight state. There is no separate task
  file checked into the repo.
- [AGENTS.md](../AGENTS.md) remains the canonical source for code
  invariants, PR verification artifacts, and repository-specific rules.
- [.agent-workflow.md](../.agent-workflow.md) provides the short shared
  loop for claiming, implementing, verifying, and cross-reviewing work.
- When practical, code written by one AI tool should be reviewed by a
  different AI tool before maintainer approval.

## Opening an issue

Blank issues are disabled — the "New Issue" button shows structured templates
and contact links instead. If you want to ask a question or start a discussion
rather than file a bug or feature request, use [GitHub
Discussions](https://github.com/mgzwarrior/mgz-pkmn/discussions) directly.

## Claiming an issue

Comment on the issue saying you'd like to take it — something as
simple as "I'd like to work on this" is enough. The maintainer will
assign it to you.

Claimed issues that have seen no activity for **two weeks** are
reopened for others to pick up. If life gets in the way, just say so
in the thread — it won't be reassigned without notice.

## Contributor ladder

| Level | How you get there |
|---|---|
| **Contributor** | Any merged PR. Your name is in the commit history. |
| **Collaborator** | Invited by the maintainer after a merged PR — grants write access to the repository (subject to branch protection rules) and the ability to self-assign issues. |

No formal process — if you've shipped something and want to stay
involved, say so and the invite will follow.

## Curated starter issues

The live label filters above are the always-current source of truth.
Below is a smaller, hand-picked set designed specifically for a
first-time contributor: each is small, atomic, doesn't require deep
context, and ships as a complete PR (branch, code, tests where
relevant, CHANGELOG decision).

| Issue | What you'll do | Why it's a good starter |
|---|---|---|
| [#214](https://github.com/mgzwarrior/mgz-pkmn/issues/214) | Add a `make uninstall` target | One Makefile target, symmetric to `make install`. No production code touched. |
| [#210](https://github.com/mgzwarrior/mgz-pkmn/issues/210) | README "Environment variables" section | Pure docs. One section, links out to `docs/cache.md` instead of duplicating content. |
| [#230](https://github.com/mgzwarrior/mgz-pkmn/issues/230) | Test coverage: lookup sources (pokemontcg + TCGdex + base) | Mocked-HTTP tests against well-defined inputs/outputs. `pricecharting.py` (78% covered) is the model. Test-only PR. |
| [#234](https://github.com/mgzwarrior/mgz-pkmn/issues/234) | Test coverage: interactive web components | Each component is a focused surface with a clear public API. `Tour.test.tsx` (98% covered) is the model for the React Testing Library + user-event pattern. Test-only PR. |

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

The repo carries four production surfaces (CLI + API + SPA + marketing
site), plus the shared design system and the usual test / doc / output dirs.

```
mgz-pkmn/
├── src/mgz_pkmn/    # Python CLI and lookup pipeline
├── api/             # FastAPI service + SSE streaming + auth + persistence
├── web/             # React 19 + Vite SPA (served by api/ in production)
├── site/            # Astro static marketing site (mgz-pkmn.com)
├── design/          # tropical design tokens, styleguide cards, integration guide
├── tests/           # pytest suite for src/ and api/
├── docs/            # reference + ADRs (canonical; the wiki is a mirror)
├── input/           # sample input files used by the docs and examples
├── output/          # tracked example artifacts; refreshed by `make refresh-examples`
└── assets/          # logos and shared static assets
```

### `src/mgz_pkmn/` — the CLI and lookup pipeline

```
src/mgz_pkmn/
├── __init__.py
├── __main__.py        # python -m mgz_pkmn
├── cli/               # Click commands split per surface (lookup/, set_cards/, cache/, exeggutor/)
├── parser.py          # parse_line, CardQuery, language + bulk-phrase detection
├── lookup.py          # find_card / find_top_cards, plus warm_concepts / warm_set_cards / warm_cards
├── pricing.py         # extract_pricing, Pricing, COMP_PERCENTS
├── images.py          # download + thumbnail (per-card art)
├── card_images.py     # batch warm-cache for card images across warmed sets
├── set_cards.py       # set-cards PDF + warm_set_images
├── spreadsheet.py     # write_spreadsheet, HEADERS, Row
├── binder.py          # PDF binder layouts (standard 3×3 + condensed 6×4)
├── checklist.py       # printable per-tag checklist PDF
├── report.py          # JSON report builder (pure)
├── sorting.py         # row ordering applied before any output is written
├── cache.py           # disk cache (split structural / pricing, ADR-0018) + warm manifests
├── branding.py        # logo + footer rendered into exports
├── changelog.py       # parses CHANGELOG.md for the /version endpoint
└── sources/
    ├── __init__.py
    ├── base.py            # MatchResult, scoring, set-overlap
    ├── pokemontcg.py      # TCGClient + search_pokemontcg
    ├── tcgdex.py          # TCGDexClient + search_tcgdex (multilingual)
    └── pricecharting.py   # URL-based scraper for region-exclusive cards
```

### `api/` — the FastAPI backend

```
api/
├── main.py            # app factory, lifespan, warm bootstrap, static mount
├── routes/            # /lookup, /bulk (SSE), /parse, /sets, /cards, /runs, /me
├── auth/              # signed-cookie sessions, /me, env kill switch (ADR-0019)
├── db/                # SQLAlchemy session + URL resolution
├── models/            # ORM models (users, runs, run_rows)
└── migrations/        # Alembic migrations under versions/
```

### `web/` — the React SPA

Vite + React 19 + TypeScript, TailwindCSS 4, Radix UI primitives,
Zustand for state, TanStack Query for data fetching. Build output is
served as a static SPA from the FastAPI app in production.

### `site/` — the marketing site

Astro static site at <https://mgz-pkmn.com>. Deployed to Cloudflare
Pages on every push to `main` (see [ADR-0016](adr/0016-deployment-topology.md)).

### `design/` — tokens and styleguide

[`design/DESIGN_SYSTEM.md`](../design/DESIGN_SYSTEM.md) is the human-readable
guide for the tropical brand direction. Visual changes should start from
[`design/tokens/colors_and_type.css`](../design/tokens/colors_and_type.css) and
check [`design/styleguide/index.html`](../design/styleguide/index.html) for the
rendered reference cards before touching `site/` or `web/` styles.

Adding a new lookup source is a matter of dropping a module under
`src/mgz_pkmn/sources/` that returns the normalized card shape, then
wiring it into `lookup.find_card`. If the new source also contributes
pricing data, see [ADR-0023](adr/0023-source-ensemble-pricing.md) for
the ensemble-display contract — registration of the source itself
doesn't change, but the ensemble determines how its prices appear
alongside other sources'.

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

### Verification artifacts

PRs that are observable in the browser preview, or that fix a
user-reported bug (even a backend one), need a **verification
artifact** in the body — a screenshot, a [Jam](https://jam.dev)
recording, or a `curl` / log snippet — so reviewers can see the
change without reproducing it locally. Drop it under **How to verify**
or in a dedicated **Proof** subsection. Pick the form that matches the
change:

- **UI change** — paste a screenshot, or a before/after pair for
  positional and layout fixes. Use the GitHub PR-body image picker so
  the asset lives on `user-images.githubusercontent.com`.
- **Multi-step interaction** (dropdown, drawer, tour, streaming
  results) — record a short Jam clip and paste the link.
- **Backend bug fix** that closes a user-reported issue — paste a
  `curl` or log snippet showing the fixed response, or a screenshot
  of the corrected surface in the SPA.

Exempt: dependency bumps, internal refactors with no behavior change,
test-only or docs-only PRs.

**Required for merge.** Both checks below have to clear before a PR
can be merged:

1. All [CI checks](#ci) (`api`, `web`, `site`, `DCO`, CodeQL) are
   green.
2. For any in-scope PR (see above), a verification artifact is in the
   PR body. This is reviewer-enforced, not gated by CI — reviewers
   should withhold approval and re-request changes on any in-scope PR
   that lacks one.

If you have a question before you open the PR, use [GitHub Discussions](https://github.com/mgzwarrior/mgz-pkmn/discussions) for that first-pass conversation — it keeps exploratory design talk out of the issue tracker until there is a concrete change to make.

## Development

The Makefile at the repo root wraps the common dev commands. Run
`make help` to see every target.

```bash
make install            # one-shot: deps + pre-commit hook
make uninstall          # remove .venv + pre-commit hooks (use `make clean` for the broader nuke incl. node_modules)
make test               # python tests
make coverage           # python tests under coverage; emits htmlcov/ + coverage.xml + junit.xml
make lint               # ruff + eslint
make format             # ruff format in-place
make fix                # ruff --fix + ruff format
make complexity         # radon CC + MI gate — fails on D+ functions or B+ files (see Makefile RADON_*_EXCLUDE for the shrink-as-we-refactor allowlist; pair with the [`repo-analysis`](../.claude/skills/repo-analysis/SKILL.md) skill to find the next refactor target)
make check              # CI-equivalent: lint + format-check + complexity gate + tests + web lint
make precommit          # run all pre-commit hooks against every file
```

For running the app locally:

```bash
make dev-api            # FastAPI on :8000 with reload (active dev, terminal 1)
make dev-web            # Vite on :5173 proxying /api → :8000 (active dev, terminal 2)
make dev                # build + run the Docker image on :8000 (single terminal,
                        # no hot reload — for quick smoke runs and demos)
```

Use `dev-api` + `dev-web` for the edit-save-reload loop. `make dev` rebuilds
the production Docker image and serves the API plus the prebuilt SPA from a
single container — handy for previewing the production bundle or showing
someone the app without running two terminals, but every code change requires
a full rebuild.

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

### Performance reference

[`docs/benchmarks.md`](benchmarks.md) lists expected lookup latencies
for the workloads users hit most often. If you're changing
`lookup.py`, `pricing.py`, `images.py`, or the SSE wiring, run one of
the reference workloads with the **Show lookup timer** setting on and
compare the on-screen total against the documented range — it's the
cheapest regression check available.

## Pre-commit hooks

`make install-hooks` (or the full `make install`) does this for you:

```bash
make install-hooks
```

That runs `uv tool install pre-commit` and registers the git hooks
(both the `pre-commit` stage for lint/format/typecheck and the
`commit-msg` stage for DCO sign-off auto-append) so checks fire
automatically before every commit. Equivalent manual flow:

```bash
uv tool install pre-commit
pre-commit install
pre-commit install --hook-type commit-msg
```

The hooks are defined in
[.pre-commit-config.yaml](../.pre-commit-config.yaml) and run
`ruff check --fix` and `ruff format` on every staged file, plus the
DCO sign-off auto-append on every commit message (see
[Signing off your commits](#signing-off-your-commits)).

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

## Commit messages

Every non-merge commit on a PR must follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The CI workflow [`conventional-commits.yml`](../.github/workflows/conventional-commits.yml) fails any PR whose commits don't match; the same rule fires locally at commit-msg time via [gitlint](https://jorisroovers.github.io/gitlint/) (configured in [`.gitlint`](../.gitlint), wired through [`.pre-commit-config.yaml`](../.pre-commit-config.yaml)).

### Format

```
<type>(<scope>)?!?: <subject>

<body — optional, free-form, no hard line wraps>

<footer — optional; release-please reads BREAKING CHANGE: footers>
```

### Allowed types

| Type | Use for | Shows up in CHANGELOG as |
|------|---------|--------------------------|
| `feat` | New user-facing capability | `### Added` |
| `fix` | User-facing bug fix | `### Fixed` |
| `perf` | Performance improvement | `### Changed` |
| `refactor` | Internal restructure with no behavior change | `### Changed` |
| `docs` | Documentation only | `### Changed` |
| `revert` | Revert of a prior commit | `### Changed` |
| `chore` | Tooling, deps, internal housekeeping | *hidden* |
| `ci` | CI / workflow changes | *hidden* |
| `test` | Test-only changes | *hidden* |
| `build` | Build system, packaging | *hidden* |
| `style` | Formatting only | *hidden* |

Append `!` after the type/scope (`feat(api)!:`) for a breaking change. [release-please](https://github.com/googleapis/release-please) reads that marker and bumps the major version.

### Scope

The `<scope>` is optional and free-form. The project's existing prefixes still apply — `web`, `api`, `cli`, `docs`, `design`, `site`, plus area tags from `area:*` labels — but use the Conventional Commits shape:

| Old shape | New shape |
|-----------|-----------|
| `web: unify Library destination` | `feat(web): unify Library destination` |
| `api: collections data model rework` | `feat(api): collections data model rework` |
| `docs: clarify release flow` | `docs: clarify release flow` |
| `[Agent]: refactor X` | `refactor(cli): X` (and use the `agent:claude` label) |

### Subject line

- Imperative mood ("add", "fix", "remove" — not "added", "adds").
- Lowercase first character after the colon.
- No trailing period.
- Max 100 chars (CI and gitlint cap; aim for 72 to keep `gh pr view` and email previews clean).

### Body

No hard line wraps in commit bodies — each paragraph is one line; let renderers wrap responsively. The subject line still follows the usual short / imperative discipline.

### Examples

```
feat(web): add binder progress chart

The dashboard now reads from `collection_snapshots` to render value-over-time. Backs #575.
```

```
fix(api): handle empty card_json in promote endpoint

Closes #604.
```

```
refactor(cli)!: drop deprecated --legacy flag

BREAKING CHANGE: `pkmn lookup --legacy` is removed. Use `pkmn lookup` without flags.
```

### Local enforcement

`make install` (or `make install-hooks`) registers the commit-msg-stage gitlint hook alongside the DCO sign-off hook, so a malformed subject is rejected at commit time. Manual install:

```bash
uv tool install gitlint
gitlint install-hook
```

The CI workflow is authoritative — if gitlint and the workflow ever disagree, fix the workflow's regex first (it's the contract release-please reads).

### Why this matters

release-please walks the Conventional Commits between releases to draft the next version-bump PR — see [release-please.yml](../.github/workflows/release-please.yml) and [release-please-config.json](../release-please-config.json). A non-conforming commit is invisible to that drafting pass, which means a real user-facing change can silently miss the changelog. The CI check is the gate that keeps the auto-drafted notes complete.

## Signing off your commits

Every non-merge commit on a PR needs a [DCO](https://developercertificate.org/)
sign-off — a `Signed-off-by: Name <email>` trailer in the commit
message that asserts you have the right to license your contribution
under MIT. The `DCO` CI job fails when any non-merge commit is missing
the trailer; merges are blocked once the maintainer adds the check to
branch protection's required-checks list (until then the check is
advisory). Merge commits are exempted to match the convention used by
Linux, Kubernetes, and most CNCF projects — resolve conflicts in a
separate signed commit rather than in a merge commit.

See [ADR-0012](adr/0012-open-core-architecture.md) for the rationale
behind the DCO posture.

### The easy path: the pre-commit hook auto-appends sign-off

`make install-hooks` (or the full `make install`) registers a
`commit-msg`-stage pre-commit hook that auto-appends the sign-off
trailer to every commit using your `git config user.name` and
`user.email`. With the hook installed you don't have to remember
`-s` — every local commit is signed off automatically.

### Manual sign-off

If you don't use the hook (or are committing on a machine without the
pre-commit framework installed), pass `-s` explicitly:

```bash
git commit -s -m "your message"
```

The trailer uses the name and email from your `git config user.*` —
no extra setup required, no cryptographic keys, no documents to sign.
This is *not* the same as GPG/SSH commit signing (this project does
not enforce signed commits — see [#153](https://github.com/mgzwarrior/mgz-pkmn/pull/153)).

**Forgot `-s` on the last commit:**

```bash
git commit --amend --no-edit -s
git push --force-with-lease
```

**Forgot `-s` on every commit of a PR:**

```bash
git rebase --signoff origin/main
git push --force-with-lease
```

**Editing on github.com:** the web UI doesn't add the trailer
automatically. After saving, pull the commit locally and amend it with
`git commit --amend --no-edit -s` before pushing.

Dependabot's commits include the sign-off automatically, so its PRs
require no special handling.

## CI

GitHub Actions runs three parallel jobs on every pull request and push
to `main`, plus a DCO check on PRs:

| Job | What it checks |
|---|---|
| `api` | ruff lint + format check + full test suite (`src/` and `api/`), across Python 3.11 / 3.12 / 3.13. Uploads coverage + junit to [Codecov](https://codecov.io/gh/mgzwarrior/mgz-pkmn) on the 3.13 entry. |
| `web` | ESLint + Vitest (with v8 coverage) + TypeScript build (`tsc -b && vite build`) for `web/`. Uploads coverage + junit to Codecov. |
| `site` | Astro build for the marketing site (`site/`) |
| `DCO` | Every non-merge PR commit carries a well-formed `Signed-off-by:` trailer (PRs only; advisory until added to branch protection's required-checks list) |

Codecov is configured via [`codecov.yml`](../codecov.yml). Both project
and patch status checks run as `informational: true` — they post the
delta on every PR but never fail the build. The PR comment shows
project + patch coverage, the per-flag breakdown (`api`, `web`), and
per-component numbers (lookup, outputs, CLI, cache, API routes, web
SPA). Thresholds will be revisited once we have a stable baseline.

## Changelog

[CHANGELOG.md](../CHANGELOG.md) follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**Don't add `[Unreleased]` entries by hand in your PR.** release-please reads the Conventional Commits between releases and drafts the next release's bullets automatically — adding a hand-written entry on top of that produces a duplicate that ships to the marketing site and the live-demo "what's new" surface as the same change listed twice. The cut-release editorial consolidation pass (`.claude/skills/cut-release/SKILL.md` Step 5a) then rewrites release-please's terse bullets into the project's rich-paragraph style, pulling detail from PR bodies — so the things that matter for the final CHANGELOG are:

- **Your Conventional Commits subject** (`<type>(<scope>): <subject>`) — release-please uses it verbatim as the seed bullet. `feat:` lands under `### Added`, `fix:` under `### Fixed`, `perf:` / `refactor:` / `docs:` / `revert:` under `### Changed`. `chore:` / `ci:` / `test:` / `build:` / `style:` are hidden from the changelog by design — that's how you mark "changes users never see" (dependency bumps, CI config, internal refactors, test-only PRs).
- **Your PR body** — the cut-release editorial pass reads it when rewriting bullets into the rich style. Include the **why**, the user-visible impact, and the files / surfaces touched. The richer your PR description, the richer the final changelog entry.

If your change really has no user-visible impact, use a hidden type (`chore:`, `ci:`, `refactor:` for internal-only restructures, `test:`, `build:`, `style:`) and nothing ships to the changelog. No manual `### Hidden` block, no opt-out flag — the commit type is the contract.

This rule is forward-looking: existing hand-written `[Unreleased]` entries that predate release-please stay until the next release's editorial pass folds or rewrites them.

## Releasing

release-please owns the release end to end. A version-bump PR **is** the release — once it merges to `main`, release-please tags the commit and cuts the GitHub Release. That `release` event triggers `release.yml`, which builds the package, runs the test suite, publishes to [PyPI](https://pypi.org/project/mgz-pkmn/) via trusted publishing (with PEP 740 attestations), and attaches the built distribution to the Release.

### The release PR is drafted by release-please

`.github/workflows/release-please.yml` watches `main` and opens a version-bump PR whenever release-worthy Conventional Commits (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `revert:`) accumulate. The bot's PR is the **canonical release PR** — don't open a competing one. The bot:

- Bumps **every** version surface in one commit — root `pyproject.toml` (via the `python` release type) plus `api/pyproject.toml`, `web/package.json`, `site/package.json`, `CITATION.cff` (`version`), and `src/mgz_pkmn/__init__.py` (via the `extra-files` config in `release-please-config.json`).
- Rotates `[Unreleased]` in `CHANGELOG.md` into a new versioned section with bullets generated from the commit subjects.
- Signs the commit with `Signed-off-by: github-actions[bot] …` so the DCO check passes.

release-please can't run `uv lock` or `npm install`, so [`release-please-lock.yml`](../.github/workflows/release-please-lock.yml) watches the bot branch and re-syncs `uv.lock`, `web/package-lock.json`, and `site/package-lock.json` after the bump — without this the `web` / `site` CI jobs (which run `npm ci`) would fail on the version mismatch. The PR's checks may flash red until that re-sync commit lands; that's expected.

### The agent / human reviews the bot PR before merging

The bot bumps every surface, but it can't curate prose. The releasing agent or human checks out the bot's branch (`gh pr checkout <PR>`) and applies one pass, then pushes back to the same branch:

- **CHANGELOG consolidation pass.** Dedupe duplicate `### Added` / `### Changed` / `### Fixed` blocks, promote impactful entries to the top of each subsection, drop or merge low-signal entries (dep bumps, CI tweaks, internal renames). The marketing site and the live-demo "what's new" surface render the CHANGELOG verbatim, so whatever ships in the release section is exactly what every visitor reads. See `.claude/skills/cut-release/SKILL.md` for the full rules. While you're there, bump `date-released` in `CITATION.cff` to today (release-please bumps the `version` but not the date).

Don't close the bot's PR and open your own — release-please reuses the branch on the next `main` push, and a human-authored replacement breaks that loop.

The other three surfaces ship on their own deploy paths and don't
need an explicit release action:

- **Marketing site** (`site/`) → Cloudflare Pages auto-deploys on
  push to `main` ([ADR-0011](adr/0011-marketing-site-stack.md)).
  `release.yml` *also* fires the Pages deploy hook after the GitHub
  Release is cut, so the hero pill and roadmap teaser pick up the new
  version once the demo API has rotated. Requires the
  [`CF_PAGES_DEPLOY_HOOK`](#cloudflare-pages-deploy-hook) secret.
- **Demo API + SPA** (`api/` + `web/`) → Render auto-deploys on
  push to `main` from the [`render.yaml`](../render.yaml) blueprint
  ([ADR-0016](adr/0016-deployment-topology.md), [docs/deployment.md](deployment.md)).
- The marketing-site hero pill ("Now shipping vX.Y.Z") and the
  in-app "What's new" panel both read from
  `GET /api/v1/changelog`, which parses `CHANGELOG.md` — so as
  long as the release PR's changelog rotation lands, those
  surfaces self-update on the next deploy. The roadmap teaser
  ("Where it's going.") pulls its three cards from the GitHub
  milestones API at build time and falls back to a hard-coded set
  if the call fails.

### Running this from Claude Code

The repo ships a [`cut-release`](../.claude/skills/cut-release/SKILL.md) skill that walks the bot-PR review above: it checks out the bot's branch, runs the CHANGELOG consolidation pass, runs the local gate, and pushes back to the same branch. Invoke it from any Claude Code session with `/cut-release` (or just ask Claude to "cut the next release"). You still merge the PR yourself — everything downstream is automatic from there.

### Doing it by hand

release-please normally drafts the bump and cuts the Release. If it's
unavailable (misconfigured, or an emergency release off-cycle), you can
cut a release yourself:

1. Open a single PR that bumps the version string in **every** surface
   so the artifacts ship the same number, and rotates the changelog
   (rename `[Unreleased]` to the new version with today's date, add a
   fresh empty `[Unreleased]` above it, update the compare links):
   - **CLI** — `pyproject.toml` (root) and `src/mgz_pkmn/__init__.py`.
     Run `uv lock` afterwards to refresh `uv.lock`.
   - **API** — `api/pyproject.toml`. Served as `{"version": "..."}` by
     `GET /version`.
   - **Web SPA** — `web/package.json`. Run `npm install` afterwards
     so `web/package-lock.json` picks up the new version.
   - **Marketing site** — `site/package.json`. Run `npm install`
     afterwards so `site/package-lock.json` picks up the new version.
   - **Citation metadata** — `CITATION.cff`: bump `version` and
     `date-released`.
   - **release-please bookkeeping** — bump the version in
     `.release-please-manifest.json` to match, so release-please's next
     run anchors on this release instead of re-proposing it.
2. Merge the PR.
3. Cut the GitHub Release at that commit — this is what triggers
   `release.yml` (it runs `on: release`, not on a bare tag push):

   ```bash
   gh release create v0.2.0 --generate-notes
   ```

### PyPI trusted publisher wiring

The `pypi-publish` job uses [PyPI Trusted
Publishing](https://docs.pypi.org/trusted-publishers/) (OIDC) so the
workflow uploads to PyPI without a stored API token, and signs each
artifact with a [PEP 740](https://peps.python.org/pep-0740/)
attestation that PyPI verifies against the trusted-publisher binding.
The binding — owner `mgzwarrior`, repo `mgz-pkmn`, workflow
`release.yml`, environment `pypi` — and the matching `pypi` GitHub
Environment (no secrets) are already in place. If either ever needs
to be rebuilt (project re-owned, environment recreated, etc.), re-add
the trusted publisher in the PyPI project's **Publishing** settings
with those same four values and recreate the `pypi` Environment
under repo Settings → Environments.

Only **one** binding is required because every release path converges
on `release.yml` running as a **top-level** workflow on the `release`
event — never via `workflow_call`. The binding matches on owner, repo,
workflow filename, and environment, *not* the trigger event, so moving
the trigger from a tag push to the `release` event needs no change on
PyPI. (Attestation verification looks at the top-level workflow ref,
which differs from the reusable-workflow ref that OIDC
trusted-publisher auth would use — so keep `release.yml` top-level.)

### `RELEASE_PAT` secret

Two workflows authenticate with the repo secret `RELEASE_PAT` (a fine-grained Personal Access Token), each because the default `GITHUB_TOKEN` doesn't trigger downstream workflows:

- **`release-please.yml`** opens the version-bump PR and, on merge, tags the commit + cuts the GitHub Release. PRs opened with `GITHUB_TOKEN` don't trigger `pull_request` workflows (CI, DCO, Conventional Commits check), and a Release cut with `GITHUB_TOKEN` wouldn't fire `release.yml`'s `release` trigger — so release-please needs the PAT for both.
- **`release-please-lock.yml`** pushes the lockfile-sync commit to the bot branch. Pushing with `GITHUB_TOKEN` wouldn't re-run the PR's `pull_request` checks, leaving the synced lockfiles unvalidated.

The PAT needs three scopes (fine-grained) — or `repo` on a classic PAT:

| Scope | Why |
|---|---|
| **Contents: read and write** | Release branch commits + tag + GitHub Release (`release-please.yml`); lockfile-sync commits (`release-please-lock.yml`) |
| **Pull requests: read and write** | Open + maintain the release PR (`release-please.yml`). The workflow's block-level `permissions:` doesn't help PATs — only `GITHUB_TOKEN`. |
| **Issues: read and write** | release-please manages its own `autorelease: pending` / `autorelease: tagged` labels through the Issues API |

Rotate on the standard cadence and update the `RELEASE_PAT` secret under repo Settings → Secrets and variables → Actions.

### Cloudflare Pages deploy hook

The `rebuild-site` job in `release.yml` curls a Cloudflare Pages
deploy hook so the marketing site rebuilds against the freshly
published changelog (otherwise the hero pill and roadmap teaser keep
showing the previous version until the next `site/**` push).

Capture the hook from the Cloudflare Pages dashboard → site →
**Settings → Build & deployments → Deploy hooks**, and store the
returned URL as the repo secret `CF_PAGES_DEPLOY_HOOK`. The job is
`continue-on-error: true` and warns (without failing) if the secret
is unset, so the release itself is never blocked on the rebuild.
