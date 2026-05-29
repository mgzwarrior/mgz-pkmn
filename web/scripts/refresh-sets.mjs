#!/usr/bin/env node
/**
 * refresh-sets.mjs — pull the Pokémon TCG set catalog from pokemontcg.io
 * and write it to `web/src/data/sets.json`, the static fallback the SPA
 * imports as Browse's initial state.
 *
 * Why this exists
 * ---------------
 * The SPA used to wait on a live `GET /api/v1/sets` round-trip the first
 * time anyone opened Browse, which meant a visible "Loading set catalog…"
 * spinner — exactly the kind of friction the rest of the perf story
 * (Cache-Control, disk cache, in-memory cache) is meant to eliminate.
 * Baking the catalog into the SPA bundle takes that first-paint cost
 * to zero. The live fetch still runs in the background to write
 * through any new sets (covered by stale-while-revalidate on /sets so
 * it doesn't block UI).
 *
 * When to run
 * -----------
 * - **Manually**: `npm run refresh-sets` from `web/`. New Pokémon sets
 *   release every few months; running this before a release is enough
 *   to keep the bundled catalog fresh.
 * - **CI**: a periodic job can run this and open a PR if the diff is
 *   non-empty. (Not wired in this PR — start manual, automate later.)
 *
 * On error
 * --------
 * If pokemontcg.io is unreachable, the script logs a warning and exits
 * **0** as long as the existing `sets.json` is present. The build must
 * never fail because of a transient upstream outage. A missing file is
 * a hard error (exit 1) — that's a developer setup problem, not a
 * runtime one.
 *
 * Environment
 * -----------
 * - `POKEMONTCG_IO_API_KEY` (optional) — sent as `X-Api-Key` so a
 *   generous pokemontcg.io account avoids the public rate limit.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(__filename), '..')
const OUT_PATH = join(ROOT, 'src', 'data', 'sets.json')

const ENDPOINT =
  'https://api.pokemontcg.io/v2/sets?orderBy=releaseDate&pageSize=250'

function log(msg) {
  process.stdout.write(`[refresh-sets] ${msg}\n`)
}

function warn(msg) {
  process.stderr.write(`[refresh-sets] WARN ${msg}\n`)
}

async function fetchCatalog() {
  const headers = { 'User-Agent': 'mgz-pkmn/refresh-sets' }
  const apiKey = process.env.POKEMONTCG_IO_API_KEY
  if (apiKey) headers['X-Api-Key'] = apiKey

  // Per-attempt timeout. pokemontcg.io is occasionally slow on big
  // queries; 30s is generous and still safely under a typical CI step
  // limit. AbortController is the standard Node 20+ way to cancel
  // fetch — no extra dependency.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(ENDPOINT, { headers, signal: controller.signal })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    const body = await res.json()
    return Array.isArray(body?.data) ? body.data : []
  } finally {
    clearTimeout(timeout)
  }
}

function trim(raw) {
  // Match the field set `GET /api/v1/sets` returns — the SPA's `SetInfo`
  // type expects exactly these keys. Keeping the trim aligned with
  // `api/routes/sets.py:_fetch_sets` means the static bundle and the
  // live fetch are wire-compatible; the SPA never has to branch on
  // which source produced it.
  return raw.map((s) => ({
    id: s.id,
    name: s.name,
    series: s.series,
    total: s.total,
    releaseDate: s.releaseDate,
  }))
}

async function main() {
  let trimmed
  try {
    log(`fetching ${ENDPOINT}`)
    const raw = await fetchCatalog()
    if (raw.length === 0) {
      throw new Error('upstream returned 0 sets')
    }
    trimmed = trim(raw)
    log(`fetched ${trimmed.length} sets`)
  } catch (err) {
    warn(`fetch failed: ${err.message}`)
    if (existsSync(OUT_PATH)) {
      // Existing baked catalog is acceptable; the SPA will still
      // background-refresh from /api/v1/sets at runtime, so a single
      // failed refresh is harmless. Exit 0 so the build doesn't fail
      // on a transient upstream outage.
      log(`keeping existing ${OUT_PATH}`)
      return
    }
    warn('no existing sets.json to fall back to — bailing out')
    process.exit(1)
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })

  // Skip the write if the content hasn't changed — keeps git diffs
  // clean and avoids triggering unnecessary rebuilds when the script
  // is run on a schedule.
  const next = JSON.stringify(trimmed, null, 2) + '\n'
  if (existsSync(OUT_PATH)) {
    const current = readFileSync(OUT_PATH, 'utf-8')
    if (current === next) {
      log('no changes — sets.json is already up to date')
      return
    }
  }

  writeFileSync(OUT_PATH, next, 'utf-8')
  log(`wrote ${OUT_PATH}`)
}

main().catch((err) => {
  warn(`unexpected error: ${err.stack || err.message}`)
  process.exit(1)
})
