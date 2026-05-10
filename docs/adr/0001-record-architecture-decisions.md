# ADR 0001: Record architecture decisions in this directory

- **Status:** Accepted
- **Date:** 2026-05-09
- **Tags:** process, documentation

## Context

mgz-pkmn started as a personal tool and grew into a project with a CLI, a
FastAPI service, a React SPA, three data sources, four output artifacts,
disk caching, and a sort-mode DSL. A handful of decisions in that
foundation are non-obvious and easy to second-guess later — for example,
*why* PriceCharting is opt-in via URL rather than an automatic search, or
*why* the JSON report is a pure function of the row list.

The README and inline comments cover *what* the code does, but they're
not a great place to argue with the past. As contributors come and go
and as the project grows, decisions need a stable home that's separate
from prose docs and from code.

## Decision

Record load-bearing architecture decisions as numbered Markdown files in
[`docs/adr/`](.). Each ADR follows the lightweight Nygard template in
[`template.md`](template.md): Status, Context, Decision, Consequences,
Alternatives. The directory's own [`README.md`](README.md) is the index
and the contributor guide.

The retroactive ADRs that ship in the initial set (0002 through 0009)
document decisions that were already made in the codebase before this
practice was adopted — they describe the *why* of code that already
exists, not new direction.

## Consequences

- New decisions get a paper trail by default. PRs that add a meaningful
  decision can include the ADR alongside the code.
- The index is one extra file to keep current — adding a new ADR means
  updating the table in `README.md`.
- The retroactive ADRs are subjective interpretations of past decisions.
  If the original author would phrase the rationale differently, they're
  welcome to amend; the format invites that kind of correction.
- ADRs are now mirrored to the GitHub Wiki via the
  [docs sync workflow](../../.github/workflows/sync-wiki.yml), so the
  decision history is browsable in two places.

## Alternatives considered

- **Keep decisions in long-form READMEs / CONTRIBUTING.md.** What the
  README has now — short asides like "Why opt-in URL rather than
  auto-search?" — works for one-or-two-sentence rationales but doesn't
  scale to ~10 substantive decisions. ADRs separate concerns: the README
  describes how the tool works today; ADRs explain why.
- **Embed decisions as docstrings in code.** Useful but invisible to
  anyone not already reading the relevant module, and harder to discuss
  as a unit (you can't "review" a docstring change in isolation).
- **Confluence / Notion / external wiki.** Fragments documentation
  across systems; decisions drift out of sync with the code that
  embodies them. Keeping ADRs in-repo means they're versioned with the
  decision.
