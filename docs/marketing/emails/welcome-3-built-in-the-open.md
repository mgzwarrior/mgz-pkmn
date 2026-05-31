---
sequence: welcome-3
when: 5 days after welcome-2 (so ~1 week after subscribing)
audience: new newsletter subscriber
subject: "Built in the open — and how to jump in if you're so inclined"
preheader: "Source is on GitHub, the roadmap is public, and there's a good-first-issues lane if you want to ship."
---

![mgz-pkmn](https://raw.githubusercontent.com/mgzwarrior/mgz-pkmn/main/assets/logo.svg)

Hi —

Last one in the welcome run, then I'll go quiet until the next
release.

**mgz-pkmn is open source.** Not "open core, but the real product
is a SaaS" — actually open source. MIT-licensed Python CLI, MIT
React SPA, MIT Astro marketing site. Every line of code that
runs on the demo is in the repo:

→ <https://github.com/mgzwarrior/mgz-pkmn>

If you want to use the tool, ignore the rest of this email. The
rest of this email is for the chunk of subscribers who'd actually
rather *contribute* than just consume.

## The lay of the land

- **`src/mgz_pkmn/`** — the Python CLI. Click-based. The lookup
  pipeline, cache, output writers (xlsx / binder.pdf / checklist),
  and the CLI subcommands.
- **`api/`** — FastAPI service that wraps the CLI's lookup pipeline
  in HTTP / SSE so the web app can stream results.
- **`web/`** — React + Vite + Tailwind 4 SPA. The demo at
  mgz-pkmn.onrender.com.
- **`site/`** — Astro marketing site, the one you came in from.
- **`docs/adr/`** — Architecture Decision Records. Read these
  first if you want to understand *why* anything is the way it
  is.

## If you want to ship something

- **Good first issues** filtered on GitHub:
  <https://github.com/mgzwarrior/mgz-pkmn/labels/good%20first%20issue>
  Scoped, well-defined, mostly in the 1–3 hour range.
- **Discussions** for "is this a thing you'd accept a PR for"
  before you start: <https://github.com/mgzwarrior/mgz-pkmn/discussions>
- **Contributor guide** (DCO sign-off, branch naming, the local
  CI gate):
  <https://github.com/mgzwarrior/mgz-pkmn/blob/main/docs/contributing.md>

First-time contributors get celebrated in the project's
Discussions thread when their PR merges — small thing, but it's
genuinely the most fun part of running an open-source project.

## What I'm focused on

The v1.x line is about *real persistence + polish*. v2.0 is going
to be the harder architectural lift — multi-user collections,
binder organization, the front-of-house workflows that make this
tool useful **between** shows, not just on the morning of.

If that arc sounds interesting, the
[`docs/roadmap.md`](https://github.com/mgzwarrior/mgz-pkmn/blob/main/docs/roadmap.md)
is the source of truth for what's next.

Thanks for being here. I'll see you at the next release.

— Matt

---

*If you'd rather just hear when stuff ships, you're already
opted in. If you'd prefer to leave, unsubscribe is below — no
hard feelings.*
