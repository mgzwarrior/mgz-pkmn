# Roadmap

A working brainstorm of what shipping a polished **V1** looks like, plus
where each part of the tool could go in a larger **V2** push. Issues
listed here are *stubs* — drafted in markdown so they can be reviewed
and refined before being filed on GitHub.

The current version is `0.1.0` (per [`pyproject.toml`](../pyproject.toml)).
"V1" here means the version we'd be comfortable cutting as a 1.0 release
and pointing strangers at — that requires closing out a small set of
polish gaps below before tagging.

## Project areas

The codebase splits cleanly into five areas, each of which has its own
maintenance and growth trajectory:

| Area | Owns | Key files |
|---|---|---|
| **Lookup engine** | Parse user input, resolve cards across data sources, attach pricing. | [`parser.py`](../src/mgz_pkmn/parser.py), [`lookup.py`](../src/mgz_pkmn/lookup.py), [`sources/`](../src/mgz_pkmn/sources/), [`pricing.py`](../src/mgz_pkmn/pricing.py) |
| **Output artifacts** | Render rows into spreadsheet / PDFs / checklist / JSON. | [`spreadsheet.py`](../src/mgz_pkmn/spreadsheet.py), [`binder.py`](../src/mgz_pkmn/binder.py), [`checklist.py`](../src/mgz_pkmn/checklist.py), [`report.py`](../src/mgz_pkmn/report.py) |
| **Cache & persistence** | Disk cache for API responses and URL overrides. | [`cache.py`](../src/mgz_pkmn/cache.py) |
| **Web UI / API** | FastAPI service + React SPA that wraps the CLI pipeline. | [`api/`](../api/), [`web/`](../web/) |
| **DevOps & release** | CI, deployment, packaging, distribution. | [`Makefile`](../Makefile), [`.github/workflows/`](../.github/workflows/), [`Dockerfile`](../Dockerfile), [`render.yaml`](../render.yaml) |

---

## V1 completion

Polish gaps and known-limitation items that should land before a 1.0
tag. Estimated cost is small for most — the goal of V1 is not new
functionality but a *defensible* release.

### Lookup engine — V1

- **Apply inline price filters to single-card lookups too.** Today
  `Charizard | Base | 4 >= $100` parses the bound but doesn't act on
  it. Either honor it or warn the user that it's been ignored.
- **Distinguish `>` from `>=` and `<` from `<=`.** The comparator
  parser collapses all four to inclusive bounds. Pick a direction and
  fix or document.
- **Currency-aware price filtering.** `--max-price 50` is currently
  applied to the raw market figure regardless of `$` vs `€`. At
  minimum, document it loudly; ideally, gate the comparison by
  currency.
- **Raise a structured error rather than panicking on a malformed
  PriceCharting URL.** Today the scraper can throw an unhelpful
  `requests.HTTPError`. Wrap it in `MatchResult(None, "scrape_failed")`
  with the URL.
- **Add a regression test for the word-boundary post-filter on Mew.**
  The fix exists in code; cement it with a test before V1 so future
  refactors don't reintroduce Mewtwo-as-Mew.

### Output artifacts — V1

- **Add a sort-mode field to the JSON report.** `summary.sort_mode`
  alongside `version`, `elapsed_seconds`. Makes JSON consumers
  reproducible.
- **Embed thumbnails in xlsx even when `--no-images` was passed via
  the API export.** Currently a UI-driven xlsx export gets no images;
  document this or change it.
- **Tighten checklist truncation tests.** The 6-column checklist has
  aggressive name truncation; add a fixture with long names
  (`V-UNION`, `Special Illustration Rare` etc.) and assert no overflow.
- **Add a `--print-summary-only` mode.** Useful when iterating on
  inputs — runs the lookup and prints the summary line without writing
  any artifacts.
- **Sample-output regeneration target.** `make refresh-examples` that
  re-runs `pkmn input/ --no-images …` so the tracked
  [`output/`](../output/) artifacts stay current. Avoid silent drift.

### Cache & persistence — V1

