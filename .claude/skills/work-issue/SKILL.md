---
name: work-issue
description: Pick up a mgz-pkmn GitHub issue and drive it through the full contributor loop — selection, in-flight check, branch, implement, local gate, PR with mirrored metadata, cross-agent review trigger. Invoke as `/work-issue <issue number>` to work a specific issue, or `/work-issue` with no argument to select the highest-value unclaimed issue. Use when the user says "work issue N", "pick up an issue", "grab the next issue", "what should we work on next", or similar.
---

# Work an issue end to end

You take one GitHub issue from selection to an open PR with cross-agent review triggered. The implement→PR loop itself is defined once in [CLAUDE.md](../../../CLAUDE.md) — this skill owns the entry point (selection and claim-checking) and then follows that loop; it does not restate it. Read CLAUDE.md before starting if it isn't already in context.

## Step 1 — Resolve the target issue

**If the user gave an issue number**, fetch it and sanity-check the labels:

```bash
gh issue view <N> --repo mgzwarrior/mgz-pkmn --json number,title,body,labels,milestone,state
```

- If `state` is not `OPEN`, stop — the issue is already resolved or was closed as not-planned; tell the user and don't branch or implement anything.
- If it's labelled `wip`, `blocked`, or `needs-discussion`, stop and tell the user why that label blocks pickup (see CLAUDE.md Step 1) — don't proceed without their explicit go-ahead.
- If the issue is ambiguous and intent can't be inferred from the body plus linked context, leave a clarifying comment on the issue and report back instead of guessing.

**If no issue number was given**, run the selection filter:

```bash
gh issue list --repo mgzwarrior/mgz-pkmn --state open --limit 500 --json number,title,labels,milestone \
  | jq '.[] | select(.labels | map(.name) | (contains(["wip"]) or contains(["blocked"]) or contains(["needs-discussion"])) | not)'
```

Rank the survivors by CLAUDE.md's priority order — bugs before features, smaller well-scoped issues before large ones, `area:*` label consistent with the current milestone — and propose the single best candidate to the user with a one-line rationale before starting. If they're away (background session), proceed with the top pick and note the choice.

## Step 2 — Check what's already in flight

An issue with an existing branch or PR is someone else's work in progress:

```bash
gh pr list --repo mgzwarrior/mgz-pkmn --search "<N>" --state all --json number,title,state
git ls-remote origin | grep "<N>-"
```

If either hits, leave a comment on the issue noting the existing work and go back to Step 1 for the next candidate (or stop, if the user named this issue specifically — they may know something you don't; ask).

## Step 3 — Run the CLAUDE.md loop

From here, CLAUDE.md Steps 2–6 are the process, verbatim:

1. **Understand the codebase** and confirm `make check` is green before touching anything (CLAUDE.md Step 2).
2. **Branch** as `<issueNumber>-<shortDescription>` (Step 3). Use a worktree if other sessions share this checkout.
3. **Implement** — focused, one issue one PR, `make fix` before committing, Conventional Commits subject, `-s` sign-off (Step 4).
4. **Open the PR** mirroring the issue's labels/milestone/project, plus exactly one `agent:<name>` label, with What / Why / How to verify in the body (Step 5).
5. **Trigger cross-agent review** from the pairing table and confirm CI goes green (Steps 5–6). Poll for the reviewer's inline comments (1–4 minutes), address them, reply to each thread with the fixing commit sha, and resolve the threads before reporting done.

Do **not** merge the PR — the human does that.

## Boundaries

- One issue per invocation. If implementation reveals adjacent work, file a new issue rather than widening the branch.
- Every change traceable to an issue: if the user asks for something with no issue, open one first (CLAUDE.md Step 1).
- If `make check` was already red before your change, report the pre-existing failures and factor them in — never pile new failures on top.
