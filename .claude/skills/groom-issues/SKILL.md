---
name: groom-issues
description: Run a full project-grooming pass over the mgz-pkmn GitHub backlog — analyze every open issue for overlap and clear requirements, review and author milestone descriptions, validate area/type/version/epic labels, promote issues into epics, flag superseded items, and assign issues to milestones. Proposes a plan for human approval before mutating anything. Use when the user asks to "groom the issues", "do a grooming pass", "triage the backlog", "tidy the milestones", or similar.
---

# Project grooming pass

You run the recurring backlog-grooming pass that keeps mgz-pkmn's GitHub issues, labels, and milestones coherent. The canonical exemplar — the bar to match — is the manual pass captured in [issue #415](https://github.com/mgzwarrior/mgz-pkmn/issues/415): every open issue ended up carrying an `area:*`, `type:*`, `version:*`, a milestone, and (where applicable) `epic:*` + `specialty:*`; superseded items were closed; stale ones were re-scoped or commented; and the milestones told a clear release story.

This skill is **propose-then-apply**. The human owns product direction, prioritization, and milestone shape (see [.agent-workflow.md](../../../.agent-workflow.md) — "Human sets direction → one agent implements → a different agent reviews → human approves"). You do the analysis and present a grooming plan; you do **not** touch GitHub until the user approves it. When in doubt about where an issue belongs or whether to close it, leave it in the plan as a flagged question rather than acting.

## Step 1 — Snapshot the live backlog

Don't groom from cached context — issues and milestones are shared mutable state that other agents and the human may have changed since this session started. Pull a fresh snapshot.

```bash
REPO=mgzwarrior/mgz-pkmn

# Every open issue with the fields grooming decisions hinge on
gh issue list --repo "$REPO" --state open --limit 400 \
  --json number,title,labels,milestone,body,createdAt,updatedAt > /tmp/groom-issues.json

# Milestones (open + closed) with descriptions and counts
gh api "repos/$REPO/milestones?state=all&per_page=100" \
  --jq '.[] | {number, title, state, description, open_issues, closed_issues, due_on}'

# The label vocabulary you must groom *into* — don't invent labels
gh label list --repo "$REPO" --limit 100
```

Note the four label families grooming relies on: **`area:*`** (lookup, outputs, cache, devops, web, site, design), **`type:*`** (feature, bug, docs, test, chore), **`version:*`** (v1, v1.x, v2), and the cross-cutting **`epic:*`** / **`specialty:*`** families. [docs/roadmap.md](../../../docs/roadmap.md) is the navigator that maps milestones to the release thesis — read it before deciding what belongs where.

## Step 2 — Analyze issues for overlap and clear requirements

Walk every open issue. For each, judge two things:

1. **Requirements clarity.** Can a contributor pick this up and know when it's done? A good issue has a concrete outcome and acceptance criteria. If it's a vague wish ("improve search") with no testable definition of done, flag it — propose either a tightened scope (draft the acceptance criteria) or a `needs-discussion` label with a clarifying comment.
2. **Overlap / duplication.** Group issues by theme and surface. Two issues describing the same change are duplicates — propose closing the lesser one with a `duplicate` label and a pointer to the survivor. Two issues that are *facets* of one larger effort belong under an epic (Step 4), not merged. An issue whose premise a later decision (an ADR, a shipped feature) has overtaken is **superseded** — propose closing it with a comment naming what replaced it, the way #415 superseded the original #39 framing.

Produce, in working notes, a per-issue verdict: `keep-as-is` / `clarify` / `dedupe→#N` / `supersede` / `re-scope`. This is the raw material for the plan in Step 5.

## Step 3 — Review milestones and author descriptions

Pull each milestone's description from the Step 1 snapshot. The release story should be legible from the descriptions alone — a reader should be able to tell what thesis each minor version carries.

