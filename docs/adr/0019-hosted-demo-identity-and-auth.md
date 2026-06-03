# ADR 0019: Hosted-demo identity and auth posture

- **Status:** Accepted
- **Date:** 2026-06-02
- **Tags:** auth, hosted-demo, scrydex

## Context

[#351](https://github.com/mgzwarrior/mgz-pkmn/issues/351) replaces the
project's pokemontcg.io upstream with Scrydex. Scrydex's Starter plan
is paid and capped at 5,000 requests / month. The hosted demo currently
ships with the maintainer's personal upstream key baked into the
container — fine for a free upstream, untenable once one shared key is
the funnel for every anonymous visitor's read traffic.

Two constraints frame the decision:

1. **The local CLI stays free, forever.** A user who installs `mgz-pkmn`
   from source / PyPI and brings their own Scrydex key pays zero. No
   account, no telemetry gate, no upstream-of-Scrydex API call to log
   in. The CLI is a different surface and is out of scope for this ADR.
2. **Cache pre-warming is solved.** Phases 1–3 of the catalog-warm
   epic ([#368](https://github.com/mgzwarrior/mgz-pkmn/issues/368),
   [#370](https://github.com/mgzwarrior/mgz-pkmn/issues/370),
   [#371](https://github.com/mgzwarrior/mgz-pkmn/issues/371),
   [#372](https://github.com/mgzwarrior/mgz-pkmn/issues/372)) plus
   ADR-0018's structural/volatile split mean the hosted demo boots
   warm against a persistent disk. The interesting Scrydex quota
   pressure is the *write* / refresh path, not first reads.

What's left is the *identity* question on the hosted surface: who is
allowed to do what, and how do we know who they are.

## Decision

**Anonymous visitors get a fully-functional read-only demo against the
warmed cache.** Lookups, browsing, set-cards, export of the visible
result — all work without an account. Reads that would force a
Scrydex round-trip beyond what the warm cache covers degrade
gracefully (the existing miss / fallback paths already do this).

**Sign-in is required only for persistent-storage actions** on the
hosted demo:

- Saving a search (the saved-searches sidebar; see [#243](https://github.com/mgzwarrior/mgz-pkmn/issues/243)).
- Anything #243's follow-ups add that writes to the user-owned slice
  of `runs` / `collections` / `wishlists` (per ADR-0013).
- Anything subsequent work decides should be per-user (URL overrides,
  saved exports, etc.) — those become sign-in-gated by default.

The Save action on an anonymous session surfaces a sign-in nudge
("Sign in to keep this run") rather than a hard 401 in the UI.

**Sign-in providers (in priority order):**

1. **GitHub OAuth** — most of the project's audience already has one.
2. **Magic link via email** — reuses Buttondown's existing wiring
   (ADR-0014) for delivery; covers users without a GitHub account.
3. **Google OAuth** — broad reach; same off-the-shelf integration
   shape as GitHub.

Account linking across providers is **out of scope for the first cut**:
each provider creates a distinct account keyed on the verified email
address it returns. If two providers return the same verified email
they map to the same `users` row. Beyond that, no manual link / merge
UI in v1.

**Scrydex key storage model is deferred.** We don't yet have Scrydex
access, so we can't validate the wire format or test the per-account
quota story. The decision between *BYO per-request*, *stored on
account*, or *hybrid* is pinned to the ticket that lands Scrydex
auth-against-Scrydex and is explicitly out of scope here.

## Consequences

**Positive:**

- Demo stays a "click and try it" surface. The pitch ("paste your
  list, hit Look up") survives the upstream-cost shift because the
  warmed cache absorbs anonymous reads.
- Sign-in friction shows up only where the user is *asking us to
  remember something* — a context where pasting an email or clicking
  GitHub feels proportionate.
- Three providers cover the realistic audience (devs via GitHub,
  collectors via Google, holdouts via magic link) without committing
  to password storage.
- ADR-0013's per-user persistence layer is the natural home for the
  rows this unlocks — no new storage model needed.

**Negative:**

- Auth introduces a real attack surface where today there is none
  (sessions, OAuth callbacks, email verification, account
  enumeration). Mitigated by leaning on off-the-shelf libraries
  rather than rolling our own.
- Three providers is more configuration than one. Each carries its
  own client-id / secret rotation, callback URL, and provider
  outages.
- Email-based account merging is a footgun: two providers returning
  the same verified email *will* land on the same `users` row.
  Acceptable in v1; explicit account-merge UI is a follow-up if it
  bites.
- We accept that anonymous visitors can still drive *some* Scrydex
  cost via cache misses on long-tail cards. The catalog warm makes
  this small, not zero.

**Neutral:**

- Local CLI behaviour is unchanged.
- ADR-0012 / Discussion #176 (pricing model) still needs an update
  once Scrydex access lands and the key-storage decision is made,
  but is no longer blocked by *this* ADR.

## Alternatives considered

- **Sign-in required for any lookup.** Cleanest cost story, but it
  kills the unauthenticated demo path that has been the project's
  marketing pitch since v1. Rejected.
- **Shared maintainer key with a per-IP daily cap.** Quota is bounded
  but easy to evade with IP rotation, and the failure mode for honest
  users (a hard 429 mid-session) is worse than a graceful
  cache-only degrade. Rejected.
- **One provider only (GitHub or magic link).** Simpler, but each
  single-provider choice strands a meaningful slice of the audience.
  The off-the-shelf stacks (Authlib, FastAPI-Users) treat multiple
  providers as configuration, not architecture, so the marginal cost
  of all three is small enough to take.
- **Decide the Scrydex key-storage model now.** Rejected until we
  have Scrydex access and can validate the per-account quota story
  end-to-end. Locking the storage model in before the upstream
  contract is testable risks an expensive rework.
