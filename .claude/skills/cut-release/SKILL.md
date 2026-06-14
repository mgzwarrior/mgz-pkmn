---
name: cut-release
description: Cut the next mgz-pkmn release (vX.Y.Z). release-please drafts the version-bump PR (all surfaces) and a workflow syncs the lockfiles; this skill reviews that bot PR — running the CHANGELOG consolidation pass and the local gate — and pushes back. Use when the user asks to "cut a release", "ship vX.Y.Z", "do the release", "review the release PR", or similar.
---

# Cut the next mgz-pkmn release

release-please owns the mechanics now. Its bot PR bumps **every** version
surface (`pyproject.toml`, `api/pyproject.toml`, `web/package.json`,
`site/package.json`, `CITATION.cff`, `src/mgz_pkmn/__init__.py`) via the
`extra-files` config, and [`release-please-lock.yml`](../../.github/workflows/release-please-lock.yml)
re-syncs `uv.lock` + the two `package-lock.json` files on the branch. When the
PR merges, release-please tags the commit and cuts the GitHub Release, which
triggers [`release.yml`](../../.github/workflows/release.yml) to publish to PyPI
(trusted publishing + PEP 740 attestation). The full flow is in
[docs/contributing.md → Releasing](../../docs/contributing.md#releasing).

**Your job is the one thing automation can't do: curate the CHANGELOG prose.**
Do NOT merge the PR — the user does that.

## Step 1 — Find the bot's release PR

```bash
gh pr list --repo mgzwarrior/mgz-pkmn \
  --state open \
  --search "release-please in:title" \
  --json number,title,headRefName
```

The branch is `release-please--branches--main--components--mgz-pkmn`. Capture
the number as `BOT_PR` and the version it targets as `VERSION`. Check it out:

```bash
gh pr checkout <BOT_PR>
```

If **no** bot PR exists, either release-worthy commits haven't accumulated yet
or you're cutting an off-cycle / emergency release — follow
[docs/contributing.md → Doing it by hand](../../docs/contributing.md#doing-it-by-hand)
instead of this skill.

## Step 2 — CHANGELOG consolidation pass

release-please inserts a new versioned section at the top of `CHANGELOG.md`, one
bullet per Conventional Commit — terse subject literals in its own header format.
Reshape that section into the project's curated style. The marketing site and the
live-demo "what's new" surface render `CHANGELOG.md` verbatim, so the version
section you ship is exactly what every visitor reads.

**Rules:**

1. **Normalize the header + footer to Keep-a-Changelog style.** release-please
   emits `## [X.Y.Z](compare-link) (YYYY-MM-DD)`; the project uses
   `## [X.Y.Z] - YYYY-MM-DD` with the compare link in the footer at the bottom
   of the file. Match the existing `## [1.5.0] - …` sections and add an
   `[X.Y.Z]: …/compare/vPREV...vX.Y.Z` link to the footer. There is **no
   `[Unreleased]` section or footer link** — the project retired that placeholder
   (see [docs/contributing.md → Changelog](../../docs/contributing.md#changelog));
   the top of the file starts at the latest shipped release.
2. **Dedupe subsection headings.** One `### Added` / `### Changed` / `### Fixed`
   block per release. Collapse duplicates — multiple blocks break the marketing
   site's table of contents.
3. **Promote impactful entries to the top of each subsection.** Rank by
   user-visible weight: a new capability beats a refinement beats a bugfix beats
   a refactor. The top three bullets per subsection are what the live-demo
   "what's new" preview leads with.
4. **Drop or merge low-signal entries.** Drop dependency bumps with no behaviour
   change, CI-only tweaks, internal renames, formatting passes. Merge related
   small changes that share a theme into one bullet. Preserve the historical
   record for anything user-visible — reorder + merge, don't delete real changes.
5. **Lead each bullet with the surface it changes** (`Web:`, `API:`, `CLI:`,
   `Design:`, `DevOps:`) and **bold the user-facing headline** — the first
   sentence in `**bold**`, since the "what's new" preview shows only that
   sentence.
6. **No emoji in product copy** (per the design system; the 🌴 Exeggutor
   exception doesn't appear in the CHANGELOG).

## Step 3 — Bump the CITATION date

release-please bumps `version` in `CITATION.cff` but not the date. Set
`date-released` to today (`date +%Y-%m-%d`) so the "How to cite" sidebar matches
the release.

## Step 4 — Verify locally

```bash
make check               # ruff + format check + Python tests + web ESLint
cd web && npm run build  # web typecheck/build (make check doesn't cover this)
cd ../site && npm run build  # Astro build
```

All three must be green. Sanity-check the changelog parser sees the new release
as the latest shipped one:

```bash
uv run python -c "
from mgz_pkmn.changelog import parse_changelog
import pathlib
releases = parse_changelog(pathlib.Path('CHANGELOG.md').read_text())
shipped = [r for r in releases if r.version != 'Unreleased']
print('Latest shipped:', shipped[0].version, shipped[0].date)
"
```

Should print `Latest shipped: $VERSION <today>`.

## Step 5 — Push back + sync PR metadata

Push to the **bot's branch** (don't rename it; `gh pr checkout` set the upstream).
Sign off the commit (DCO is enforced) with a Conventional Commits subject:

```bash
git add -A
git commit -s -m "chore(release): consolidate v$VERSION changelog"
git push
```

Then sync **labels + milestone only** on the bot PR — don't open a competing PR
(release-please reuses the branch on the next `main` push, so a parallel PR breaks
its loop):

```bash
gh pr edit "$BOT_PR" --repo mgzwarrior/mgz-pkmn \
  --add-label "area:devops" --add-label "version:v1.x" --add-label "agent:claude" \
  --milestone "v$MILESTONE"
```

> ⚠️ **Never touch the bot PR body** (`--body` / `--body-file`). release-please
> embeds machine-readable release metadata there and re-parses it at merge time to
> create the tag + Release. Overwriting it makes release-please log `could not parse
> pull request body as a release PR` → no tag → no `release: published` event →
> nothing publishes, and the *next* release PR re-lists the same notes. This broke
> the v1.6.0 release (issue #651). The curated changelog already ships in
> `CHANGELOG.md`; if you want a human summary on the PR, post a separate
> `gh pr comment` instead.

## Step 6 — Wait for CI; do NOT merge

Watch the checks: `api (py3.11/3.12/3.13)`, `web`, `site`, `DCO`,
`Conventional Commits`, and `Analyze`. The `web` / `site` jobs may have flashed
red earlier on the version/lockfile mismatch — confirm the lockfile-sync commit
landed and they're green now. Report the PR URL + CI status to the user. **The
user merges the PR**; release-please tags, cuts the Release, and `release.yml`
publishes from there.

## Behaviours to avoid

- Don't merge the PR yourself.
- Don't open a competing PR or rename the bot's branch.
- Don't re-bump the version surfaces by hand — release-please already did, and
  the lock workflow already synced the lockfiles. Your only edits are the
  CHANGELOG prose and the `CITATION.cff` date.
- Don't overwrite the bot PR body (`gh pr edit --body`) — it carries release-please's
  machine-readable release metadata; clobbering it blocks tagging + publish (issue #651).
  Edit labels/milestone only; put any human summary in a `gh pr comment`.
- Don't re-add an empty `[Unreleased]` section to `CHANGELOG.md` — the project retired
  that placeholder; release-please drafts the next version's section from commits.
- Don't suggest a separate admin button, manual PyPI upload, or PAT — the merge
  is the trigger; everything downstream is automatic.
