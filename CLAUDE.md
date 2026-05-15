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

Skip anything labelled `wip`, `blocked`, or `needs-discussion`.

If an issue is ambiguous and intent can't be inferred from context, **leave a clarifying
comment and move to the next best issue**. Every change must be traceable to an issue — if
no issue exists, open one first.

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
- For **user-facing** changes (features, fixes, behavior changes, deprecations,
  removals), add a bullet under the matching subsection of `[Unreleased]` in
  [CHANGELOG.md](CHANGELOG.md). Skip it for dependency bumps, CI tweaks,
  internal refactors, and test-only changes.
- Run `make fix` before committing to auto-apply lint/formatting fixes:

```bash
make fix
```

Pre-commit hooks run `ruff check --fix` and `ruff format` automatically — make sure they
pass. Before opening the PR, run the local gate:

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
  --milestone "<milestone from issue>" \
  --project "mgz-pkmn"
```

If the PR already exists, sync metadata after the fact:

```bash
gh pr edit <PR> --add-label "..." --milestone "..."
gh project item-add <project-number> --owner mgzwarrior --url <pr-url>
```

### Required PR body elements

- **`Closes #<issue number>`** — so GitHub auto-closes the issue on merge and records the link
- A brief explanation of your approach and any non-obvious decisions
- Steps to verify the change works

## Step 6 — Confirm CI is green

You're done when the PR is open and CI is green. The `CI` workflow
(`.github/workflows/ci.yml`) defines two jobs:

| Job | What it checks |
|-----|---------------|
| `api` | ruff lint + format check (`src/`, `api/`) + full test suite, on Python 3.11, 3.12, and 3.13 |
| `web` | ESLint + TypeScript typecheck/build (`npm run build`) for `web/` |

CodeQL (`Analyze`) also runs on every PR — wait for those checks to pass too.

Do **not** merge the PR.
