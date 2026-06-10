/**
 * Baked-in national Pokédex (species number → display name) — the SPA's
 * zero-round-trip species index for Browse's pokedex-# view, where the
 * organisation flips from "cards in a set" to "every printing of one
 * Pokémon across every set" (issue #577).
 *
 * The JSON file is refreshed by `npm run refresh-pokedex`, which pulls the
 * national dex from PokéAPI. Unlike the set catalog there's no live
 * background revalidation: the species list is canonical reference data
 * that only grows when a new generation ships, so the baked file is the
 * single source of truth. Card printings for a chosen species are still
 * fetched on demand from `GET /api/v1/pokedex/{number}/cards`.
 */
import type { PokedexEntry } from '../types'
import bakedPokedex from './pokedex.json'

export const BAKED_POKEDEX = bakedPokedex as PokedexEntry[]

/** National dex generation boundaries (inclusive). Used to group the
 *  species index into the same kind of labelled sections Browse's set
 *  view gets from `series`. */
export const POKEDEX_GENERATIONS: { label: string; start: number; end: number }[] = [
  { label: 'Generation I', start: 1, end: 151 },
  { label: 'Generation II', start: 152, end: 251 },
  { label: 'Generation III', start: 252, end: 386 },
  { label: 'Generation IV', start: 387, end: 493 },
  { label: 'Generation V', start: 494, end: 649 },
  { label: 'Generation VI', start: 650, end: 721 },
  { label: 'Generation VII', start: 722, end: 809 },
  { label: 'Generation VIII', start: 810, end: 905 },
  { label: 'Generation IX', start: 906, end: 1025 },
]
