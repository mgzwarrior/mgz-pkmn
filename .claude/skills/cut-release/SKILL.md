---
name: cut-release
description: Cut the next mgz-pkmn release (vX.Y.Z). Creates a tracking issue if one doesn't exist, bumps every surface to the same version, rotates CHANGELOG, opens the release PR. Use when the user asks to "cut a release", "ship vX.Y.Z", "do the release", "bump to X.Y.Z", or similar.
---

# Cut the next mgz-pkmn release

You are cutting a versioned release of `mgz-pkmn`. The release flow is
captured in [docs/contributing.md → Releasing](../../docs/contributing.md#releasing),
and the v1.2.0 PR (#357) is the canonical recent example to copy from.

The version-bump PR **is** the release — merging it to `main` triggers
[`release-on-version-bump.yml`](../../.github/workflows/release-on-version-bump.yml)
which tags the commit, which triggers [`release.yml`](../../.github/workflows/release.yml)
to publish to PyPI (trusted publishing + PEP 740 attestation) and cut a
GitHub Release. Do NOT merge the PR yourself.

## Step 1 — Resolve the target version

Ask the user for the target version if it isn't obvious from context.
Default reasoning:

- Open `pyproject.toml` and read the current root `version = "X.Y.Z"`.
- For a patch fix-up release, bump Z. For new user-facing features, bump
  Y. Bumping X is a deliberate v2.0 decision — don't infer it.

Record the version as `VERSION` and today's ISO date as `RELEASE_DATE`
(`date +%Y-%m-%d`).

## Step 2 — Find or open the tracking issue

Every change must be traceable to an issue. Check whether a release issue
already exists for `VERSION`:

```bash
gh issue list --repo mgzwarrior/mgz-pkmn --state open \
  --search "v$VERSION Release in:title" --json number,title,milestone
```

Look for a title like `v$VERSION Release` (the existing convention — see
#349 for v1.2). If one exists, capture its number as `ISSUE`. If none,
open one:

```bash
gh issue create --repo mgzwarrior/mgz-pkmn \
  --title "v$VERSION Release" \
  --label "area:devops" --label "version:v1.x" --label "type:docs" \
  --milestone "v$MILESTONE" \
  --project "mgz-pkmn" \
  --body "<see body template below>"
```

The milestone should match the version's minor (e.g. `v1.2` for any
`1.2.x`). Body template (mirrors the #349 shape):

```markdown
- Audit current versions across `pyproject.toml`, `api/pyproject.toml`,
  `web/package.json`, `site/package.json`, `CITATION.cff`.
- Align everything to v$VERSION in a single PR.
- Rotate the long `[Unreleased]` CHANGELOG section under
  `## [$VERSION] - $RELEASE_DATE`.
- Release flow is documented in `docs/contributing.md`; this issue
  exists so the bump is traceable on the project board.
```

Capture the issue number as `ISSUE`.

## Step 3 — Find the bot's release branch, or open one

**Check for an existing release-please PR before doing anything else.** Once #68's release-please flow is in place, the bot watches `main` and opens a draft version-bump PR whenever release-worthy Conventional Commits land. If one already exists for the current version arc, the cut-release flow **extends that bot PR on its own branch** — opening a parallel human-authored PR breaks release-please's loop (it reuses the same branch on the next `main` push) and produces a duplicate that has to be reconciled by hand.

```bash
gh pr list --repo mgzwarrior/mgz-pkmn \
  --state open \
  --author "app/github-actions" \
  --search "release-please" \
  --json number,title,headRefName
```

### If a release-please PR exists

Check it out and reuse its branch. Steps 4 + 5 apply on top of the bot's existing root `pyproject.toml` bump + CHANGELOG rotation — you're extending, not starting from scratch.

```bash
gh pr checkout <PR_NUMBER>
```

Capture the bot PR number as `BOT_PR`. Subsequent steps (commit, push) target this branch; Step 8 (PR open) is replaced by a "extend the bot PR's body" pass.

### If no release-please PR exists

Either release-please-able commits haven't accumulated yet, the bot is misconfigured, or you're cutting a manual / emergency release. Branch off `main` the normal way:

```bash
git checkout main && git pull origin main
git checkout -b "$ISSUE-v$VERSION-release"
```

Branch name is `<issueNumber>-v<version>-release` per the project's branch-naming rule (number prefix + short kebab description).

## Step 4 — Bump versions across every surface

**Five surfaces must move to the same number.** Per
[`docs/contributing.md`](../../docs/contributing.md#releasing):

| Surface | Files | Follow-up |
|---|---|---|
| CLI | `pyproject.toml` (root, `^version = "..."`), `src/mgz_pkmn/__init__.py` (`__version__ = "..."`) | `uv lock` to refresh `uv.lock` |
| API | `api/pyproject.toml` (`^version = "..."`) | — |
| Web SPA | `web/package.json` (top-level `"version"`) | `cd web && npm install` (refreshes `web/package-lock.json`) |
| Marketing site | `site/package.json` (top-level `"version"`) | `cd site && npm install` (refreshes `site/package-lock.json`) |
| Citation | `CITATION.cff` (`version: "..."` and `date-released: "..."`) | — |

Only the root `pyproject.toml` is load-bearing for the release
automation, but aligning every surface in one PR keeps the mental
model "the project is at version X" instead of "each folder is on its
own number." Don't skip any of the five.

After editing, run `uv lock` and the two `npm install`s once — they're
fast and idempotent.

## Step 5 — Consolidate, then rotate the CHANGELOG

Two passes on `CHANGELOG.md`, in order. The consolidation is the
**load-bearing editorial pass** that #571 codified — the marketing site
and the live-demo "what's new" surface render the CHANGELOG verbatim,
so the version section the releasing agent / human ships is exactly
what every visitor reads.

### Step 5a — Consolidation pass over `[Unreleased]`

Walk the existing `[Unreleased]` section and apply the rules below
before rotating it into a versioned section. This is editorial work —
no automation makes the call about what's "most impactful"; release-
please (#68) drafts the bullets from Conventional Commits, the agent /
human curates them.

**Rules:**

1. **Dedupe subsection headings.** Collapse multiple `### Added` /
   `### Changed` / `### Fixed` blocks within `[Unreleased]` into one
   block per heading. The Keep-a-Changelog spec allows one of each
   per release; multiple blocks are noise that breaks the marketing
   site's table-of-contents.
2. **Promote impactful entries to the top of each subsection.**
   Rank by user-visible weight: a new top-level capability beats a
   refinement, a refinement beats a bugfix description, a bugfix
   beats a refactor that happened to surface here. The top three
   bullets in each subsection are what the live-demo "what's new"
   preview will lead with — order accordingly.
3. **Drop or merge low-signal entries.**
   - **Drop:** dependency bumps with no behaviour change, CI-only
     tweaks, internal renames, formatting passes, test additions
     against unchanged code.
   - **Merge:** related small changes that share a theme. Three
     incremental commits to the same screen become one bullet.
   - Preserve the historical record for anything user-visible —
     don't delete real changes, even small ones; reorder + merge.
4. **Lead each bullet with the surface it changes.** Existing
   convention: `Web:`, `API:`, `CLI:`, `Design:`, `DevOps:`. Use the
   same prefix release-please / Conventional Commits scopes used.
5. **Bold the user-facing headline.** First sentence in `**bold**`,
   matching the existing pattern. The marketing site's "what's new"
   preview shows only that first sentence.
6. **No emoji in product copy.** Per the design system guide; the
   single exception (🌴 Exeggutor) doesn't appear in the CHANGELOG.

When release-please opened the original bot PR, the bullets it
generated map directly from commit subjects. The consolidation pass
edits them into the shape above. Don't blindly accept the bot's
ordering or wording.

### Step 5b — Rotation

After the consolidation pass:

1. Rename the existing `## [Unreleased]` heading to `## [$VERSION] - $RELEASE_DATE`.
2. Insert a fresh empty `## [Unreleased]` block above it. Don't add
   `### Changed/Added/Fixed` subheadings to the empty section — they
   appear when the first entry lands.
3. Update the compare-links footer at the bottom of the file:

   ```
   [Unreleased]: https://github.com/mgzwarrior/mgz-pkmn/compare/v$VERSION...HEAD
   [$VERSION]: https://github.com/mgzwarrior/mgz-pkmn/compare/v$PREV_VERSION...v$VERSION
   ```

   where `$PREV_VERSION` is the immediately previous shipped version
   (the next compare-link entry that already exists).

### When you're extending a release-please PR

If you came from Step 3 having checked out the bot's branch (`BOT_PR` set), the bot has already done part of the work — root `pyproject.toml` is bumped and `[Unreleased]` is rotated into a versioned section. The consolidation pass in 5a still applies (the bot's bullets are commit-subject literals; the editorial pass shapes them). The rotation in 5b is partially done — you're auditing what the bot wrote, not redoing it from scratch.

## Step 6 — Verify locally

```bash
make check               # ruff + format check + Python tests + web ESLint
cd web && npm run build  # web typecheck/build (make check doesn't cover this)
cd ../site && npm run build  # Astro build
```

All three must be green. If `make check` was failing before the bump,
note it in the PR body — don't try to fix unrelated failures in a
release PR.

Also sanity-check the changelog parser sees the new release as the
latest shipped one:

```bash
uv run python -c "
from mgz_pkmn.changelog import parse_changelog
import pathlib
releases = parse_changelog(pathlib.Path('CHANGELOG.md').read_text())
shipped = [r for r in releases if r.version != 'Unreleased']
print('Latest shipped:', shipped[0].version, shipped[0].date)
"
```

Should print `Latest shipped: $VERSION $RELEASE_DATE`.

## Step 7 — Commit + push

Sign off the commit (DCO is enforced). The Conventional Commits check requires the `<type>(<scope>)?!?: <subject>` format — `chore(release):` is the right prefix for the release commit.

**If you're extending a bot PR (`BOT_PR` set from Step 3):** push to the existing bot branch (`gh pr checkout` already set the upstream). Don't change the branch name. The bot's commit stays as the first commit in the PR; yours is the extension.

```bash
git add -A
git commit -s -m "chore(release): extend v$VERSION bump across remaining surfaces

<commit body — see template below>
"
git push
```

**If you branched off `main` (no bot PR):**

```bash
git add -A
git commit -s -m "chore(release): v$VERSION

<commit body — see template below>
"
git push -u origin "$ISSUE-v$VERSION-release"
```

Commit body template:

```
Aligns every surface on v$VERSION in one PR so the artifacts ship the
same number:

- CLI: pyproject.toml + src/mgz_pkmn/__init__.py + uv.lock
       ($PREV_VERSION → $VERSION)
- API: api/pyproject.toml ($API_PREV → $VERSION)
- Web SPA: web/package.json + web/package-lock.json ($WEB_PREV → $VERSION)
- Marketing site: site/package.json + site/package-lock.json
                  ($SITE_PREV → $VERSION)
- Citation: CITATION.cff (version + date-released)

Rotates CHANGELOG.md: renames the [Unreleased] section to
[$VERSION] - $RELEASE_DATE, inserts a fresh empty [Unreleased]
block above it, and updates the compare links footer.

Merging this PR triggers release-on-version-bump.yml, which tags
v$VERSION and triggers release.yml to publish to PyPI with PEP 740
attestation and cut a GitHub Release.

Closes #$ISSUE
```

## Step 8 — Open or extend the PR

The body template is the same regardless of whether you're opening a fresh PR or replacing the bot's draft body — defining it once in a shell variable keeps the two paths from drifting. Pull the issue's metadata first:

```bash
gh issue view "$ISSUE" --repo mgzwarrior/mgz-pkmn --json labels,milestone
```

Then build the shared body:

```bash
PR_BODY=$(cat <<EOF
Closes #$ISSUE

## What

Cuts the **v$VERSION** release. Aligns every surface on the same
version in one PR:

| Surface | File(s) | Was → Now |
|---|---|---|
| CLI | \`pyproject.toml\`, \`src/mgz_pkmn/__init__.py\`, \`uv.lock\` | … → $VERSION |
| API | \`api/pyproject.toml\` | … → $VERSION |
| Web SPA | \`web/package.json\`, \`web/package-lock.json\` | … → $VERSION |
| Marketing site | \`site/package.json\`, \`site/package-lock.json\` | … → $VERSION |
| Citation | \`CITATION.cff\` (\`version\` + \`date-released\`) | … → $VERSION / $RELEASE_DATE |

Rotates \`CHANGELOG.md\`: renames the long \`[Unreleased]\` section to
\`[$VERSION] - $RELEASE_DATE\`, inserts a fresh empty \`[Unreleased]\`
block above it, and updates the compare-links footer. Applies the
consolidation pass (Step 5a) so duplicate \`### Added\` / \`### Changed\` /
\`### Fixed\` blocks within the release are collapsed and impactful
entries lead each subsection.

## Why

The version bump PR **is** the release. Once this merges to \`main\`,
the auto-release flow tags \`v$VERSION\`, publishes to PyPI with PEP 740
attestation, and cuts a GitHub Release.

## How to verify

- [ ] \`make check\` is green.
- [ ] \`cd web && npm run build\` is green.
- [ ] \`cd site && npm run build\` is green.
- [ ] \`uv run pkmn --version\` reports \`pkmn, version $VERSION\`.
- [ ] \`curl http://localhost:8000/version\` returns \`{"version": "$VERSION"}\`.
- [ ] \`GET /api/v1/changelog\` parses \`[$VERSION] - $RELEASE_DATE\` as the latest shipped release.
- [ ] After merge: \`release-on-version-bump\` workflow tags \`v$VERSION\`,
      \`release.yml\` publishes to PyPI, GitHub Release appears.

## Out of scope

- Backport release notes to the Wiki (\`sync-wiki.yml\` handles this).
EOF
)
```

Note: the heredoc is **unquoted** (`<<EOF`, not `<<'EOF'`) so `$VERSION`, `$ISSUE`, `$RELEASE_DATE`, and `$MILESTONE` interpolate; the backticks in the body are escaped (`\``) so the shell doesn't try to execute them as command substitutions.

**If you're extending a bot PR (`BOT_PR` set from Step 3):** the PR already exists — edit its labels + body in place. Don't open a parallel `gh pr create` (release-please reuses the branch on the next `main` push and a competing PR breaks that loop).

```bash
gh pr edit "$BOT_PR" --repo mgzwarrior/mgz-pkmn \
  --add-label "area:devops" --add-label "version:v1.x" --add-label "type:docs" \
  --add-label "agent:claude" \
  --milestone "v$MILESTONE" \
  --body "$PR_BODY"
```

The `Closes #$ISSUE` line is already in `$PR_BODY` so the bot PR will auto-close the tracking issue on merge.

**If you branched off `main` (no bot PR):** open the PR fresh with the same body.

```bash
gh pr create --repo mgzwarrior/mgz-pkmn \
  --title "chore(release): v$VERSION" \
  --label "area:devops" --label "version:v1.x" --label "type:docs" \
  --label "agent:claude" \
  --milestone "v$MILESTONE" \
  --project "mgz-pkmn" \
  --body "$PR_BODY"
```

## Step 9 — Wait for CI; do NOT merge

Watch the CI checks: `api (py3.11/3.12/3.13)`, `web`, `site`, `DCO`,
and `Analyze` jobs all need to pass. Report the PR URL + CI status to
the user. The user merges the PR.

If conflicts appear because other PRs landed on `main` between your
branch + the user's merge attempt:

```bash
git checkout "$ISSUE-v$VERSION-release"
git pull origin main --no-rebase     # creates a merge commit
# resolve CHANGELOG.md conflicts: any [Unreleased] bullets that landed
# on main while this branch was open get folded into [$VERSION]; the
# fresh [Unreleased] section stays empty.
git add -A && git commit --no-edit
git push origin "$ISSUE-v$VERSION-release"
```

## Behaviours to avoid

- Don't merge the PR yourself.
- Don't suggest a separate admin button, manual PyPI upload, or PAT —
  the merge to main is the trigger; everything downstream is automatic.
- Don't bump only some surfaces — the five-surface alignment is the
  whole point.
- Don't add subheadings to the empty `[Unreleased]` block; they appear
  when the first bullet lands.
- Don't skip the `uv lock` / `npm install` lockfile refreshes — stale
  lockfiles break CI.
