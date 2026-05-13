# ADR 0010: Single unified GitHub Project with per-area views

- **Status:** Accepted
- **Date:** 2026-05-12
- **Tags:** project-management, planning

## Context

The roadmap originally split tracking work across five area-specific
GitHub Projects v2, one per `area:*` label:

- [#6 Lookup engine](https://github.com/users/mgzwarrior/projects/6)
- [#7 Output artifacts](https://github.com/users/mgzwarrior/projects/7)
- [#8 Cache & persistence](https://github.com/users/mgzwarrior/projects/8)
- [#9 Web UI / API](https://github.com/users/mgzwarrior/projects/9)
- [#10 DevOps & release](https://github.com/users/mgzwarrior/projects/10)

The split was a direct translation of the codebase's area boundaries
into project boundaries. Each project had its own Status field, its
own items, and (mostly default-off) workflows. The premise was that
per-area ownership would scale better than one board for everything —
each area lead could curate their own board without stepping on the
others.

In practice, the layout made cross-area views impossible. Projects v2
has no native "merge multiple projects" mechanism: an item lives in
exactly one project, fields don't compose across projects, and any
Kanban that spans areas can only be reconstructed by hand. The pain
showed up everywhere a question naturally cut across areas: release
planning (a V1 milestone has work in every area), day-to-day
"what's open across the whole repo," and PR triage for work that
touched more than one area.

Beyond the cross-cutting blind spot, the five-board layout multiplied
small maintenance costs: five workflow configurations to keep in sync,
five auto-add rules, five Status fields with slightly different
ordering. Each was cheap; the aggregate wasn't.

This ADR was filed after the migration completed, not before. The
original five-board layout was never itself recorded in an ADR; this
ADR documents both the new structure and — for posterity — what came
before.

## Decision

Consolidate the five area-specific projects into a single
[`mgz-pkmn`](https://github.com/users/mgzwarrior/projects/11) project.
Recover per-area focus through saved board views filtered by the
existing `area:*` labels:

- **All** (board, no filter, group by Status) — the cross-area Kanban
  the old layout couldn't produce.
- **Lookup / Outputs / Cache / Web / API / DevOps** (board, filter
  `label:"area:<name>"`, group by Status) — functionally equivalent
  to the five old per-area boards.
- **Milestones** (table) for release planning.
- **Roadmap** (roadmap layout) for time-on-axis views.

Use the existing `area:*` labels rather than introducing a custom
`Area` single-select project field. The labels were already
universally applied (verified all 68 migrated items carried one),
they work outside the Project view (issue search, README badges,
GitHub's native label filter), and a redundant single-select field
would have created drift risk for no capability the views couldn't
deliver.

Project workflows on the unified project:

- Auto-add `repo:mgzwarrior/mgz-pkmn is:open` items.
- Item closed → Status `Done`.
- PR merged → Status `Done`.
- Item reopened → Status `Todo`.
- Auto-archive items closed > 2 weeks.

The five old projects are closed (not deleted) to preserve history.

## Consequences

- Cross-area views become first-class. The default "All" board shows
  every open item in the repo; release planning uses the Milestones
  table without reconciling five sources.
- Per-area focus is preserved via saved views, with the same
  Status-grouped Kanban shape contributors are used to.
- A single set of workflow rules to maintain. Auto-add + auto-archive
  apply uniformly.
- Adding a new area is now "add an `area:*` label + a saved view,"
  not "spin up a new project and rewire automation."
- The unified project mixes work at different lifecycle stages (V1
  polish + V2 architectural items). Filtering relies on the
  `version:*` label being applied consistently — a discipline the
  old layout didn't enforce. The roadmap doc already requires it.
- The `area:*` label remains load-bearing: items without one fall
  through every area view. Worth a CI check or periodic audit if
  drift starts to show up.
- View URLs changed. Any external link to the old project boards
  (#6–#10) resolves to a closed project.
  [`docs/roadmap.md`](../roadmap.md) is the canonical entry point and
  has been updated; ad-hoc links elsewhere will need rewriting as
  they surface.

## Alternatives considered

- **Keep the five-project layout.** Preserves the per-area mental
  model but leaves the cross-area gap unsolved and pays the
  five-workflows tax forever.
- **Custom `Area` single-select project field instead of `area:*`
  labels.** Tighter coupling between Project state and the field,
  and supports project-only automations keyed on the field. Loses
  the label's reach outside Projects (issue search, badges, native
  label filter) and adds a second source of truth to keep in sync.
  Not worth the cost when labels already cover every view we need.
- **One project per milestone (`v1.0`, `v2.0`, …).** Solves
  release-planning cross-area views but reintroduces the original
  problem for everyday "what's open in area X" questions. Strictly
  worse than the chosen layout.
