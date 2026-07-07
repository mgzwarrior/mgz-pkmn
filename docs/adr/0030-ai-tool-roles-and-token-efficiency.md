# ADR 0030: Preferred AI tool roles and opt-in token-efficiency practices

- **Status:** Accepted
- **Date:** 2026-07-07
- **Tags:** agents, workflow, docs

## Context

mgz-pkmn already runs an AI Pit Crew loop ([.agent-workflow.md](../../.agent-workflow.md), [AGENTS.md](../../AGENTS.md)): a human sets direction, one agent implements, a different agent reviews, the human approves and merges. The `agent:claude` / `agent:codex` / `agent:copilot` labels and the reviewer-pairing table already establish *that* cross-agent review happens and *who* can pair with whom. What's missing is a single place that states, plainly, which agent a new contributor should reach for first and why — that context is currently scattered as inference across CLAUDE.md, AGENTS.md, and ADR-0024 rather than stated once.

Separately, agentic sessions cost real tokens and (per [ADR-0024](0024-claude-review-github-action.md)) real API spend. The [`caveman`](https://github.com/JuliusBrussee/caveman) Claude Code plugin, by [JuliusBrussee](https://github.com/JuliusBrussee) — in use in this project's own sessions — compresses conversational output (dropped articles, filler, hedging) while leaving code, commit messages, PR bodies, and security-relevant explanations in normal prose by design. It's a session-level, opt-in mode (`/caveman`), not a repo-enforced setting: there's no hook in this repo forcing it on, and nothing here should force it on other contributors' sessions either.

## Decision

Two things, documented together because both are "how to use AI on this repo" guidance a new contributor needs on day one:

**1. Preferred agent roles.** Claude Code is this project's preferred agent for implementation work — it's the tool the maintainer runs day to day and the one CLAUDE.md is written for. Codex and Copilot are the designated cross-review agents (per the pairing table in [.agent-workflow.md](../../.agent-workflow.md)); either may also implement, with Claude or the other reviewing. This is a preference, not a restriction — any agent capable of following AGENTS.md and CLAUDE.md may contribute, and cross-agent review (not agent identity) is the load-bearing rule.

**2. Caveman mode is a recommended, opt-in efficiency practice for Claude Code contributors.** Running `/caveman` (from the [`caveman`](https://github.com/JuliusBrussee/caveman) plugin, or repo-scoped activation via its `caveman-init` skill) compresses conversational back-and-forth during implementation sessions. It is *not* required, has no CI gate, and does not touch what ships: code, commit subjects, PR bodies, issue/discussion text, and any security-relevant explanation stay in normal prose per the plugin's own boundary rules (see CLAUDE.md's commit-message and PR-body conventions, which are unaffected). Contributors who prefer normal-mode conversation throughout are free to skip it.

## Consequences

**Positive:**

- One doc answers "which AI, for what" instead of a new contributor reconstructing it from three files.
- Token/cost savings on long implementation sessions for contributors who opt in, with zero risk to review quality since PR bodies, commits, and code are explicitly out of scope for compression.
- No new process, gate, or label — this codifies existing practice plus a documented option, not a new requirement.

**Negative:**

- Opt-in means inconsistent adoption across contributors and sessions; a transcript shared by one contributor may read very differently from another's. Acceptable since transcripts aren't a shipped artifact.
- "Preferred agent" language could be misread as exclusionary. Mitigated by stating explicitly that any agent following AGENTS.md/CLAUDE.md may contribute.

**Neutral:**

- No change to the `agent:<name>` label set, reviewer-trigger table, or ADR-0024's cost controls.
- No repo-level hook or config forces caveman mode on; it remains a per-session, per-contributor choice.

## Alternatives considered

- **Mandate caveman mode repo-wide for all Claude sessions.** Rejected — the plugin is user/session-scoped by design, and forcing a communication style on every contributor's session is a preference call the ADR shouldn't make on their behalf.
- **Pick one AI tool exclusively.** Rejected — cross-agent review is the point of the Pit Crew model (ADR-0024 exists specifically to make Claude review as easy to trigger as Codex's), so a single-tool mandate would undercut it.
- **Leave tool-role guidance implicit across existing docs.** Status quo. Rejected because new contributors kept re-deriving "which AI do I use" from CLAUDE.md, AGENTS.md, and .agent-workflow.md separately; a single stated preference removes that friction.
