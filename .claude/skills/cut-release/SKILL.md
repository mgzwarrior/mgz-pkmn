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

## Step 3 — Branch off latest main

```bash
git checkout main && git pull origin main
git checkout -b "$ISSUE-v$VERSION-release"
```

Branch name is `<issueNumber>-v<version>-release` per the project's
branch-naming rule (number prefix + short kebab description).

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

## Step 5 — Rotate the CHANGELOG

In `CHANGELOG.md`:

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

Sign off the commit (DCO is enforced):

```bash
git add -A
git commit -s -m "chore: release v$VERSION

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

## Step 8 — Open the PR

Pull the issue's labels + milestone first (so the PR mirrors them):

```bash
gh issue view "$ISSUE" --repo mgzwarrior/mgz-pkmn --json labels,milestone
```

Open the PR with that metadata + the project board:

```bash
gh pr create --repo mgzwarrior/mgz-pkmn \
  --title "chore: release v$VERSION" \
  --label "area:devops" --label "version:v1.x" --label "type:docs" \
  --milestone "v$MILESTONE" \
  --project "mgz-pkmn" \
  --body "$(cat <<'EOF'
Closes #$ISSUE

## What

Cuts the **v$VERSION** release. Aligns every surface on the same
version in one PR:

| Surface | File(s) | Was → Now |
|---|---|---|
| CLI | `pyproject.toml`, `src/mgz_pkmn/__init__.py`, `uv.lock` | … → $VERSION |
| API | `api/pyproject.toml` | … → $VERSION |
| Web SPA | `web/package.json`, `web/package-lock.json` | … → $VERSION |
| Marketing site | `site/package.json`, `site/package-lock.json` | … → $VERSION |
| Citation | `CITATION.cff` (`version` + `date-released`) | … → $VERSION / $RELEASE_DATE |

Rotates `CHANGELOG.md`: renames the long `[Unreleased]` section to
`[$VERSION] - $RELEASE_DATE`, inserts a fresh empty `[Unreleased]`
block above it, and updates the compare-links footer.

## Why

The version bump PR **is** the release. Once this merges to `main`,
the auto-release flow tags `v$VERSION`, publishes to PyPI with PEP 740
attestation, and cuts a GitHub Release.

## How to verify

- [ ] `make check` is green.
- [ ] `cd web && npm run build` is green.
- [ ] `cd site && npm run build` is green.
- [ ] `uv run pkmn --version` reports `pkmn, version $VERSION`.
- [ ] `curl http://localhost:8000/version` returns `{"version": "$VERSION"}`.
- [ ] `GET /api/v1/changelog` parses `[$VERSION] - $RELEASE_DATE` as the latest shipped release.
- [ ] After merge: `release-on-version-bump` workflow tags `v$VERSION`,
      `release.yml` publishes to PyPI, GitHub Release appears.

## Out of scope

- Backport release notes to the Wiki (`sync-wiki.yml` handles this).
EOF
)"
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
