#!/usr/bin/env node
/**
 * refresh-pokedex.mjs — pull the national Pokédex (species number → name)
 * from PokéAPI and write it to `web/src/data/pokedex.json`, the static
 * species index Browse's pokedex-# view renders.
 *
 * Why this exists
 * ---------------
 * Browse's pokedex view (issue #577) organises printings by national dex
 * number — "show me every Charizard ever printed" — so the SPA needs the
 * full species list (#1 Bulbasaur … #1025 Pecharunt) to render the picker
 * with zero round-trips, exactly like the baked set catalog (`sets.json`).
 * Card printings are still fetched on demand per species; only the species
 * *index* is baked. The list is canonical reference data that only grows
 * when a new generation ships, so a manual bake-refresh-commit cadence is
 * plenty.
 *
 * Source
 * ------
 * PokéAPI's national Pokédex (`/api/v2/pokedex/1`) returns every species
 * with its `entry_number` (= national dex #) and a lowercase slug. We map
 * the slug to a display name with `displayName` below — a plain
 * title-case for the common case, plus a small override table for the
 * handful of names PokéAPI slugifies lossily (Farfetch'd, Mr. Mime,
 * Nidoran♀/♂, Type: Null, …).
 *
 * When to run
 * -----------
 * - **Manually**: `npm run refresh-pokedex` from `web/`. Run it when a new
 *   generation lands upstream; otherwise the baked file is stable.
 *
 * On error
 * --------
 * If PokéAPI is unreachable, the script logs a warning and exits **0** as
 * long as the existing `pokedex.json` is present — a transient upstream
 * outage must never fail the build. A missing file is a hard error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(__filename), '..')
const OUT_PATH = join(ROOT, 'src', 'data', 'pokedex.json')

const ENDPOINT = 'https://pokeapi.co/api/v2/pokedex/1'

// PokéAPI slugs strip punctuation and accents that the display name keeps.
// Only the lossy cases need an override; everything else round-trips fine
// through `titleCase`.
const NAME_OVERRIDES = {
  'nidoran-f': 'Nidoran♀',
  'nidoran-m': 'Nidoran♂',
  farfetchd: "Farfetch'd",
  'mr-mime': 'Mr. Mime',
  'mime-jr': 'Mime Jr.',
  'ho-oh': 'Ho-Oh',
  'porygon-z': 'Porygon-Z',
  'type-null': 'Type: Null',
  'jangmo-o': 'Jangmo-o',
  'hakamo-o': 'Hakamo-o',
  'kommo-o': 'Kommo-o',
  flabebe: 'Flabébé',
  sirfetchd: "Sirfetch'd",
  'mr-rime': 'Mr. Rime',
  // Treasures of Ruin (Gen IX) — official names keep the hyphen, which the
  // PokéAPI slug also carries; `titleCase` would otherwise space them out
  // and break a search for the hyphenated name.
  'wo-chien': 'Wo-Chien',
  'chien-pao': 'Chien-Pao',
  'ting-lu': 'Ting-Lu',
  'chi-yu': 'Chi-Yu',
}

function log(msg) {
  process.stdout.write(`[refresh-pokedex] ${msg}\n`)
}

function warn(msg) {
  process.stderr.write(`[refresh-pokedex] WARN ${msg}\n`)
}

function titleCase(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function displayName(slug) {
  return NAME_OVERRIDES[slug] ?? titleCase(slug)
}

async function fetchPokedex() {
  const headers = { 'User-Agent': 'mgz-pkmn/refresh-pokedex' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(ENDPOINT, { headers, signal: controller.signal })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    const body = await res.json()
    return Array.isArray(body?.pokemon_entries) ? body.pokemon_entries : []
  } finally {
    clearTimeout(timeout)
  }
}

function trim(entries) {
  // Match the SPA's `PokedexEntry` shape: a national dex number and a
  // display name. The fetch URL for a species' printings keys off the
  // number, so the name is purely cosmetic — formatting drift never
  // affects which cards load.
  return entries
    .map((e) => ({
      number: e.entry_number,
      name: displayName(e.pokemon_species?.name ?? ''),
    }))
    .sort((a, b) => a.number - b.number)
}

async function main() {
  let trimmed
  try {
    log(`fetching ${ENDPOINT}`)
    const entries = await fetchPokedex()
    if (entries.length === 0) {
      throw new Error('upstream returned 0 species')
    }
    trimmed = trim(entries)
    log(`fetched ${trimmed.length} species`)
  } catch (err) {
    warn(`fetch failed: ${err.message}`)
    if (existsSync(OUT_PATH)) {
      log(`keeping existing ${OUT_PATH}`)
      return
    }
    warn('no existing pokedex.json to fall back to — bailing out')
    process.exit(1)
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })

  const next = JSON.stringify(trimmed, null, 2) + '\n'
  if (existsSync(OUT_PATH)) {
    const current = readFileSync(OUT_PATH, 'utf-8')
    if (current === next) {
      log('no changes — pokedex.json is already up to date')
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