- **Show cache hit rate in the CLI summary.** When non-zero hits
  occurred, append `· N cached / M fetched` to the summary line.
- **Bound the cache directory size.** No LRU yet; at least add a
  warning log when the cache dir exceeds 50 MB.
- **Migrate `url_overrides.json` to a versioned schema.** Today it's a
  bare dict; wrap it in `{"schema_version": 1, "overrides": {…}}` so
  future schema changes have a fallback path.
- **`pkmn cache stats` subcommand.** Print the cache size, oldest
  entry, override count. Trivial; useful for debugging.
- **Document the `MGZ_PKMN_NO_CACHE` env var.** It exists in code,
  isn't mentioned in the docs.

### Web UI / API — V1

- **Add an `LICENSE` file** (likely MIT given the README's
  "personal tool" framing). PyPI / Hatch release will block on this.
- **API tests for `/parse`, `/lookup`, `/sets`, `/overrides`.** Today
  only `/export` is covered. Same `fastapi.TestClient` shape we used
  for `tests/test_export_api.py`.
- **Vitest setup + smoke tests for the web frontend.** At least one
  test per component (`ExportBar`, `SettingsDrawer`, `ResultsTable`,
  `InputEditor`) verifying it renders without error against fixture
  data.
- **Error boundary in the SPA.** A blank page on a render error is
  worse than an error message. Wrap the app root in a `<ErrorBoundary>`
  that displays the error.
- **`Sort order` field in `SettingsDrawer` should reset to `number`
  via a "Restore defaults" button.** Currently no escape hatch if
  someone scrolls into a weird state.
- **Expose `--dedupe` in the web UI.** It's in the settings type but
  there's no toggle for it.

### DevOps & release — V1

- **Add a `LICENSE` file at the repo root.** Cross-listed with
  Web UI / API.
- **GitHub issue + PR templates** under `.github/ISSUE_TEMPLATE/` —
  bug, feature, docs, plus a generic PR template.
- **CHANGELOG.md** seeded with everything between `0.1.0` and the
  upcoming `1.0.0`. Going forward, every PR adds an entry under
  `[Unreleased]`.
- **Polish `pyproject.toml` metadata for PyPI.** `description`,
  `keywords`, `classifiers`, `urls`. The current description doesn't
  even mention the PDF / checklist / web UI.
- **Confirm Render and Docker recipes still work post-restructure.**
  Both reference paths that haven't changed, but a quick smoke test
  before tagging avoids embarrassment.

---

## V2 directions

Genuine new capability per area — the kind of work that takes more than
an afternoon, has design tradeoffs worth talking through, and benefits
from being scoped as its own GitHub issue with thread + PR.

### Lookup engine — V2

- **Structured query DSL.** A small grammar like
  `top:N subtype:V,VMAX in "Surging Sparks" rarity:rare>=$50`. The
  parser already does a lot of pattern-matching; codify that into a
  proper grammar so tests can assert exact behaviour rather than
  inferring it from outputs.
- **Add eBay sold listings as a fourth price source.** Useful for
  PriceCharting holes and for ground-truth comp data. Opt-in (rate
  limits) via `--ebay`.
- **Cache TCGdex responses too.** Today only pokemontcg.io. Big win
  for runs heavy on Japanese / Chinese cards.
- **Card disambiguation when multiple matches tie.** Today the scoring
  picks one; surface ambiguity in the JSON report as
  `"alternatives": [{...}]` so users can review near-misses.
- **Pluggable name aliases.** `top 5 ナッシー` should work as well as
  `top 5 Exeggutor`. A small data file mapping localized names back to
  English query targets.
- **Parser exposed as a public function.** `parse_lines(text) →
  list[CardQuery]` with type hints so downstream tools (Discord bots,
  scripts) can reuse it.

### Output artifacts — V2

- **Configurable comp tiers.** Currently fixed at 80/85/90/95%. A
  flag (`--comps 70,80,90`) lets the user pick the percentages that
  match how they negotiate.
