# Release digest (ongoing "what's new")

Every track's last onboarding email makes the same promise: *"from here, I'll
only write when a real version ships."* Nothing currently fulfills it — the
three onboarding tracks in [`../`](../) are fixed, three-email sequences that
end and go quiet. This directory is the mechanism that keeps the promise.

## How it's different from the onboarding tracks

| | Onboarding (`collector/`, `show-prep/`, `builder/`) | Digest (this directory) |
| --- | --- | --- |
| Trigger | Resend **Automation**, fired by the `New Signup` event on signup | Resend **Broadcast**, sent manually by the operator |
| Cadence | Fixed: on signup, +3 days, +7 days | Irregular — only when a release actually ships something visible |
| Count | Exactly 3 per subscriber, then silence | Ongoing, for as long as the subscriber stays subscribed |
| Content | Authored once, describes the product as of write time | Drafted per release, from that release's CHANGELOG entry |

A subscriber who finishes onboarding keeps getting digests until they
unsubscribe. See [ADR-0028](../../../adr/0028-resend-for-subscriptions-and-automations.md)
for the Automation/event-trigger mechanics the onboarding tracks use — the
digest reuses the same audience and the same `reason` contact property, but
through Resend's **Broadcast** feature (a one-time send to a segment) instead
of an event-triggered Automation, since there's no per-contact timer to
drive here.

## When to send one

Not every release. Skip anything that's `chore`/`ci`/`test`/`build`-only or
has no user-visible `### Added`/`### Changed` entry. A digest is judgment,
not automation — the send is a manual step at release-cut time (a good place
for the `cut-release` skill's checklist to eventually reference this doc),
not a webhook off `release-please`'s tag. Keeping a human in the loop on
*which* releases get one is deliberate: a digest for every patch release
would make the list feel like noise, breaking the same "I'll only write when
something real ships" promise it exists to keep.

## Segmentation

Reuse the `reason` property already stamped on every contact by
[`api/routes/subscribe.py`](../../../../api/routes/subscribe.py) — `collector`,
`show`, `builder` — the same three tracks. A release usually has one obvious
headline feature per segment (see the worked example); when it doesn't,
send one shared variant to the whole audience instead of forcing three
artificial ones. `segment: all` in the front matter marks that case.

## Format

Borrow TCG Codex's onboarding *depth*, not its cadence: one feature
spotlight per send, not a changelog dump. Structure:

1. One line acknowledging this is the "something shipped" email, not a
   fixed-sequence step.
2. **One headline feature**, 2-3 sentences, framed for the segment it's
   going to (a collector reads differently than a builder).
3. One 💡 tip — something concrete and immediately doable, not a summary.
4. A CTA to the live demo.
5. An optional "Also in vX.Y.Z" line for one second-tier item, linking the
   full CHANGELOG section for everything else. Don't list more than that —
   the changelog link is where completism belongs, not the email body.

Same voice rules as onboarding: [design/DESIGN_SYSTEM.md](../../../../design/DESIGN_SYSTEM.md) —
plainspoken, second person, sentence case, contractions, signed `— Matt`.

See [TEMPLATE.md](TEMPLATE.md) for the front-matter contract and a fillable
skeleton, and [v1.8.0-collector-example.md](v1.8.0-collector-example.md) for
a worked example against a real, already-shipped release (illustrative only
— v1.8.0 shipped 2026-06-30, this isn't a live draft to send).

## Known follow-up work (not done in this pass)

This directory is copy + mechanism design, not a working pipeline yet:

- [`render.py`](../render.py)'s `TRACKS` tuple is hardcoded to
  `("collector", "show-prep", "builder")` — it won't render or `--check`
  anything under `digest/` until that's extended, and `TEMPLATE.md` (no real
  front-matter) needs excluding from whatever glob picks up real digests.
- No Resend Broadcast has been created yet — extend
  [ADR-0028](../../../adr/0028-resend-for-subscriptions-and-automations.md)'s
  operator runbook with a "sending a release digest" section (or a short ADR
  addendum) once the first one is ready to send.
- The `cut-release` skill's checklist doesn't reference this doc yet.

Tracked as follow-up engineering scope — not filed as a GitHub issue in this
pass, pending confirmation.
