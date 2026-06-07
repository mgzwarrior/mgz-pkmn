# Tasks

Active work board for mgz-pkmn.

GitHub issues, milestones, and [docs/roadmap.md](docs/roadmap.md) own planned work.
This file only tracks work that is actively being implemented, reviewed, blocked, or
recently completed by an AI-assisted contributor.

Always re-read this file immediately before relying on task status or editing it.
See [.agent-workflow.md](.agent-workflow.md) for the full workflow.

---

## In Progress

_No tasks in progress._

## Ready For Review

- [Claude]: Auto-close milestone after GitHub Release tag is cut
  - Issue: #404
  - Branch: 404-close-milestone-on-release
  - Review assigned to: Codex or Copilot
  - Implementation notes:
    - Added a `Close matching milestone` step at the end of `github-release` in `.github/workflows/release.yml`. Looks up an open milestone whose title equals the pushed tag (`vX.Y.Z`) via `gh api`, then PATCHes it to `state=closed`. Emits a `::notice::` and exits 0 when no matching open milestone exists, so re-runs (and tags without a milestone) are safe.
    - Granted the job `issues: write` (milestones live under the issues API); kept the existing `contents: write` for the release publish step.
    - Checks run: `make check` (green). Skipped: end-to-end release run — only verifiable on a real tag push.

- [Claude]: Account panel — SPA UI for #491 slice 3
  - Issue: #491
  - Branch: 491-account-panel
  - Review assigned to: Codex or Copilot
  - Implementation notes:
    - New `AccountPanel` dialog reachable from the signed-in chip dropdown (Account menu item).
    - Lists linked identities with per-provider Disconnect (disabled when only one identity remains; calls `DELETE /api/v1/auth/identities/{id}` then refreshes `useAuth`).
    - Connect buttons for unconnected providers: GitHub / Google form-POST to `POST /api/v1/auth/link/{github,google}/start`; the magic-link path expands an inline email form that POSTs to `POST /api/v1/auth/link/magic/start`.
    - 409 callback redirects (`/account?link_error=identity_already_linked&provider=…`) surface as an inline alert.
    - Checks run: `make check`, `npm test` (web), `npm run build` (web).

- [Codex]: Add AI Pit Crew workflow layer
  - Issue: #495
  - Branch: 495-ai-pit-crew-workflow
  - Review assigned to: Claude or Copilot
  - Implementation notes:
    - Added `TASKS.md` as an active-work board while keeping GitHub issues and `docs/roadmap.md` as the backlog.
    - Added `.agent-workflow.md` as the shared AI-assisted development loop.
    - Updated agent instructions to point contributors at the new workflow without replacing mgz-pkmn's existing architecture invariants.
    - Added README and contributor-doc attribution to @bobbylough's `ai-pit-crew` project as the workflow inspiration.

## Blocked

_No blocked tasks._

## Done

_No completed tasks yet._