- **Per-section charts in xlsx.** A small `Charts` worksheet with
  per-tag price-distribution + most-valuable bar charts.
- **HTML output mode.** Single-file HTML with embedded thumbnails for
  sharing a wishlist by URL. `--html cards.html`.
- **Custom binder layouts via TOML.** Users supply their own
  `BinderLayout` instance via a config file rather than editing
  Python.
- **Color-coded rarity in xlsx.** Rare-Holo cells in gold,
  Illustration Rare in lavender, etc. Cosmetic but useful for fast
  scanning.
- **Skip-already-owned mode.** Pair the checklist with a "what I
  own" list (TXT or xlsx); the binder + checklist filter to only
  cards not already owned.

### Cache & persistence — V2

- **LRU eviction with size cap.** Today the cache grows unbounded.
  Add a configurable `MGZ_PKMN_CACHE_MAX_MB` with a default of ~100.
- **`pkmn cache compact` subcommand.** Reads every cached response,
  re-encodes it, drops anything that fails to parse — useful after
  schema-changing upgrades.
- **SQLite-backed cache option.** For users who want to query their
  cache history (e.g., "every Charizard I've ever looked up"). Stays
  opt-in; the default JSON-files store remains.
- **TTL per source.** pokemontcg.io's data is stable; PriceCharting
  prices change daily. A coarse per-source TTL avoids stale prices.
- **Cache warming command.** `pkmn cache warm input/` pre-populates
  the cache from an input file, useful before going to a card show
  with spotty wifi.

### Web UI / API — V2

- **Persistent run history.** Server-side SQLite stores past runs;
  the SPA shows a sidebar with run timestamps, lets the user diff or
  re-export an old run.
- **Drag-and-drop file upload.** Drop a `.txt` onto the editor; it
  loads the contents inline.
- **Inline edit of unmatched rows.** Click a missed row, edit the
  line, re-run just that line via `/api/v1/lookup`.
- **Authentication for hosted instances.** API keys with rate limits
  per key, so a deployed instance can be shared without exposing
  someone's pokemontcg.io quota.
- **Mobile-responsive layout + accessibility audit.** Today's table
  doesn't reflow well below ~700 px. Plus axe-core pass for a11y.
- **OpenAPI client codegen.** Publish a TypeScript SDK
  (`@mgzwarrior/mgz-pkmn-client`) from the FastAPI schema so the SPA
  isn't the only browser-side consumer.

### DevOps & release — V2

- **PyPI publish on tag.** Auto-build sdist + wheel on `v*` tags;
  publish via Trusted Publisher.
- **Docker image to GHCR on tag.** Today the Docker build is local
  only; push to GitHub Container Registry on release.
- **Standalone PyInstaller binaries.** macOS / Linux / Windows
  artifacts attached to GitHub Releases for users who don't want a
  Python install.
- **Homebrew tap.** `brew install mgzwarrior/tap/mgz-pkmn`.
- **Conventional Commits + auto-generated release notes.** Use commits
  to drive the changelog, drop the manual maintenance.
- **Coverage reporting in CI.** Codecov badge in the README; hard
  threshold on PRs.
- **Performance benchmark in CI.** Track lookup latency over time so a
  regression is caught before users notice.

---

## How this list becomes issues

This document is a brainstorm, not a backlog. Before any of these get
filed on GitHub:

1. **Group V1 items into a milestone.** A single
   [`v1.0`](https://github.com/mgzwarrior/mgz-pkmn/milestones)
   milestone tracks completion.
2. **Group V2 items into Projects per area.** Five GitHub Projects
   (one per area above), each with its own backlog of V2 issues.
3. **Trim aggressively.** ~60 items is a long list; cut to whatever
   actually motivates you in the moment. Items left unfiled stay in
   this doc as a parking lot.

Open question for the maintainer: do you want `gh issue create`-style
batch creation of these, or would you rather hand-pick which to file
and write your own titles/bodies as you go? The
[contributing guide](contributing.md) is the right place to land
"how to file an issue" once that's settled.
