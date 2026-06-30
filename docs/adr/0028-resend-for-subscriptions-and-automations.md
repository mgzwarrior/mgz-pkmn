# ADR 0028: Resend for newsletter subscriptions + a reason-branched welcome automation

- **Status:** Accepted
- **Date:** 2026-06-29
- **Tags:** marketing, site, api, infra

## Context

[ADR-0014](0014-buttondown-for-email-subscriptions.md) chose Buttondown for newsletter capture, under one load-bearing constraint: the marketing site was a pure static Astro build on Cloudflare Pages with *no backend to hold an API key*, so capture had to go through Buttondown's public embed-subscribe endpoint with no server in the loop. Two things have changed since.

- **Cost of the drip.** The point of capturing an address is to send a welcome sequence. Buttondown's drip automations are a paid add-on (+$29/mo Standard) — not on the free tier. We want *more* than a flat sequence: a subscriber's reason for being here (a collector, a dealer prepping for a show, an open-source contributor) should pick which 3-email track they get. On Buttondown that's squarely in paid territory.
- **We have a backend now.** The hosted demo runs a FastAPI service ([ADR-0016](0016-deployment-topology.md)), and it already sends transactional magic-link mail through **Resend** ([api/auth/magic.py](../../api/auth/magic.py)). Resend ships **Automations** on its free tier (10k automation runs/mo, 3k emails/mo, 1k contacts), and its create-contact API accepts a custom `properties` map. A small server-side `POST /subscribe` keeps the Resend API key off the static client and stamps the reason that drives the branch.

Net: we can consolidate onto one vendor, one verified sending domain, and one deliverability reputation — and the drip gets *more* capable while getting *cheaper*.

## Decision

Use **Resend** for newsletter subscriptions, replacing the Buttondown embed.

- A new server route, **`POST /api/v1/subscribe`** ([api/routes/subscribe.py](../../api/routes/subscribe.py)), accepts `{ email, reason }` where `reason ∈ {collector, show, builder}`. It creates a contact in a single Resend **audience** (`RESEND_AUDIENCE_ID`) and stamps the reason into Resend's custom `properties` map (`properties.reason`). The Resend API key (`RESEND_API_KEY`) lives only on the backend. Both are `sync: false` secrets in [render.yaml](../../render.yaml); the route returns 503 when either is unset (a deploy-time signal, never a runtime leak) and 502 when Resend rejects the create or is unreachable.
- The marketing form ([site/src/components/EmailSignup.astro](../../site/src/components/EmailSignup.astro)) gains a **reason single-select** and posts JSON to the API. Because the site (Cloudflare Pages, `https://mgz-pkmn.com`) and the API (Render) are different origins, the API's CORS allow-list adds the site origin (and a `*.pages.dev` regex for preview deploys).
- A **single Resend Automation** (built once in the dashboard — see runbook) triggers on "contact added to the audience" and **branches on `properties.reason`** into three paths, each sending that track's three emails. The email copy is authored in [docs/marketing/emails/](../../docs/marketing/emails/) (`collector/`, `show-prep/`, `builder/`) and pasted into the Automation steps.

One audience, three branches: the reason is data on the contact, not three separate lists — so segmentation, exports, and the unsubscribe surface all stay unified.

## Consequences

- **Positive.** One vendor for transactional + marketing mail, one verified domain, one reputation. Per-reason personalization (the headline win) on the free tier. The API key never ships to the client. The contact's reason is queryable in Resend for future segmented broadcasts.
- **Positive.** The form now gets a *real* status back (202 / 4xx / 5xx) instead of Buttondown's opaque `no-cors` response, so the success/error copy can be honest about whether the signup actually landed.
- **Negative.** The site is no longer a zero-backend capture surface — `/subscribe` is a route to maintain, and a backend outage means signups fail (degraded gracefully to an error message + a mailto). This is acceptable: the backend already exists and carries the demo.
- **Negative.** No native no-JS submit: the endpoint is a JSON API, so a no-JS visitor gets a `<noscript>` note pointing at the maintainer's email rather than a working native form post. A deliberate simplification from Buttondown's popup fallback.
- **Neutral.** The Automation itself is built in Resend's dashboard, not in the repo (see runbook). The repo owns the trigger contract (the `reason` values) and the email copy; the visual wiring is operator state.
- **Supersedes [ADR-0014](0014-buttondown-for-email-subscriptions.md).** [ADR-0015](0015-tally-for-surveys.md) (Tally for surveys) referenced a Buttondown migration path for sending surveys to subscribers; that path now points at Resend audiences instead — no change to the Tally decision itself.

## Operator runbook

One-time setup in the [Resend dashboard](https://resend.com) (the blueprint can't create these — they're account state):

1. **Verify the sending domain** (`mgz-pkmn.com`) under *Domains* if not already verified for magic-link mail. One domain serves both transactional and marketing.
2. **Create the audience** under *Audiences*. Copy its ID into `RESEND_AUDIENCE_ID` (Render → the API service → Environment).
3. **Create an API key** under *API Keys* with contacts + sends permission. Copy into `RESEND_API_KEY`. Both vars are `sync: false` in [render.yaml](../../render.yaml).
4. **Build the Automation** under *Automations*: trigger = *contact added to* the audience; add a branch/condition on the contact property `reason`; create three branches (`collector`, `show`, `builder`), each with three email steps + sensible delays. Paste the copy from [docs/marketing/emails/](../../docs/marketing/emails/) (subjects + preheaders are in each file's front-matter).
5. **Smoke test**: submit the live form once per reason; confirm a contact lands in the audience with the right `reason` property and the correct track begins.

## Alternatives considered

- **Stay on Buttondown, pay for automations.** +$29/mo for a capability Resend gives us free, on a vendor we'd then run *alongside* Resend (which already sends our transactional mail). Two reputations to warm, two dashboards, no consolidation win.
- **Single audience per reason (three audiences).** Works without custom `properties`, but fragments the subscriber list across three audiences — exports, segmentation, and unsubscribe state all split three ways for no benefit, since Resend's `properties` map gives us the branch key on one audience.
- **Keep capture backend-less (Cloudflare Pages Function as a proxy).** Preserves the static-only purity of ADR-0014, but adds a *second* runtime to maintain (a Pages Function) when we already operate a FastAPI backend that holds the very same Resend credentials. No reason to stand up a parallel server.
