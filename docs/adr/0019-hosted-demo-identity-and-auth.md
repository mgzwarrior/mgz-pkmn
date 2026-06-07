# ADR 0019: Hosted-demo identity and auth posture

- **Status:** Accepted
- **Date:** 2026-06-02
- **Tags:** auth, hosted-demo, persistence

## Context

The hosted demo has reached the point where every meaningful new capability the project wants to ship requires the server to know *which user it's talking to*. Saved searches (the saved-searches sidebar landing in [#243](https://github.com/mgzwarrior/mgz-pkmn/issues/243) / [#403](https://github.com/mgzwarrior/mgz-pkmn/pull/403)), collections and wishlists ([ADR-0013](0013-sqlite-persistence-for-runs-collections-wishlists.md)), per-user URL overrides, and any future "remember what I did" surface all need a per-user namespace. The persistence layer is already there — `runs` / `run_rows` ship today with a sentinel `users.id=1` row exactly so we can swap real identity in without a wire-format change — but nothing currently produces real `users` rows. That's the actual decision this ADR is making.

A secondary forcing function: [#351](https://github.com/mgzwarrior/mgz-pkmn/issues/351) replaces the pokemontcg.io upstream with Scrydex, whose Starter plan is paid and capped. Once Scrydex is live the read-quota story matters too — knowing who's behind a request is what makes per-account caps, BYO-key flows, and the rest possible. Identity isn't *driven* by Scrydex (we'd be doing this for persistent storage anyway), but it does mean we want identity in place before that migration lands rather than after.

Two constraints frame the decision:

1. **The local CLI stays free, forever.** A user who installs `mgz-pkmn` from source or PyPI pays zero. No account, no telemetry gate, no upstream-of-Scrydex API call to log in. The CLI is a different surface and is out of scope for this ADR.
2. **Cache pre-warming is already solved.** Phases 1–3 of the catalog-warm epic ([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368), [#370](https://github.com/mgzwarrior/mgz-pkmn/issues/370), [#371](https://github.com/mgzwarrior/mgz-pkmn/issues/371), [#372](https://github.com/mgzwarrior/mgz-pkmn/issues/372)) plus ADR-0018's structural/volatile cache split mean the hosted demo boots warm against a persistent disk. Reads are mostly cache hits before auth ever comes into the picture.

## Decision

**Anonymous visitors keep a fully-functional read-only demo against the warmed cache.** Lookups, browsing, set-cards, export of the visible result — all work without an account. The "click and try it" pitch the project has had since v1 survives.

To make this work safely, the lookup path needs an **explicit cache-only mode** for anonymous sessions: on cache miss, return "not in cache" instead of issuing an upstream request. Today's path (`TCGClient._network_fetch` in [`src/mgz_pkmn/sources/pokemontcg.py`](../../src/mgz_pkmn/sources/pokemontcg.py)) retries and then *raises* on persistent non-retryable upstream errors (401 / 403 / 5xx), which would surface as a 500 to the anonymous visitor and bill upstream quota for traffic that should never have left the host. Wiring the cache-only mode is part of the implementation in [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61).

**Sign-in is required only for persistent-storage actions** on the hosted demo:

- Saving a search (the saved-searches sidebar; see [#243](https://github.com/mgzwarrior/mgz-pkmn/issues/243) / [#403](https://github.com/mgzwarrior/mgz-pkmn/pull/403)).
- Anything #243's follow-ups add that writes to the per-user slice of `runs` / `collections` / `wishlists` (per [ADR-0013](0013-sqlite-persistence-for-runs-collections-wishlists.md)).
- Anything subsequent work decides should be per-user (URL overrides, saved exports, named binder templates, etc.) — sign-in-gated by default.

The Save action on an anonymous session surfaces a sign-in nudge ("Sign in to keep this run") rather than a hard 401 in the UI. The principle: nobody loses access to anything they had before; sign-in only appears when the user is asking us to remember something on their behalf.

**Sign-in providers (in priority order):**

1. **GitHub OAuth** — most of the project's audience already has one.
2. **Magic link via email** — reuses Buttondown's existing wiring ([ADR-0014](0014-buttondown-for-email-subscriptions.md)) for delivery; covers users without a GitHub account.
3. **Google OAuth** — broad reach; same off-the-shelf integration shape as GitHub.

Account linking across providers was **out of scope for the first cut**: each provider created or reused an account keyed on the verified email address it returned. If two providers returned the same verified email they mapped to the same `users` row. Beyond that, no manual link / merge UI shipped in the initial auth slice.

Follow-up [#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491) supersedes that deferral without changing the first-cut sign-in posture: `user_identities` now records one row per proved provider identity, sign-in still implicitly attaches same-email providers to the existing `users` row, and signed-in users can explicitly link or unlink GitHub / Google / magic-link identities as long as at least one sign-in method remains.

**Scrydex key storage model is deferred.** We don't yet have Scrydex access, so we can't validate the wire format or test the per-account quota story. The decision between *BYO per-request*, *stored on account*, or *hybrid* is pinned to the ticket that lands Scrydex auth-against-Scrydex and is explicitly out of scope here.

## Consequences

**Positive:**

- Every "remember this" capability the roadmap has been holding back on becomes implementable — saved searches first, then the collections / wishlists / overrides queue that's been sitting behind identity for a year.
- Demo stays a "click and try it" surface. New users hit the same zero-friction read-only experience they did before.
- Sign-in friction shows up only where the user is *asking us to remember something* — a context where pasting an email or clicking GitHub feels proportionate to what they're getting in return.
- Three providers cover the realistic audience (devs via GitHub, collectors via Google, holdouts via magic link) without committing to password storage.
- When Scrydex lands, identity is already in place and the per-account quota / BYO-key conversations have a real `users` row to hang off of.
- [ADR-0013](0013-sqlite-persistence-for-runs-collections-wishlists.md)'s per-user persistence layer is the natural home for the rows this unlocks — no new storage model needed.

**Negative:**

- Auth introduces a real attack surface where today there is none (sessions, OAuth callbacks, email verification, account enumeration). Mitigated by leaning on off-the-shelf libraries rather than rolling our own.
- Three providers is more configuration than one. Each carries its own client-id / secret rotation, callback URL, and provider outages.
- Email-based account merging is a footgun: two providers returning the same verified email *will* land on the same `users` row. [#491](https://github.com/mgzwarrior/mgz-pkmn/issues/491) makes those linked identities visible and manageable, but full destructive merge of two already-existing accounts remains out of scope.
- The user-facing copy around the sign-in nudge has to be careful — it must read as "to keep this run", not as "you're being throttled".
- The anonymous-cache-only mode is a real implementation requirement, not free-by-default. Until it lands, an anonymous miss can still drive an upstream call (and a 5xx if upstream is unhappy). The expectation is that this mode lands as part of [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61) alongside the auth scaffolding, not as a separate ticket.

**Neutral:**

- Local CLI behaviour is unchanged.
- ADR-0012 / [Discussion #176](https://github.com/mgzwarrior/mgz-pkmn/discussions/176) (pricing model) still needs an update once Scrydex access lands and the key-storage decision is made, but is no longer blocked by *this* ADR.
- Self-hosted instances get an env kill switch (`MGZ_PKMN_AUTH_ENABLED=0`) so the existing anonymous-everywhere posture is preserved for anyone running their own copy.

## Alternatives considered

- **Sign-in required for any lookup.** Cleanest cost story for the eventual Scrydex bill, but it kills the unauthenticated demo path that has been the project's marketing pitch since v1, and it gates read traffic behind identity even though the warm cache makes reads nearly free. Rejected.
- **Skip identity entirely and store everything client-side.** Each browser keeps its own saved searches in localStorage. No auth surface, no server complexity. Rejected because it can't span devices, can't survive a cleared profile, and locks out every follow-up feature (shared collections, mobile companion, etc.) that's actually the point of building this on top of persistent server-side rows.
- **One provider only (GitHub or magic link).** Simpler, but each single-provider choice strands a meaningful slice of the audience. The off-the-shelf stacks (Authlib, FastAPI-Users) treat multiple providers as configuration, not architecture, so the marginal cost of all three is small enough to take.
- **Decide the Scrydex key-storage model now.** Rejected until we have Scrydex access and can validate the per-account quota story end-to-end. Locking the storage model in before the upstream contract is testable risks an expensive rework.
