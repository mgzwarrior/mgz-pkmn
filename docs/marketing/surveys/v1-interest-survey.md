---
sequence: 1
when: v1.x — top-banner CTA on the marketing site & demo SPA
host: Tally (https://tally.so)
form_url: https://tally.so/r/REPLACE_ME
length: ~2 minutes / 6 questions
audience: anyone hitting mgz-pkmn.com or the live demo
---

# v1 Interest Survey

The first signal-gathering pass. Anonymous by default; respondents can
opt into a contact email if they want a reply. Source of truth for the
questions — paste these into Tally when creating/updating the form, and
keep this file in lockstep so future maintainers can read the canonical
list without logging into a third-party tool.

## Intro copy (Tally welcome screen)

> Quick favor: a 2-minute survey to help shape what mgz-pkmn ships
> next. No wrong answers, all questions optional, fully anonymous unless
> you choose to drop an email at the end. Thanks for trying the tool.

## Questions

### 1. What's the single biggest pain point in your card-show prep today?

- **Type:** long text
- **Required:** no

### 2. Which mgz-pkmn features have been most useful so far?

- **Type:** multi-select (checkboxes)
- **Required:** no
- **Options:**
  - Want-list lookup (CLI / web)
  - Printable PDF binder
  - Set-completion checklist
  - Xlsx export
  - Browse-by-set modal
  - Recently shipped / changelog
  - Haven't actually used it yet
  - Other (free text)

### 3. What's the one thing that would make you come back and use this tool again next show?

- **Type:** long text
- **Required:** no

### 4. Which describes you best?

- **Type:** single-select (radio)
- **Required:** no
- **Options:**
  - Hobbyist collector — show up with want-lists
  - Vendor / reseller — work booths
  - LGS owner / staff
  - Open-source contributor
  - Just curious

### 5. Favorite Pokemon? (just for fun — feel free to skip)

- **Type:** short text
- **Required:** no

### 6. Optional: email if you'd like a reply

- **Type:** email
- **Required:** no
- **Help text:** Won't be added to the newsletter unless you ask.

## Outro copy (Tally thank-you screen)

> Thanks — every answer here directly shapes the v1.2 / v2.0 roadmap.
> If you want occasional release-shipped emails, the newsletter signup
> on the site is the better fit.

## Operational notes

- Tally renders one question per screen by default. Keep it that way —
  long-form layouts have lower completion rates for first-time visitors.
- When the form URL changes (e.g. for a v2 survey), bump the constant
  in `site/src/components/AnnouncementBanner.astro` and
  `web/src/components/AnnouncementBanner.tsx` together, and change the
  localStorage dismissal key suffix from `survey-v1` to `survey-v2` so
  prior dismissers see the new banner.
