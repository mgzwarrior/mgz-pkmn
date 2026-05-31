# ADR 0014: Buttondown for newsletter / email subscriptions

- **Status:** Accepted
- **Date:** 2026-05-31
- **Tags:** marketing, site, infra

## Context

Visitors who land on the marketing site but aren't ready to install
the CLI today need a low-friction way to be notified when a future
release ships something they care about. Without a capture surface
the project loses every one of those visitors: there's no
re-engagement path, no audience to ship survey #2 or release #1.2.0
to, and no way to validate which features actually pull people
back.

Constraints that shape the option space:

- Solo maintainer. The capture surface can't add a second deploy
  pipeline, a database to back up, or a recurring monthly fee.
- The site is a pure static Astro build deployed to Cloudflare
  Pages ([ADR-0011](0011-marketing-site-stack.md)) — there is no
  server-side runtime to receive a `POST /subscribe` request.
- No subscriber PII in the repo, ever. The capture surface must
  not require an API key in the client, since the client is just
  static HTML.
- Subscribers must own their address: a confirmation email + an
  obvious unsubscribe link, no surprise enrollment.
- Future iterations may want to send the v1 interest survey
  ([ADR-0015](0015-tally-for-surveys.md)) directly to subscribers,
  so the chosen tool should not be hostile to that path.

## Decision

Use **[Buttondown](https://buttondown.com)** as the email
subscription provider, embedded into
[`site/src/components/EmailSignup.astro`](../../site/src/components/EmailSignup.astro)
via Buttondown's public **embed-subscribe endpoint**:

```
POST https://buttondown.com/api/emails/embed-subscribe/<username>
```

The username (`mgz-pkmn`) is committed; no API key is in the
client. The component uses progressive enhancement: when JS is
available, the form submits inline via `fetch` and shows a success
state in place; when JS is off, the `<form>` falls back to
`target="popupwindow"` + an `onsubmit` that calls
`window.open(...)` so the submission opens Buttondown's hosted
form in a popup rather than navigating away from the page.
Buttondown sets CORS on the embed endpoint so the inline path
works without a proxy.

## Consequences

- Zero new infrastructure. No serverless function, no Worker, no
  Cloudflare Pages Function. The site stays a pure static build.
- Buttondown's free tier (currently up to 100 subscribers) covers
  the project comfortably through the v1.x line; paid tiers start
  at $9/mo when we cross it.
- Confirmation email + standard unsubscribe footer are handled by
  Buttondown — no PII or compliance surface in this repo.
- Subscriber list lives in Buttondown's dashboard, not in the
  repo. Exporting to CSV is a one-click operation should we ever
  need to migrate providers.
- Migration cost if Buttondown raises prices or shuts down: swap
  the form action in one Astro component and re-import the CSV
  into the new provider. The component contract (one `<form>`
  posting an email) is portable.

## Alternatives considered

- **Mailchimp.** Industry default but heavyweight: complex embed
  forms, mandatory branding on free tier, account UX optimized
  for marketing teams rather than solo maintainers. Overkill for
  a "drop me a note when X.Y.Z ships" newsletter.
- **Substack.** Excellent author-facing UX but its core abstraction
  is *posts*, not transactional release notifications. Forces a
  blogging cadence we don't have, and the embed UI puts Substack's
  branding on our page above the fold.
- **ConvertKit / Beehiiv.** Similar to Mailchimp's tradeoff —
  feature-rich for creators selling courses, but the embed form
  is a heavier component and the free tier caps tighter than
  Buttondown's.
- **Self-host (Listmonk + Postgres + an SMTP relay).** Cheap at
  scale, but adds a database to back up, a service to monitor, and
  a deliverability problem (warming a new IP). The exact opposite
  of "no operational overhead."
- **Roll our own** (Cloudflare Worker + KV + Mailgun). Smallest
  possible footprint but still adds a Worker to maintain,
  unsubscribe handling to implement, and a CAN-SPAM compliance
  surface to own. Not worth the engineering for ~hundreds of
  subscribers.
