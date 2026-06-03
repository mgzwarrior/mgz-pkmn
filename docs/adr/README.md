# Architecture Decision Records

Architecture Decision Records (ADRs) capture *why* the project is built the
way it is — not the code (that's the source) and not how to use it (that's
the rest of `docs/`), but the load-bearing decisions and the tradeoffs that
went into them. They exist so that a contributor (or future-you) reading
the codebase a year from now can recover the *intent* behind a design,
not just the shape.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions in this directory | Accepted | 2026-05-09 |
| [0002](0002-multi-source-lookup-priority.md) | Layer three open data sources with explicit priority order | Accepted | 2026-05-09 |
| [0003](0003-click-and-uv-for-cli-tooling.md) | Click for the CLI; uv for dependency management | Accepted | 2026-05-09 |
| [0004](0004-disk-cache-with-mtime-ttl-and-overrides.md) | On-disk response cache with mtime TTL + sticky URL overrides | Accepted | 2026-05-09 |
| [0005](0005-reportlab-with-binderlayout-dataclass.md) | ReportLab + `BinderLayout` dataclass for PDF presets | Accepted | 2026-05-09 |
| [0006](0006-row-as-shared-output-shape.md) | A single `Row` shape feeds every output writer | Accepted | 2026-05-09 |
| [0007](0007-fastapi-and-sse-for-streaming-results.md) | FastAPI backend + Server-Sent Events for streaming lookup results | Accepted | 2026-05-09 |
| [0008](0008-two-pass-stable-sort-for-row-ordering.md) | Two-pass stable sort for compound row ordering | Accepted | 2026-05-09 |
| [0009](0009-docs-as-source-with-wiki-sync.md) | `docs/` is the source of truth; the GitHub Wiki is a mirror | Accepted | 2026-05-09 |
| [0010](0010-unified-project-with-area-views.md) | Single unified GitHub Project with per-area views | Accepted | 2026-05-12 |
| [0011](0011-marketing-site-stack.md) | Marketing site under `site/` (Astro + Tailwind, Cloudflare Pages) | Accepted | 2026-05-16 |
| [0012](0012-open-core-architecture.md) | Open-core architecture for a paid Vendor tier | Proposed | 2026-05-16 |
| [0013](0013-sqlite-persistence-for-runs-collections-wishlists.md) | SQLite + Alembic persistent store for runs, collections, and wishlists | Proposed | 2026-05-20 |
| [0014](0014-buttondown-for-email-subscriptions.md) | Buttondown for newsletter / email subscriptions | Accepted | 2026-05-31 |
| [0015](0015-tally-for-surveys.md) | Tally for marketing surveys (with a Buttondown migration clause) | Accepted | 2026-05-31 |
| [0016](0016-deployment-topology.md) | Production deployment topology — Cloudflare Pages + Render | Accepted | 2026-05-31 |
| [0017](0017-tropical-design-system.md) | Tropical design system — sun + palm + coconut, paired light/dark tokens | Accepted | 2026-05-31 |
| [0018](0018-structural-vs-volatile-cache-with-swr.md) | Structural / volatile cache split with stale-while-revalidate on pricing | Accepted | 2026-06-02 |
| [0019](0019-hosted-demo-identity-and-auth.md) | Hosted-demo identity and auth — cache-only anon, sign-in gates persistence, GitHub + magic-link + Google | Accepted | 2026-06-02 |

## Adding a new ADR

1. Copy [`template.md`](template.md) to the next number:
   `cp template.md NNNN-short-title-in-kebab-case.md`.
2. Fill it in. Keep it tight — most ADRs in this repo are 50–100 lines.
3. Add a row to the index table above (preserve numeric order).
4. If the new ADR replaces an old one, set the old one's status to
   *Superseded by ADR-NNNN* and link to the replacement.

The numbering is monotonic — never reuse a number, even for ADRs that
were never accepted. Status values you can use:

- **Proposed** — draft, not yet accepted. Open as a PR for review.
- **Accepted** — the current decision. Reflects what the code actually
  does. Most ADRs land here.
- **Superseded by ADR-NNNN** — replaced by a newer decision. Keep the
  file for history.
- **Deprecated** — the decision no longer applies but no replacement was
  recorded.

## When *not* to write an ADR

Most code doesn't need one. Reserve ADRs for decisions that:

- Constrain the shape of unrelated code that comes later.
- Have non-obvious alternatives someone else might reach for first.
- Are expensive to reverse later (anything that lands in a wire format,
  on-disk format, public CLI flag, etc.).

Day-to-day refactors, bug fixes, dependency bumps, and one-off layout
tweaks are not ADR material — they live in commits.
