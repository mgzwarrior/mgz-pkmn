---
name: repo-analysis
description: Surface maintainability hotspots in any repo — largest Python files by LOC, radon cyclomatic complexity (D-rank+), radon maintainability index (B-rank+), and the latest codecov context. Use when the user asks for "repo analysis", "maintainability check", "where's the worst code", "complexity hotspots", or wants to find the next refactor target.
---

# Repo analysis: find the next refactor target

You produce a one-page maintainability report on a Python codebase. The output looks like the one that drove [issue #387](https://github.com/mgzwarrior/mgz-pkmn/issues/387): a short LOC table, a complexity hotspots block grouped by rank, a sub-A maintainability list, and a one-paragraph recommendation naming the single most valuable refactor.

This skill is repeatable: it should work on `mgz-pkmn` and on any other Python repo with no manual setup beyond a clean checkout.

## Step 1 — Sanity-check the working directory

```bash
test -d .git || { echo "not a git repo — run from a checkout"; exit 1; }
```

If the user passed a path argument, `cd` there first. Otherwise operate on the current working directory.

## Step 2 — Install radon if it isn't already

```bash
uv pip install radon >/dev/null 2>&1 || pip install radon >/dev/null 2>&1
```

Prefer `uv` when the repo has a `.venv` or `pyproject.toml` referencing uv; fall back to `pip` for non-uv repos.

## Step 3 — Largest production files by LOC

Production source only — exclude tests, vendored deps, build output, and Python caches.

```bash
find . -type f -name '*.py' \
  -not -path './tests/*' \
  -not -path '*/test_*.py' \
  -not -path './.venv/*' \
  -not -path './node_modules/*' \
  -not -path './dist/*' \
  -not -path '*/__pycache__/*' \
  -not -path '*/.tox/*' \
  | xargs wc -l \
  | sort -nr \
  | head -16
```

Drop the `total` line. Keep the top 10.

## Step 4 — Cyclomatic complexity (D-rank or worse)

```bash
uv run radon cc . -s -a -n C \
  --exclude '.venv/*,node_modules/*,dist/*,build/*,__pycache__/*'
```

`-n C` filters to C-rank and worse so the output stays readable. Group findings by rank in the report (F → E → D → C). Note each function's file, name, line, and CC number.

## Step 5 — Maintainability index (B-rank or worse)

```bash
uv run radon mi . -s -n B \
  --exclude '.venv/*,node_modules/*,dist/*,build/*,__pycache__/*'
```

Anything reported is below A. Note the file and its MI score. A short list (≤3 files) usually means the codebase is healthy overall and one file is dragging it down.

## Step 6 — Latest codecov context (best-effort)

If the repo has a GitHub remote and `gh` is configured, pull the most recent codecov comment for color on which file is bleeding coverage:

```bash
REMOTE=$(gh repo view --json owner,name -q '{owner: .owner.login, name: .name}' 2>/dev/null)
if [ -n "$REMOTE" ]; then
  gh pr list --state merged --limit 5 --json number,title \
    | jq -r '.[].number' \
    | while read PR; do
        gh pr view "$PR" --comments --json comments \
          | jq -r '.comments[] | select(.author.login == "codecov[bot]") | .body' \
          | head -40
        break
      done
fi
```

Skip this step silently if `gh` isn't installed or the repo has no remote — codecov context is a nice-to-have, not a blocker.

## Step 7 — Render the report

Use this exact structure so the output is comparable across runs and across repos:

```markdown
# Repo analysis · <repo name> · <YYYY-MM-DD>

## Largest production files by LOC

| File | LOC |
|------|----:|
| src/<path>.py | 1,739 |
| … | … |

## Complexity hotspots (D-rank or worse)

### F-rank (CC ≥ 41)
- `<file>:<line>` — `<function_name>` — CC <n>

### E-rank (CC 31-40)
- …

### D-rank (CC 21-30)
- …

## Maintainability index below A

- `<file>` — MI <n.nn> (rank)

## Recommended next refactor

<One-paragraph recommendation that names the single highest-value target. Justify it on the data above (size, rank, blast radius). If a single file rolls up multiple problems — large *and* F-rank function *and* sub-A MI *and* codecov-cold — that's the obvious winner. If the top LOC file and the top CC file are different files, prefer the one whose split also lowers MI.>
```

## Step 8 — Hand off

Print the report to stdout. If the user is in an interactive session, end with: "Want me to open an issue tracking the recommended refactor, or just shelve this for later?"

If they say yes, the issue body should follow the same `mgz-pkmn` issue conventions documented in [CLAUDE.md](../../../CLAUDE.md): include the analysis table verbatim, link to this skill, and label it `type:chore` + the appropriate `area:*` label.

## Cross-references

- [`make complexity`](../../../Makefile) — the recurring CI gate that this skill's analysis feeds. After you ship a refactor surfaced by this skill, shrink the Makefile's `RADON_CC_EXCLUDE` / `RADON_MI_EXCLUDE` allowlist so the file is now actively defended.
- [Issue #387](https://github.com/mgzwarrior/mgz-pkmn/issues/387) — the original chat-scrollback analysis this skill captures.
