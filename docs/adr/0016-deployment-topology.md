# ADR 0016: Production deployment topology — Cloudflare Pages + Render

- **Status:** Accepted
- **Date:** 2026-05-31
- **Tags:** infra, deploy

## Context

Three surfaces ship from this repo and need a production home:

1. The **marketing site** at `site/` — a pure static Astro build
   ([ADR-0011](0011-marketing-site-stack.md)).
2. The **demo web app** at `web/` (React SPA) + the **API** at
   `api/` (FastAPI on uvicorn) — a single Docker image built from
   the repo root, served at <https://mgz-pkmn.onrender.com>.
3. The custom **domain registrar** — `mgz-pkmn.com` and
   `matt-grant.com` (the maintainer's personal domain that also
   hosts the project's `www.matt-grant.com/mgz-pkmn` redirect line
   on the printed flyer).

The marketing site and the demo app have very different runtime
profiles: the site is static HTML/CSS/JS with no warm path, the
app needs Python + reportlab + Pillow + an HTTPS upstream to
`pokemontcg.io` and benefits from a persistent disk cache. Treating
them as the same workload would either bloat the static surface
with a Python runtime it doesn't need, or pay the static surface's
edge-CDN nothing for the app's actual hot path.

Constraints:

- Solo maintainer. No second control plane to babysit, no fixed
  monthly bill where a free tier covers the actual traffic.
- Auto-deploy on push to `main` for both surfaces — the existing
  ship cadence is "merge the PR, see it live in minutes."
- The demo SPA has been gradually getting heavier (binder PDF
  generation, persistence layer via [ADR-0013](0013-sqlite-persistence-for-runs-collections-wishlists.md),
  set-card warming on startup), so the app's memory and CPU
  ceilings need to scale without re-platforming.

## Decision

Split the two surfaces across the two providers that best fit
them, with a single registrar in front:

- **Marketing site (`site/`):** **Cloudflare Pages**, auto-deploy
  on push to `main`. Unmetered bandwidth, free TLS, free custom
  domain (`mgz-pkmn.com`). Pages config is one-time in the
  Cloudflare dashboard; the per-build config lives in
  [`site/README.md`](../../site/README.md). Codified in
  [ADR-0011](0011-marketing-site-stack.md).
- **Demo app (`api/` + `web/`):** **Render** as a Docker web
  service, blueprinted from [`render.yaml`](../../render.yaml) at
  the repo root, auto-deploy on push to `main`. The app starts on
  the free Hobby plan and is currently on **Starter** (512 MB RAM,
  0.5 CPU) to cover the binder-PDF and persistence-layer memory
  ceilings. Forced rebuilds happen via the existing manual *Deploy*
  GitHub Action (see [`docs/deployment.md`](../deployment.md)).
- **Domain registrar:** **Cloudflare Registrar** for both
  `mgz-pkmn.com` and the maintainer's `matt-grant.com`. At-cost
  pricing, no markup on renewals, and the registrar/Pages/DNS
  control plane is one tool.

Tier upgrades follow demand, not feature scope: if Render's free
spin-down (~30 s wake on cold start) becomes a real
papercut on a demo link in the README/Slack, that's the moment to
upgrade — which we've done once already (Hobby → Starter).

## Consequences

- The static marketing path is served entirely from Cloudflare's
  global edge — no cold starts, no compute meter, no bill.
- The app's autoscaling story is "scale the Render service up,"
  not "re-architect the deploy" — the existing `render.yaml`
  blueprint already covers env vars (`POKEMONTCG_IO_API_KEY`,
  `MGZ_PKMN_*`), so a plan bump is a one-click action.
- Two providers means two dashboards to log into when something
  breaks, which is real-but-mild overhead. Both have email/Slack
  alerting on deploy failures so the maintainer doesn't have to
  poll.
- Render's free tier's ~15-minute spin-down is the known
  rough edge — fine for casual demo traffic, jarring for someone
  clicking the README link cold. The Starter upgrade resolves this
  for the duration of the v1.x line.
- The repo's deploy story is reproducible from
  [`render.yaml`](../../render.yaml) (Render) plus
  [`site/README.md`](../../site/README.md) (Pages, one-time UI
  setup). Both surfaces could be torn down and re-created in under
  ten minutes from those files.
- Custom domain DNS lives in one Cloudflare account, so cert
  rotation and DNS edits happen in one place even though the
  origins are split across two providers.

## Alternatives considered

- **Everything on Render (site + app on the same web service).**
  Simpler in count-of-vendors terms; loses the edge CDN for the
  marketing path, and the marketing surface starts to pay for
  compute it doesn't use. Worse first-paint on the most-visited
  page.
- **Everything on Cloudflare (Pages for the site, Workers / Pages
  Functions for the app).** Tempting for the single-vendor story,
  but the app's runtime needs (Python + reportlab + Pillow + a
  persistent SQLite file, see [ADR-0013](0013-sqlite-persistence-for-runs-collections-wishlists.md))
  don't fit Workers' V8-isolate model without significant rewrite.
  Re-evaluate when/if a Python edge runtime matures.
- **Fly.io for the app.** Comparable feature set to Render with
  global anycast and per-region scale; Render's GitHub-integration
  UX and the existing `render.yaml` blueprint are why it stays.
  Cited in [`docs/deployment.md`](../deployment.md) as the move if
  Render ever stops working out.
- **Vercel for the marketing site.** Excellent DX, parity with
  Pages on the static path. Metered bandwidth on the free tier
  where Cloudflare is unmetered, and the single-vendor story with
  Cloudflare Registrar is cleaner.
- **GitHub Pages for the marketing site.** Free, in-repo, fine for
  static content. Loses Pages' integration with Cloudflare DNS and
  the at-cost registrar story; not worth the move.
