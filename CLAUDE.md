# mgz-pkmn Contributor Workflow

You are a senior software engineer on the **mgz-pkmn** project — a Pokemon TCG card-show
prep CLI written in Python (repo: `mgzwarrior/mgz-pkmn`).

## Step 1 — Pick the right issue

Review all open GitHub issues:

```bash
gh issue list --repo mgzwarrior/mgz-pkmn --state open --json number,title,labels,milestone \
  | jq '.[] | select(.labels | map(.name) | (contains(["wip"]) or contains(["blocked"]) or contains(["needs-discussion"])) | not)'
```

Select the **single highest-value issue** using this priority order:
1. Bugs before features
2. Smaller, well-scoped issues before large ones
3. Issues whose `area:*` label is consistent with the current milestone

Skip anything labelled:

- [`wip`](https://github.com/mgzwarrior/mgz-pkmn/labels/wip) — already being worked on; don't pick up
- [`blocked`](https://github.com/mgzwarrior/mgz-pkmn/labels/blocked) — waiting on an external dependency or decision
- [`needs-discussion`](https://github.com/mgzwarrior/mgz-pkmn/labels/needs-discussion) — scope or design not yet aligned; raise the question in the issue or [Discussions](https://github.com/mgzwarrior/mgz-pkmn/discussions) rather than starting work

If an issue is ambiguous and intent can't be inferred from context, **leave a clarifying
comment and move to the next best issue**. Every change must be traceable to an issue — if
no issue exists, open one first.

## Step 1.5 — Check what's already in flight

mgz-pkmn leans on GitHub itself as the active-work board — there is no separate
task file. Before starting:

```bash
gh pr list --repo mgzwarrior/mgz-pkmn --search "<issue number>"
git ls-remote origin | grep "<issue number>-"
```

If a branch or PR already references the issue, leave a comment and pick another
issue instead of starting parallel work. See [.agent-workflow.md](.agent-workflow.md)
for the shared AI Pit Crew loop.

## Step 2 — Understand the codebase before touching it

```bash
# Get your bearings
find src/mgz_pkmn -type f -name "*.py" | sort
```

Read enough of the source to understand where your change belongs. Don't skip this — it's
the difference between a focused patch and a messy one that breaks things.

Also confirm the repo is green before you start:

```bash
make check
```

If `make check` is already failing, note the failures and factor them into your approach
(don't introduce *more* failures; fixing existing ones is fine if they're in scope).

## Step 3 — Create a branch

Branch name format: `<issueNumber>-<shortDescription>`

```bash
git checkout -b 42-fix-pricing-scraper
```

No other format is acceptable. Keep the description short (2–4 words, kebab-case).

## Step 4 — Implement

- Match existing patterns and style. Don't introduce new dependencies without a strong reason.
- Keep the change **focused**: one issue, one PR.
- Prefer cross-agent review: implementation by one AI tool should be reviewed by
  a different AI tool when practical, then approved by the human.
- For **user-facing** changes (features, fixes, behavior changes, deprecations,
  removals), add a bullet under the matching subsection of `[Unreleased]` in
  [CHANGELOG.md](CHANGELOG.md). Skip it for dependency bumps, CI tweaks,
  internal refactors, and test-only changes.
- For **deployment-affecting** changes, update [render.yaml](render.yaml) in the
  same PR so the hosted-demo blueprint stays in sync with the code. The blueprint
  is the canonical declaration of what the deployed API needs — keeping it in the
  same PR means a self-contained revert and avoids a "code shipped, deploy
  broken" gap on the next sync. This applies to:
  - **New env vars the API reads** (auth provider credentials, new SMTP settings,
    feature flags) — add an entry with `sync: false` for secrets, inline `value:`
    for non-secret toggles, and a comment pointing at the code path that reads
    it. Match the existing block's pattern.
  - **Renamed or removed env vars** — update or delete the entry; a stale entry
    that no longer maps to code is worse than no entry at all.
  - **New persistent state** (disk paths, mount sizes) or **new health-check
    requirements** — adjust the `disk:` / `healthCheckPath:` blocks accordingly.
  - **External portal config** that the deploy depends on (Apple Developer
    portal, Resend domain verification, etc.) — note the human runbook step in
    the relevant env-var comment so the next deploy knows what's required
    outside the blueprint itself.
- Run `make fix` before committing to auto-apply lint/formatting fixes:

```bash
make fix
```

Pre-commit hooks run `ruff check --fix` and `ruff format` automatically — make sure they
pass.

**Every commit subject must follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).** The CI workflow `Conventional Commits` and the local gitlint commit-msg hook both enforce the shape `<type>(<scope>)?!?: <subject>`. Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `revert`, `chore`, `ci`, `test`, `build`, `style`. Use the project's existing prefixes (`web`, `api`, `cli`, `docs`, `design`, `site`) as the scope. Append `!` after the scope (`feat(api)!:`) for a breaking change — release-please reads it and bumps the major version. Subject line max 100 chars, lowercase first char after the colon, no trailing period, imperative mood. See [docs/contributing.md#commit-messages](docs/contributing.md#commit-messages) for the full guide and examples.

**Sign off every commit with `-s`.** This project runs a DCO check on every PR; the
`DCO` job fails when any non-merge commit is missing a `Signed-off-by:` trailer (the
check becomes merge-blocking once the maintainer adds it to branch protection's
required-checks list). Always commit with `git commit -s -m "..."`; if you forget,
recover with `git commit --amend --no-edit -s` (last commit) or
`git rebase --signoff origin/main` (all PR commits), then force-push. If `make install`
or `make install-hooks` has been run, the `commit-msg` pre-commit hook auto-appends the
sign-off so `-s` becomes optional locally. See
[docs/contributing.md](docs/contributing.md#signing-off-your-commits).

Before opening the PR, run the local gate:

```bash
make check   # ruff lint + format check + Python tests + web ESLint
```

`make check` does not cover the web typecheck/build (`npm run build`) that CI runs — if
you've touched `web/`, run it separately:

```bash
cd web && npm run build
```

All CI checks must be green before opening the PR.

## Step 5 — Open the PR

The PR body is the implementation summary — put What / Why / How to verify there.
First, pull the issue's labels, milestone, and project assignment:

```bash
ISSUE=<issue number>
REPO=mgzwarrior/mgz-pkmn
gh issue view $ISSUE --repo $REPO --json labels,milestone,projectItems
```

Then create the PR, mirroring everything from the issue:

```bash
gh pr create \
  --title "<concise summary>" \
  --body "$(cat <<'EOF'
Closes #<issue number>

## What

<brief description of the change>

## Why

<explain the problem being solved>

## How to verify

<steps to confirm the fix/feature works>
EOF
)" \
  --label "<labels from issue>" \
  --label "agent:claude" \
  --milestone "<milestone from issue>" \
  --project "mgz-pkmn"
```

The `agent:<name>` label identifies the author agent (`agent:claude`, `agent:codex`, `agent:copilot`) and replaces the old `[Agent]:` prefix convention. Apply exactly one per PR.

If the PR already exists, sync metadata after the fact:

```bash
gh pr edit <PR> --add-label "..." --milestone "..."
gh project item-add <project-number> --owner mgzwarrior --url <pr-url>
```

### Required PR body elements

- **`Closes #<issue number>`** — so GitHub auto-closes the issue on merge and records the link
- A brief explanation of your approach and any non-obvious decisions
- Steps to verify the change works

### Trigger the cross-agent reviewer

Pick a reviewer from the [pairing table in .agent-workflow.md](.agent-workflow.md#5-mark-ready-for-review) and fire the trigger right after `gh pr create`:

| Reviewer | Trigger |
| --- | --- |
| Codex | `gh pr comment <PR> --body "@codex review"` |
| Copilot | `gh pr edit <PR> --add-reviewer Copilot` (paused via Copilot credits through 2026-07-01; skip until then) |
| Claude | `gh pr comment <PR> --body "@claude review"` (via [`.github/workflows/claude-review.yml`](.github/workflows/claude-review.yml); see [ADR-0024](docs/adr/0024-claude-review-github-action.md)) |

## Step 6 — Confirm CI is green

You're done when the PR is open and CI is green. The `CI` workflow
(`.github/workflows/ci.yml`) defines three jobs, and `DCO`
(`.github/workflows/dco.yml`) and `Conventional Commits`
(`.github/workflows/conventional-commits.yml`) run separately on PRs:

| Job | What it checks |
|-----|---------------|
| `api` | ruff lint + format check (`src/`, `api/`) + full test suite, on Python 3.11, 3.12, and 3.13 |
| `web` | ESLint + TypeScript typecheck/build (`npm run build`) for `web/` |
| `site` | Astro build for the marketing site (`site/`) |
| `DCO` | Every non-merge PR commit carries a well-formed `Signed-off-by:` trailer (advisory until added to branch protection's required-checks list) |
| `Conventional Commits` | Every non-merge PR commit subject matches `<type>(<scope>)?!?: <subject>` per [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). release-please reads these to draft the next version-bump PR. |

CodeQL (`Analyze`) also runs on every PR — wait for those checks to pass too.

Do **not** merge the PR.
# Design system

mgz-pkmn uses the **tropical** brand design system. Every color, spacing,
radius, shadow, and font in the product comes from design tokens — never from
hardcoded values. This applies to humans and to AI agents equally.

## Source of truth

- **`design/tokens/colors_and_type.css`** is the canonical token file. It
  defines the full palette (`sun`, `palm`, `coconut`, `sand`, `husk`, `ember`,
  `sky`), semantic tokens (`--bg-*`, `--fg-*`, `--border-*`, status colors),
  the type scale, spacing, radii, shadows, and motion tokens — plus the
  `[data-theme="dark"]` palette.
- The Tailwind v4 `@theme` blocks in `site/src/styles/global.css` and
  `web/src/index.css` are **derived** from that file. **Do not hand-edit them.**
  Change a token in `colors_and_type.css`, then regenerate.

## Hard rules

- **No raw hex colors.** Use a token: `var(--palm-500)` or the Tailwind
  utility (`text-palm-500`). Never `#4A8B3B`. Exceptions: brand-mark SVGs
  inside [`web/src/components/providerIcons.tsx`](web/src/components/providerIcons.tsx)
  carry third-party brand hexes (Discord, Google, Apple) that have to stay
  exact for trademark reasons.
- **No raw px values** for spacing/size. Use `--space-*` / `--size-*` tokens
  or Tailwind spacing utilities. Tailwind arbitrary values (`text-[11px]`,
  `w-[min(560px,92vw)]`) are fine when no token fits.
- **Fonts are fixed**: Bricolage Grotesque (display), DM Sans (body),
  JetBrains Mono (mono). No other `font-family`.
- **Import design-system components from the index**, never deep component
  internals.

The deep-import rule is enforced by `.oxlintrc.json` and `make check` will
fail on violations. The hex/px/font rules are currently agent-and-reviewer
enforced — oxlint doesn't yet implement `no-restricted-syntax`, so the
config keeps the structural rules and leaves the syntactic ones documented
here for the next agent that picks them up (likely as an eslint preset with
a tight allowlist).

## Voice & copy (see `design/DESIGN_SYSTEM.md` for the full guide)

- One voice, four pillars: **plainspoken · on your side · quietly
  knowledgeable · warm to everyone**. Tone flexes by moment (empty / loading /
  success / error / price / destructive).
- **Sentence case** for all UI. Title Case only for product/source names
  (`PriceCharting`, `TCGdex`, `pokemontcg.io`).
- **Contractions, second person** ("you", never "the user").
- **Locked terms:** Look up (not Search/Submit), want-list (not wishlist),
  comps, market, walk a set.
- **Never ships:** unlock, supercharge, powerful, seamless, revolutionary,
  effortless, game-changing, next-gen.
- **No emoji in product copy.** The single exception is the 🌴 Exeggutor
  Easter egg.

## Visual reference

`design/styleguide/` contains rendered cards for every token group, the
voice guide, and component examples. `design/INTEGRATION.md` is the migration
playbook from the old zinc/blue theme.

## When changing anything visual

1. Reach for an existing token first. If none fits, add it to
   `colors_and_type.css` (don't inline a one-off value).
2. Run `make check` — the adherence linter blocks restricted imports, while
   reviewers still enforce the documented raw-value rules.
3. Keep `site/` and `web/` in visual sync; both consume the same tokens.
