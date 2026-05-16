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
   maybe a hosted convenience layer for persistence (saved want-lists,
   run history, sync across devices). A card-shop vendor needs
   multi-user accounts, persistent inventory, acquisition-cost comps,
   and integrations with paid third-party APIs. These aren't
   gradations of the same product — they serve different jobs, and
   their hosted-infrastructure expectations differ accordingly:
   collectors are price-sensitive and will share infrastructure with
   other collectors; vendors expect tenant isolation strong enough to
   treat their inventory and pricing data as private.

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

3. **Hosted offerings are additional delivery layers over the same
   plugin surface — not a single product, but a small family,
   matched to the audience.** Two distinct hosted shapes are
   anticipated:

   - **Cloud (for collectors)** — multi-tenant on shared
     infrastructure operated by the maintainer. Adds the persistence
     features collectors will plausibly pay a few dollars a month for
     (saved want-lists, run history, scheduled re-pricing, email /
     Discord delivery of generated outputs), without any of the
     vendor-only machinery. Economically only viable as multi-tenant
     at the collector price point, which is itself an architectural
     constraint: every query is scoped to a user, no per-customer
     infra footprint.
   - **Vendor Cloud (for vendors)** — runs the OSS CLI plus the
     vendor plugin with stronger tenant isolation than Cloud — at
     minimum strict per-tenant data segregation, plausibly dedicated
     compute for larger customers. Adds the vendor-only capabilities
     (multi-user, inventory state, acquisition-cost comps,
     paid-third-party-API integrations).

   Neither hosted layer replaces a locally-installable equivalent:
   collectors keep the free OSS CLI, vendors keep the locally
   installable `mgz-pkmn-vendor` package. Customers split on trust /
   connectivity / data-residency lines that aren't going away, and
   the architecture preserves that optionality on both sides.

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
- Both hosted layers (Cloud for collectors, Vendor Cloud for
  vendors) are additive, not exclusive — they don't foreclose on
  serving customers who insist on the locally-installable
  equivalent for data-residency, trust, or offline-use reasons.
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
- Operating two hosted shapes with different isolation guarantees
  (multi-tenant Cloud, more isolated Vendor Cloud) is genuinely
  more work than operating one. The architecture preserves the
  option to defer either indefinitely — but if both ship, the
  application layer must enforce tenant scoping correctly on
  every query in Cloud, and the deploy story for Vendor Cloud
  needs to make per-tenant separation cheap. Both are real costs
  worth flagging before commitment.

**Neutral.**

- This ADR documents the architectural commitment; commercial
  details (tier names, pricing, feature gating) are intentionally
  excluded and live in private planning artifacts until launch.
- Both hosted layers being separate delivery layers means the
  maintainer can decide independently per audience whether to be
  in the infrastructure-operation business — ship Cloud without
  Vendor Cloud, ship neither, ship both, in any order. The
  architecture doesn't force any of those decisions; it preserves
  the optionality.

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

- **Single hosted tier serving both collectors and vendors.** One
  hosted product, isolation good enough for vendors, priced low
  enough for collectors. Rejected because the two ends of that
  range are economically incompatible: collector-grade pricing only
  works on shared infrastructure, vendor-grade isolation only works
  on per-tenant separation. Trying to bridge them collapses to
  serving one audience badly. Two distinct hosted shapes is the
  honest split.

- **CLA instead of DCO.** Contributors sign a one-time agreement
  (typically out-of-band, via a bot) granting the project broader
  rights than the project license. Rejected for now: adds friction
  contributors notice (must sign something before first contribution),
  and the broader rights aren't needed when MIT already permits
  commercial reuse. Reconsider if the project ever needs to relicense
  or accept corporate contributors who require a CLA.
