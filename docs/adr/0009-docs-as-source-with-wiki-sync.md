# ADR 0009: `docs/` is the source of truth; the GitHub Wiki is a mirror

- **Status:** Accepted
- **Date:** 2026-05-09
- **Tags:** documentation, ci

## Context

The README grew to ~660 lines covering everything from install to
deployment recipes. The right shape is a thin landing page at the root
plus topical pages per concern, but the question of *where* those pages
live has two reasonable answers:

- **GitHub Wiki.** Built-in browser editor, separate sidebar nav, easy
  for casual contributors to update without a PR. Lives in a parallel
  `<repo>.wiki.git` repository — separate history, separate review
  surface.
- **`docs/` directory in the main repo.** Versioned alongside the code
  it describes, PR-reviewable, easy to keep in sync with code changes,
  but loses the in-browser Wiki UI for readers who don't want to think
  about the repo file tree.

The Wiki and an in-repo `docs/` are not mutually exclusive — they just
need a clear answer to "which is canonical?"

## Decision

[`docs/`](..) is the single source of truth. The GitHub Wiki is an
auto-generated mirror. The
[`.github/workflows/sync-wiki.yml`](../../.github/workflows/sync-wiki.yml)
workflow runs on every push to `main` that touches `docs/**`, mirrors
the directory's contents into the Wiki repo, and rewrites intra-doc
links so they resolve in the Wiki's flat namespace
(e.g. `[link](cli.md)` → `[link](cli)` in the mirror).

`docs/README.md` becomes `Home.md` in the Wiki via a simple rename in
the workflow.

Direct edits in the Wiki UI get clobbered on the next sync. The Wiki
landing page (which itself is a synced page) carries an "edit at
[`docs/`](https://github.com/mgzwarrior/mgz-pkmn/tree/main/docs) instead"
notice for visiting contributors.

## Consequences

- One place to change docs (the repo). Pull requests for documentation
  go through the same review as code changes.
- The Wiki gets the friendlier reading experience (left-rail nav, no
  need to think about file paths) without diverging from canonical
  content.
- The link rewriter is a small Python snippet inline in the workflow.
  It handles the intra-doc-relative case but punts on edge cases
  (cross-repo links to `../api/README.md` etc. — those stay as-is and
  resolve back to the GitHub repo from the Wiki).
- Adding a new doc page is a regular PR; the workflow handles the
  mirror.
- One-time setup is required for the Wiki to receive content: the
  user has to enable the Wiki under repo Settings → Features → Wikis
  and create at least one placeholder page so the wiki repo exists.
  Documented in the workflow's header comment.

## Alternatives considered

- **Wiki-canonical, no `docs/` in repo.** Loses PR review for doc
  changes and decouples docs from the code commits that motivate them.
- **`docs/` only, no Wiki.** Loses the casual-reader experience of a
  dedicated docs site. Minimal cost to also publish to the Wiki, so
  no reason not to.
- **GitHub Pages / mkdocs / Docusaurus.** Heavier build pipeline for
  the same reader experience. Wiki sync is a single workflow file
  with no extra dependencies; we can revisit if `docs/` ever needs
  features the Wiki can't render (search, full-text indexing,
  versioned snapshots, …).
