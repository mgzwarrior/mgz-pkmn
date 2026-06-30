---
track: builder
reason: builder
sequence: 2
when: signup + 3 days
subject: How it's built (and how it reviews itself)
preheader: The stack, the seams, and the AI pit crew.
---

![mgz-pkmn](https://raw.githubusercontent.com/mgzwarrior/mgz-pkmn/main/assets/logo.svg)

A quick tour under the hood.

**The lookup path.** A query DSL parses a wishlist line (`top 5 Mew cards <= $50`) into a structured request; the pricing layer hits several open sources in order until one resolves, with a stale-while-revalidate cache in front. Results stream to the SPA over Server-Sent Events, so rows fill in as they land instead of blocking on the slowest one.

**The seams.** Sources, the cache, and the mailer are all small interfaces, which keeps tests honest — most of them patch one seam rather than mocking the world. Architecture decisions live as ADRs in [docs/adr](https://github.com/mgzwarrior/mgz-pkmn/tree/main/docs/adr), so the "why" is written down, not folklore.

**How it reviews itself.** Changes go through an "AI pit crew": one agent implements, a *different* agent reviews, and a human owns direction and the merge. It's documented in the repo's contributor guide — and it's why the commit history reads the way it does.

The guardrails are strict on purpose: Conventional Commits, a DCO sign-off, a maintainability gate, and a design-token adherence check all run in CI. They make a first contribution predictable — green CI means you matched the house style.

[**Read the contributor guide →**](https://github.com/mgzwarrior/mgz-pkmn/blob/main/docs/contributing.md)

Curious about a particular corner? Reply and ask — I like these questions.

— Matt