- **Well-described milestones** (e.g. v2.0.0's "structured + persistent + identity" thesis): respect them. Fit issues to the existing scope; don't redraw the boundary without flagging it to the human.
- **Thin or empty descriptions** (milestones with no description, or a one-liner that doesn't scope the work): this is where you add value. Propose a description that picks a **reasonably scoped, coherent set of work for that minor release** — a single theme or a small number of related themes, not a grab-bag. Match the voice and shape of the existing good descriptions (v2.0.0, v2.1.0): lead with the thesis, then enumerate the concrete surfaces. Keep it tight; the milestone description renders on the roadmap badges and is the at-a-glance scope contract.

Respect semver and the project's cut triggers (see the roadmap's "Versioning policy" — most additive work can ship in the v1.x cadence; a true v2 needs the plugin-contract trigger). Don't propose moving additive work into a major bump just because the v2.0.0 milestone is the current staging area.

If milestone *shape* needs to change (a new milestone, a renamed one, resequencing), that's a direction call — put it in the plan as an explicit proposal with rationale, never a silent edit.

## Step 4 — Label and epic hygiene, triage sweep

With verdicts and milestone scopes in hand, sweep the whole backlog for label correctness:

- Every open issue should carry exactly one `area:*`, one `type:*`, and one `version:*`. Propose adds for any that are missing and corrections for any that are wrong (a "fix the parser" issue mislabeled `type:feature` should be `type:bug`).
- **Epics**: issues that are facets of a tracked epic (`epic:ebay`, `epic:tcgplayer`, `epic:query-dsl`, `epic:persistence-growth`, `epic:flavor-uplift`, `epic:library`, `epic:vendor-vision`) get the matching `epic:*` label and, where the epic has an umbrella tracking issue, get added to that issue's task list. Don't create new epic labels or umbrellas unless the human asks — that's a direction call.
- **`specialty:*`** is the cross-cutting skill tag (backend, frontend, devops, security, data, design) — apply where it helps a contributor self-select.
- Respect the skip labels: never auto-act on `wip`, `blocked`, or `needs-discussion` issues beyond noting their state. Don't move a `blocked` issue's milestone without flagging why.

## Step 5 — Build the grooming plan (the proposal)

Consolidate everything into one reviewable plan. This is the artifact the human approves — make it scannable, grouped by action, with every mutation traceable to a reason. Suggested shape:

```markdown
# Grooming plan · <YYYY-MM-DD>

## Milestone descriptions to add / revise
- **v1.7.0** — propose: "<drafted description>"  (currently empty)
- ...

## Issue → milestone moves
| # | Title | From | To | Why |
|---|-------|------|----|-----|
| 412 | ... | (none) | v1.7.0 | additive lookup work, fits v1.7 thesis |

## Label corrections
| # | Add | Remove | Why |
|---|-----|--------|-----|

## Epic promotions
- #NNN → `epic:ebay` + add to #<umbrella> task list

## Close / supersede / dedupe
- #NNN — supersede (replaced by <ADR / issue / shipped feature>); comment + close
- #NNN — duplicate of #MMM; label `duplicate` + close

## Needs human decision (not acting without a call)
- #NNN — <ambiguity or direction question>
```

Present this plan and **stop**. Ask the user to approve, amend, or reject — section by section if it's large. Everything under "Needs human decision" stays untouched until they rule on it.

## Step 6 — Apply on approval

Only after the user approves, execute the plan with `gh`. Apply in dependency order (descriptions first, then labels, then moves, then closes) so the state is coherent if you stop partway. Examples:

```bash
REPO=mgzwarrior/mgz-pkmn

# Milestone description (PATCH by milestone number)
gh api -X PATCH "repos/$REPO/milestones/11" \
  -f description="<approved description>"

# Assign / move an issue's milestone + fix labels in one edit
gh issue edit <N> --repo "$REPO" \
  --milestone "v1.7.0" --add-label "area:lookup" --add-label "type:feature"

# Epic promotion
gh issue edit <N> --repo "$REPO" --add-label "epic:ebay"

# Supersede / dedupe: comment first (record why), then close
gh issue comment <N> --repo "$REPO" \
  --body "Superseded by <link> — closing. <one-line reason>."
gh issue close <N> --repo "$REPO"
```

Apply only what was approved. If the user amended a section, use their amended version, not your original proposal. Skip anything still sitting under "Needs human decision".

## Step 7 — Verify and report

After applying, re-pull the snapshot from Step 1 and confirm the end state matches the approved plan, echoing #415's verification bar:

- Every open issue carries `area:*`, `type:*`, `version:*`, a milestone, and (where applicable) `epic:*` + `specialty:*`.
- No open duplicates of a closed survivor remain.
- Each touched milestone has a description that scopes its release.
- Epic umbrella task lists link to the issues you promoted.

Report a short diff of what changed (counts: N issues milestoned, M relabeled, K closed, descriptions on which milestones) and list anything left under "Needs human decision" so it isn't lost. This skill mutates GitHub state, not the repo — there's no PR and nothing to `make check`; the grooming itself is the deliverable.

## Behaviours to avoid

- Don't mutate GitHub before the user approves the plan — propose first, always.
- Don't invent labels, milestones, or epic umbrellas. Groom *into* the existing vocabulary; new families are a human direction call.
- Don't act on `wip` / `blocked` / `needs-discussion` issues beyond noting state.
- Don't redraw a well-described milestone's scope silently — flag boundary changes as proposals with rationale.
- Don't push additive work into a major version bump; respect the roadmap's semver cut triggers.
- Don't delete the historical record — supersede and dedupe by closing **with a comment that names the replacement**, never silently.
- Don't groom from stale context — re-snapshot at the start (Step 1) and at verification (Step 7).
