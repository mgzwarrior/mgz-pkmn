# ADR 0030: Preferred AI tool roles and opt-in token-efficiency practices

- **Status:** Accepted
- **Date:** 2026-07-07
- **Tags:** agents, workflow, docs

## Context

mgz-pkmn already runs an AI Pit Crew loop ([.agent-workflow.md](../../.agent-workflow.md), [AGENTS.md](../../AGENTS.md)): a human sets direction, one agent implements, a different agent reviews, the human approves and merges. The `agent:claude` / `agent:codex` / `agent:copilot` labels and the reviewer-pairing table already establish *that* cross-agent review happens and *who* can pair with whom. What's missing is a single place that states, plainly, which agent a new contributor should reach for first and why — that context is currently scattered as inference across CLAUDE.md, AGENTS.md, and ADR-0024 rather than stated once.

Separately, agentic sessions cost real tokens and (per [ADR-0024](0024-claude-review-github-action.md)) real API spend. The [`caveman`](https://github.com/JuliusBrussee/caveman) Claude Code plugin, by [JuliusBrussee](https://github.com/JuliusBrussee) — in use in this project's own sessions — compresses conversational output (dropped articles, filler, hedging) while leaving code, commit messages, PR bodies, and security-relevant explanations in normal prose by design. It's a session-level, opt-in mode (`/caveman`), not a repo-enforced setting: there's no hook in this repo forcing it on, and nothing here should force it on other contributors' sessions either.

A third gap: Claude Code skills accumulate from three unrelated sources — Anthropic's built-in defaults, the [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) `engineering-skills` bundle (installed project-wide), and this repo's own project-scoped skills in `.claude/skills/` (`cut-release`, `groom-issues`, `repo-analysis`) — with no stated rule for which one wins when their advice overlaps or conflicts. [wdm0006/python-skills](https://github.com/wdm0006/python-skills), a 12-skill marketplace purpose-built for Python library/CLI/web-app development, surfaced this gap directly: several of its skills would just re-litigate practices `make check` already enforces (ruff, the radon MI gate) or that a repo-scoped skill already owns (`cut-release` for releases), while a few others fill real holes (`cli.py` is Click-based and has no CLI-specific skill; `api/` is FastAPI and has no FastAPI-specific skill).

## Decision

Three things, documented together because all three are "how to use AI on this repo" guidance a new contributor needs on day one:

**1. Preferred agent roles.** Claude Code is this project's preferred agent for implementation work — it's the tool the maintainer runs day to day and the one CLAUDE.md is written for. Codex and Copilot are the designated cross-review agents (per the pairing table in [.agent-workflow.md](../../.agent-workflow.md)); either may also implement, with Claude or the other reviewing. This is a preference, not a restriction — any agent capable of following AGENTS.md and CLAUDE.md may contribute, and cross-agent review (not agent identity) is the load-bearing rule.

**2. Caveman mode is a recommended, opt-in efficiency practice for Claude Code contributors.** Running `/caveman` (from the [`caveman`](https://github.com/JuliusBrussee/caveman) plugin, or repo-scoped activation via its `caveman-init` skill) compresses conversational back-and-forth during implementation sessions. It is *not* required, has no CI gate, and does not touch what ships: code, commit subjects, PR bodies, issue/discussion text, and any security-relevant explanation stay in normal prose per the plugin's own boundary rules (see CLAUDE.md's commit-message and PR-body conventions, which are unaffected). Contributors who prefer normal-mode conversation throughout are free to skip it.

**3. Skill-stack precedence: repo-scoped skills, then `engineering-skills`, then Anthropic defaults.** Where two installed skills would give conflicting advice, the more specific one wins: this repo's own `.claude/skills/` (`cut-release`, `groom-issues`, `repo-analysis`) override the [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) `engineering-skills` bundle, which overrides Anthropic's built-in defaults. Against that precedence, [wdm0006/python-skills](https://github.com/wdm0006/python-skills)'s 12 skills split three ways:

- **Adopt** — `testing-python-libraries` (pytest fixtures, parametrization, and Hypothesis property-based testing depth the generic `tdd-guide` doesn't cover), `auditing-python-security` (Bandit, pip-audit, Semgrep — tools no installed skill names), `building-python-clis` (`cli.py` is Click-based and no installed skill is CLI-specific), `building-python-web-apps` (FastAPI/async-SQLAlchemy guidance for `api/`, more specific than the generic `senior-backend`/`senior-fullstack` skills).
- **Revisit if the `mgz-pkmn-vendor` plugin surface ships to PyPI** — `packaging-python-libraries`, `designing-python-apis`, `documenting-python-libraries` (Sphinx/ReadTheDocs, semver-breaking-change discipline, trusted publishing all presuppose a published library; mgz-pkmn itself isn't one yet).
- **Skip as duplicative** — `setting-up-python-libraries` (project is already scaffolded), `improving-python-code-quality` (ruff and the radon MI gate already enforce this in CI), `managing-python-releases` (release-please plus the `cut-release` skill already own this), `optimizing-python-performance` (redundant with the installed `performance-profiler` skill), `building-python-communities` (redundant with `docs/contributing.md`, `AGENTS.md`, and the `groom-issues` skill).

## Consequences

**Positive:**

- One doc answers "which AI, for what" instead of a new contributor reconstructing it from three files.
- Token/cost savings on long implementation sessions for contributors who opt in, with zero risk to review quality since PR bodies, commits, and code are explicitly out of scope for compression.
- No new process, gate, or label — this codifies existing practice plus a documented option, not a new requirement.
- Skill conflicts have a deterministic answer (specificity wins) instead of being resolved ad hoc per session, and `python-skills` adoption is scoped to the four skills that add real coverage instead of installed wholesale.

**Negative:**

- Opt-in means inconsistent adoption across contributors and sessions; a transcript shared by one contributor may read very differently from another's. Acceptable since transcripts aren't a shipped artifact.
- "Preferred agent" language could be misread as exclusionary. Mitigated by stating explicitly that any agent following AGENTS.md/CLAUDE.md may contribute.
- `wdm0006/python-skills` requires a Claude Code Pro/Max/Team/Enterprise plan; contributors on other plans or other agents simply don't get those four skills and fall back to `engineering-skills`/defaults, which is why they're additive rather than load-bearing.

**Neutral:**

- No change to the `agent:<name>` label set, reviewer-trigger table, or ADR-0024's cost controls.
- No repo-level hook or config forces caveman mode on; it remains a per-session, per-contributor choice.
- The "revisit if `mgz-pkmn-vendor` ships" skills aren't installed now; picking them back up is a follow-up ADR update, not a new decision.

## Alternatives considered

- **Mandate caveman mode repo-wide for all Claude sessions.** Rejected — the plugin is user/session-scoped by design, and forcing a communication style on every contributor's session is a preference call the ADR shouldn't make on their behalf.
- **Pick one AI tool exclusively.** Rejected — cross-agent review is the point of the Pit Crew model (ADR-0024 exists specifically to make Claude review as easy to trigger as Codex's), so a single-tool mandate would undercut it.
- **Leave tool-role guidance implicit across existing docs.** Status quo. Rejected because new contributors kept re-deriving "which AI do I use" from CLAUDE.md, AGENTS.md, and .agent-workflow.md separately; a single stated preference removes that friction.
- **Install all 12 `python-skills` skills uniformly.** Rejected — several skills would just re-litigate practices `make check` already enforces (ruff, the radon MI gate) or that a repo-scoped skill already owns (release process via `cut-release`), adding noise instead of value; the split above installs only what fills a real gap.
