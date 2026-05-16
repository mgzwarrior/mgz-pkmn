# ADR 0012: Open-core architecture for a paid Vendor tier

- **Status:** Proposed
- **Date:** 2026-05-16
- **Tags:** open-core, monetization, governance

## Context

The project's roadmap commits to a free/paid separation at V2.x
([`docs/roadmap.md`](../roadmap.md)): "Free features stay free forever;
paid features expand the vendor / power-user surface." That's a stance,
not yet an architecture. Before any paid code lands, the *shape* of
the open-core split needs a load-bearing decision so contributors can
reason about what code goes where, and so a future paid product
doesn't retroactively distort the OSS codebase.

Three forces shape the option space:

1. **The collector ↔ vendor split is a real audience boundary.** A
   solo collector prepping for a card show needs the current CLI plus
   maybe a hosted convenience layer. A card-shop vendor needs
   multi-user accounts, persistent inventory, acquisition-cost comps,
   and integrations with paid third-party APIs. These aren't
   gradations of the same product — they serve different jobs.

2. **The OSS contributor base is small but growing.** Decisions made
   now about contributor licensing are cheap to change today and
   expensive to change later (every accumulated contributor either
   re-asserts past commits or is grandfathered, which weakens any
   downstream legal cleanup). The right time to set up the rails is
   before there's much rolling stock on them.

3. **Open-core projects fail predictably when the line wanders.**
   The recurring failure mode: features start free, drift into a
   paid tier, contributors discover they shipped free labor into a
   paywalled product, trust erodes. The defense is structural — the
   paid surface lives somewhere the OSS contributor cannot
   accidentally land — not procedural.

## Decision

Adopt an **open-core architecture with three structural commitments**:

1. **The paid surface lives in a separate private repository**
   (`mgz-pkmn-vendor`) under a future `mgz-pkmn` GitHub organization.
   It is *not* a paid-features branch, feature flag, or `paid/`
   subdirectory inside this repo. The physical separation is the
   defense against scope drift and accidental contribution.

2. **The OSS CLI exposes a deliberate plugin surface** (entry-point
   discovery for subcommands, output writers, and lookup sources).
   The vendor package depends on `mgz-pkmn` as an ordinary pip
   dependency and registers against those entry points. `pkmn vendor
   <subcommand>` becomes available if-and-only-if `mgz-pkmn-vendor`
   is installed alongside. The plugin surface is independently useful
   — community contributors can write their own plugins without
   coordination.

3. **A hosted offering can be added later as a separate delivery
   layer over the same plugin surface.** "Vendor Cloud" runs the OSS
   CLI plus the vendor plugin on infrastructure operated by the
   maintainer, adds multi-user state, scheduled jobs, and paid-API
   integrations. It does not replace the locally-installable vendor
   package; the two coexist because customers split on trust /
   connectivity / data-residency lines that aren't going away.

Adopt **DCO (Developer Certificate of Origin)** sign-off as the
licensing posture for OSS contributions (tracked separately in #170).
DCO is the lightest-weight option that gives clear per-commit
assertions that contributors had the right to license their
contributions under MIT — the same MIT that the paid tier relies on
when it reuses OSS code. Distinct from cryptographic commit signing
(intentionally dropped in #153 / [ADR-0010 era](0010-unified-project-with-area-views.md));
DCO solves a different problem.

**Explicitly out of scope of this ADR**: specific paid-tier names,
pricing, feature lists, hosted-vs-local SKU packaging, support
policies. Those are commercial decisions that change frequently
before launch and don't belong in a public architectural record
until they're real.

## Consequences

**Positive.**

- The OSS contributor base never sees, depends on, or accidentally
  ships into the paid codebase. The free product stays whole and
  independently useful — anyone can run the full CLI without ever
  knowing the paid tier exists.
- The plugin surface added for the paid tier is a generally useful
  capability — community plugins for custom outputs, sources, or
  workflows can use the same entry points.
- Adding `mgz-pkmn-vendor` later requires no changes to the OSS
  repo beyond the plugin surface (which is justified on its own).
  Decoupling the two codebases means the paid product can iterate
  on its own cadence without forcing OSS releases.
- "Vendor Cloud" as a future hosted layer is additive, not
  exclusive — it does not foreclose on serving customers who insist
  on local install for data-residency or trust reasons.
- DCO sign-off makes downstream commercial reuse unambiguous
  without imposing CLA friction or key-management burden on
  contributors.

**Negative.**

- The plugin surface is a public API the OSS project must
  maintain. Breaking it is a downstream-impact event, even if no
  community plugins exist yet.
- Two repos means two release cadences, two CI pipelines, two issue
  trackers, two sets of branch protection rules. The split is
  load-bearing but not free.
- Some OSS contributors may want to work on Vendor features and
  cannot; that's a known cost of the boundary and the right tradeoff
  given the alternative.
- DCO adds one CI gate to every PR. Friction is small (`git commit
  -s`) but non-zero, particularly for web-edits and contributors
  unfamiliar with the convention. Mitigated by docs and an optional
  `commit-msg` hook.

**Neutral.**

- This ADR documents the architectural commitment; commercial
  details (tier names, pricing, feature gating) are intentionally
  excluded and live in private planning artifacts until launch.
- "Vendor Cloud" being a separate delivery layer means the
  maintainer must decide separately whether to be in the
  infrastructure-operation business. The architecture doesn't force
  the decision; it preserves the option.

## Alternatives considered

- **Monorepo with paid-feature flags.** Paid features live in this
  repo behind build flags or an `enterprise/` directory; OSS users
  build without the flag. Rejected: continuous risk that
  well-meaning OSS contributors land on paid-tier code,
  continuous contributor-trust tax explaining why some directories
  are off-limits, license complexity (dual-licensing inside a single
  source tree is a known footgun). GitLab CE/EE is the canonical
  cautionary tale.

- **Fork-and-extend.** The paid repo is a private fork of the OSS
  repo that merges from upstream periodically. Rejected: produces
  compounding merge conflicts, requires the paid fork to track
  every OSS refactor, and lets the two codebases diverge until
  upstreaming gets impossible. Worse on every dimension than the
  plugin-surface approach.

- **Hosted-only paid surface, no client-side paid package.** The
  OSS CLI is the entire local product; paid features exist only on
  servers operated by the maintainer. Rejected as the *exclusive*
  approach because it forecloses on customers who require local
  install (vendors with sensitive inventory data, offline shows,
  data-residency requirements). Retained as an *additional* delivery
  layer per the third decision point above.

- **CLA instead of DCO.** Contributors sign a one-time agreement
  (typically out-of-band, via a bot) granting the project broader
  rights than the project license. Rejected for now: adds friction
  contributors notice (must sign something before first contribution),
  and the broader rights aren't needed when MIT already permits
  commercial reuse. Reconsider if the project ever needs to relicense
  or accept corporate contributors who require a CLA.
