/**
 * Baked-in Pokémon TCG set catalog — the SPA's zero-round-trip initial
 * state for any UI that picks a set (Browse, the export picker).
 *
 * The JSON file is refreshed by `npm run refresh-sets`, which fetches
 * `https://api.pokemontcg.io/v2/sets` and writes the same trimmed
 * shape `GET /api/v1/sets` serves. New Pokémon sets ship every few
 * months; bake-refresh-commit is a manual cadence (a future scheduled
 * job could automate it).
 *
 * The live fetch still runs in the background on first open so any
 * sets that landed upstream since the last bake show up the same
 * session — no need to wait for a deploy. See `useBrowseController`
 * and `SetPickerModal` for the revalidation flow.
 */
import type { SetInfo } from '../types'
import bakedSets from './sets.json'

// `as const` would over-narrow the literal types; the simple cast keeps
// the runtime shape but lets the SPA treat the catalog as the same
// `SetInfo[]` the API endpoint produces.
export const BAKED_SETS = bakedSets as SetInfo[]
