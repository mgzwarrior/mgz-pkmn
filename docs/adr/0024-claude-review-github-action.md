# ADR 0024: Wire up `anthropics/claude-code-action` for `@claude` PR review

- **Status:** Accepted
- **Date:** 2026-06-08
- **Tags:** ci, agents, review

## Context

The mgz-pkmn AI Pit Crew loop expects every PR to be reviewed by an agent other than the one that authored it (see [.agent-workflow.md](../../.agent-workflow.md)). Codex review is one comment away — `@codex review` fires the chatgpt-codex-connector bot. Copilot review attaches via `gh pr edit --add-reviewer Copilot`. Claude review, until now, has required the maintainer to switch into Claude Code locally and run `/review <PR>`. That friction is real: small PRs that would benefit from a second pair of eyes routinely skip the Claude pass because the human has to be the one to run it.

[#513](https://github.com/mgzwarrior/mgz-pkmn/issues/513) (the issue this ADR backs) was spun out of [#512](https://github.com/mgzwarrior/mgz-pkmn/pull/512) to close that gap. The constraints framing the decision:

- mgz-pkmn is a public repo. The workflow must not let fork PRs spend the project's Anthropic API budget, and it must not expose `ANTHROPIC_API_KEY` to PRs from forks (GitHub already blocks this at the platform level for `pull_request`, but the `issue_comment` trigger needs an explicit guard).
- Cost is opt-in by design. The team wants the same `@claude review` shape Codex uses today: a human pulls the trigger, the action runs, no auto-review on every PR open.
- The project already has an Anthropic Pro plan API key the maintainer can scope to this repo's spend. No new vendor relationship is required.

## Decision

Use the official [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) action, pinned to a specific tag (currently `v1.0.140`), wired up via [`.github/workflows/claude-review.yml`](../../.github/workflows/claude-review.yml).

**Trigger model.** The workflow listens on `issue_comment`, `pull_request_review_comment`, `pull_request_review`, and `issues:assigned`. The action's built-in default trigger phrase (`@claude`) gates whether it actually runs — anything else in the comment stream is ignored.

**Fork-PR scoping.** A `precheck` job resolves the PR's head repo before the `claude` job runs. For `pull_request_review_comment` and `pull_request_review` events the head repo is in the payload directly. For `issue_comment` events the payload does *not* carry the head repo (it only carries `issue.pull_request`), so the precheck calls the GitHub API to fetch `repos/{owner}/{repo}/pulls/{n}.head.repo.full_name` before deciding. Only when that resolves to `github.repository` does the `claude` job run — fork PRs never invoke the action and never see `ANTHROPIC_API_KEY`. The guard is explicit even though GitHub already withholds secrets from fork-triggered `pull_request` runs, because `issue_comment` and `pull_request_review*` all run in the *target* repo's context with secret access. An earlier draft tried to express the guard as a single workflow-level `if:` expression on `github.event.pull_request.head.repo.full_name`; that field is null for `issue_comment` events, which would have let fork-PR comments through. The dedicated precheck job is the correct shape.

**Authentication.** `ANTHROPIC_API_KEY` is stored as a repository secret (Settings → Secrets and variables → Actions). The key is scoped via Anthropic's workspace controls to this repo's spend; rotation lives on the same runbook as the eBay and TCGPlayer keys (the runbook itself is tracked separately).

**Permissions.** The workflow grants `contents: read`, `pull-requests: write`, `issues: write`, and `id-token: write` — enough for the action to read the diff, post the review, and mint its GitHub App token via OIDC, nothing else. `id-token: write` is non-obvious but required: the action calls `OidcClient.getCall(id_token_url)` early in `setupGitHubToken`, and GitHub only populates `ACTIONS_ID_TOKEN_REQUEST_URL` for jobs that declare the scope. Without it the action retries three times then fails with "Could not fetch an OIDC token" (#534). The workflow-level `permissions:` block only narrows the `GITHUB_TOKEN`; OIDC is a separate scope that must be granted at the job level.

**Model and cost ceiling.** The default model the action selects (currently Claude Sonnet) is the right tradeoff between review quality and per-PR cost for this repo's typical PR size. `claude_args: --max-turns 10` caps per-invocation turns to a sane bound; the per-PR token cost should stay in the low-cents range under normal use. If a PR triggers a runaway loop, `--max-turns` ends the session before it spirals. We are deliberately *not* setting `--max-tokens` at the action level today; if observed spend gets noisy we revisit.

**Documentation.** The Claude reviewer-trigger row in both [CLAUDE.md](../../CLAUDE.md) and [.agent-workflow.md](../../.agent-workflow.md) switches from "human-initiated in Claude Code" to `gh pr comment <PR> --body "@claude review"`. The `agent:claude` author label is unchanged.

## Consequences

**Positive:**

- Claude review is now a one-comment trigger, matching Codex's ergonomics. Small PRs get the second pass they were skipping.
- The official action is maintained by Anthropic, follows the company's security posture, and ships fixes (including for prompt-injection concerns) directly upstream.
- The fork-PR guard means cost stays bounded to traffic the maintainer or a trusted contributor explicitly invokes.
- Pinning to a specific tag (`v1.0.140`) means upstream changes can't silently change review behaviour or permission requirements; bumps are intentional PRs.
- Identity of the reviewing agent is preserved in the PR conversation, so the cross-agent review trail stays auditable.

**Negative:**

- Real per-PR API spend, where today there is none. Mitigated by the comment-trigger model (no auto-review), the `--max-turns 10` cap, and a dedicated repo-scoped API key.
- A new repo secret (`ANTHROPIC_API_KEY`) widens the project's secret surface. Mitigated by Anthropic's workspace-level scoping and a documented rotation expectation.
- Pinned tags require periodic maintenance. The convention is: bump the pin when there's a meaningful upstream change, otherwise leave it alone — same posture as other actions in this repo.
- The action runs in the target repo's context for `issue_comment` and `pull_request_review*` events, so the fork-PR guard is load-bearing. The `precheck` job is the single point of enforcement and reviewers should treat changes to it (especially the per-event-name head-repo resolution) as security-sensitive.

**Neutral:**

- Codex review is unaffected.
- Local `/review <PR>` in Claude Code still works for the maintainer; it's now a fallback rather than the primary path.
- The `issues:assigned` trigger is wired up but not yet used — autonomous implementation on assignment is explicitly out of scope (see below).

## Alternatives considered

- **Community action [`drillan/claude-pr-reviewer`](https://github.com/marketplace/actions/claude-pr-reviewer).** Lighter footprint and a narrower review-only feature set. Rejected because upstream support, security posture, and parity with the broader Claude Code action surface (tool use, MCP, plugins) all favour the official action — and the official one isn't materially heavier for this use case.
- **Auto-review on every PR open.** Cleanest from a "no review gets skipped" angle, but every PR would bill against the API key regardless of whether a second pass adds value. Deferred until the comment-trigger model has produced a few weeks of cost and signal data; revisit then.
- **Wire `issues:assigned` for autonomous implementation now.** The action supports it, and we already listen for the event. Rejected for the first cut: assigning Claude an issue and having it open a PR has a much bigger blast radius than commenting on an existing PR, and the cross-agent review story should land first so any autonomous PR still gets human-equivalent review before merge.
- **Stay on local `/review <PR>` only.** The status quo. Rejected because the friction is exactly the problem [#513](https://github.com/mgzwarrior/mgz-pkmn/issues/513) was opened to solve.
