# Marketing emails

Source of truth for the project's Buttondown email copy. Each file is a
self-contained markdown draft — subject line, preheader, body — ready to
paste into Buttondown's composer (or a future automation that drives
the welcome sequence by tag).

## Files

| # | File | Trigger | Audience |
|---|---|---|---|
| 1 | [`welcome-1-show-prep-problem.md`](welcome-1-show-prep-problem.md) | Send immediately on confirm | New subscriber |
| 2 | [`welcome-2-what-you-can-do-today.md`](welcome-2-what-you-can-do-today.md) | Send 2 days after #1 | New subscriber |
| 3 | [`welcome-3-built-in-the-open.md`](welcome-3-built-in-the-open.md) | Send 5 days after #2 | New subscriber |

## Sending convention

- Buttondown subscriber list is at <https://buttondown.com/mgz-pkmn>
  (see [ADR-0014](../../adr/0014-buttondown-for-email-subscriptions.md)).
- These three are tag-driven `welcome` automations, not broadcasts:
  whoever subscribes from the marketing-site `/EmailSignup.astro` form
  gets all three on the cadence above, regardless of when they signed
  up. Existing subscribers are not re-enrolled.
- Subject lines are committed in the front-matter of each file so
  changes are reviewable in PR.
- Each email opens with the inline project logo (same convention as
  every GitHub Discussion post — see the maintainer's memory on this).
- All copy is markdown; Buttondown's editor renders it directly.

## When this changes

Edit the markdown in-repo first, then mirror into Buttondown. The
repo is the canonical source — Buttondown is the rendering surface.

When the welcome sequence ships its first batch of confirmed
subscribers, post a short Discussion update with the open rate so
future-us has a baseline to A/B against.
