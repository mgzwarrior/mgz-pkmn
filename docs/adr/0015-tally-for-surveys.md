# ADR 0015: Tally for marketing surveys (with a Buttondown migration clause)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Tags:** marketing, site

## Context

The v1 interest survey
([`docs/marketing/surveys/v1-interest-survey.md`](../marketing/surveys/v1-interest-survey.md))
needs a hosting surface that can: render a ~6-question form on a
public URL, accept free-text answers, accept an optional contact
email, give the maintainer a readable response dashboard, and not
cost anything on the v1.x audience scale (tens to low hundreds of
responses).

It also needs to be embeddable in the marketing-site announcement
banner ([`AnnouncementBanner.astro`](../../site/src/components/AnnouncementBanner.astro))
as a single click-through link — no iframe, no third-party JS on
our page, because the site is a pure static Astro build deployed
to Cloudflare Pages and we want it to stay that way
([ADR-0011](0011-marketing-site-stack.md)).

Constraints:

- Solo maintainer. The survey tool can't add a recurring fee or
  another service to babysit.
- No PII in the repo, no API keys in the static client.
- The current question list lives in repo as the source of truth;
  the hosting tool is the rendering surface, not the spec.

## Decision

Use **[Tally](https://tally.so)** for the v1 interest survey, linked
out from the announcement banner. Specifically:

- Tally form ID lives in two places: the survey doc
  ([`docs/marketing/surveys/v1-interest-survey.md`](../marketing/surveys/v1-interest-survey.md))
  and `AnnouncementBanner.astro`'s `SURVEY_URL`. Bump both, plus
  the `survey-v1` dismissal-key suffix, when shipping a future
  survey.
- One question per Tally screen (Tally's default); responses go
  to Tally's dashboard.
- The question list in `docs/marketing/surveys/` is the source of
  truth — Tally is the rendering surface. To revise, edit the
  doc, then mirror into Tally's editor.

**Migration clause:** When the Buttondown subscriber list
([ADR-0014](0014-buttondown-for-email-subscriptions.md)) becomes
the primary audience for the survey (rather than cold marketing-site
visitors), revisit whether Buttondown's built-in survey feature is
the better fit. The migration cost is one Astro component edit and
a one-time CSV import; we're not building a moat around Tally.

## Consequences

- Zero infrastructure. No iframe on our page, no JS on our page —
  just an `<a href>` in the banner that opens the Tally form.
- Tally's free tier covers unlimited forms with unlimited
  responses; the project pays nothing.
- Response data lives in Tally's dashboard, off-repo, with optional
  CSV export. Acceptable for a marketing survey; would be wrong for
  anything we needed to query programmatically.
- Two surfaces (announcement banner + survey doc) must stay in
  sync on the Tally URL. The CHANGELOG note for the survey-banner
  feature spells this out so future-us doesn't forget.
- No subscriber funnel built in: a Tally respondent isn't
  automatically subscribed to Buttondown. We accept that tradeoff
  for v1 — the survey has an optional email field whose answers we
  can manually port into Buttondown if/when we choose.

## Alternatives considered

- **Google Forms.** Free, ubiquitous, fine UX for respondents. Loses
  on the embed/branding axis (forces a Google-branded chrome) and
  has a clunkier response-export path. Tally's free tier covers the
  same use case with better in-product polish.
- **Typeform.** Best-in-class form UX, but free tier caps at 10
  responses per form per month. Disqualifying for a "go wide on
  social" survey push.
- **Buttondown's built-in survey feature.** The "what do you want
  next?" question is a natural fit to ask the subscriber list,
  but in v1 the survey is aimed at *cold* marketing-site visitors
  who haven't subscribed yet, so this is the wrong tool for now.
  Captured as the migration clause above.
- **Self-host a form (Formspree, Static Forms, our own Cloudflare
  Worker).** Adds either a recurring fee or a service to maintain,
  with no respondent-side UX advantage over Tally's free tier.
