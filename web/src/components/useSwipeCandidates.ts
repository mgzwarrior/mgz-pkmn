/**
 * useSwipeCandidates — feeds the next card to the Swipe surface.
 *
 * V1 heuristic per [#483](https://github.com/mgzwarrior/mgz-pkmn/issues/483):
 *
 *   1. Pull the full set catalog (BAKED_SETS + live `/api/v1/sets`
 *      revalidation). No recency bias — every set is in the pool.
 *   2. On each `pick()`, choose a random set the user hasn't already
 *      exhausted, fetch its trimmed card list on demand, then sample
 *      one unseen card with **rarity-weighted random selection**
 *      (heavily biased toward higher-rarity cards via `RARITY_WEIGHTS`).
 *      If the chosen set is fully seen, mark it exhausted and recurse.
 *   3. When every set is exhausted, surface the exhausted state.
 *
 * The taste profile (rarity / set / supertype counters) tracked by
 * `useSwipeProfile` is intentionally *not* fed back into selection
 * here — it's saved for the prep-list output. The user wanted simple
 * rarity-weighted random across the whole catalog, not a recency-
 * or profile-shaped walk.
 *
 * The hook returns `{ current, advance, loading, exhausted, error }`.
 * The consumer calls `advance()` after each swipe; profile updates
 * happen separately in `useSwipeProfile.act`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSetCards, fetchSets } from '../api/client'
import { BAKED_SETS } from '../data/sets'
import type { SetCard, SetInfo } from '../types'

interface Candidate {
  card: SetCard
  setId: string
  setName: string
}

interface State {
  /** Current candidate, or null while we're loading the next batch. */
  current: Candidate | null
  loading: boolean
  /** True only when every set in the catalog has been walked end-to-end. */
  exhausted: boolean
  error: string | null
}

interface UseSwipeCandidatesOpts {
  /** Whether the consumer is currently visible. Pauses fetching when false. */
  active: boolean
  /** Card IDs the user has already seen — filtered out of the pool. */
  seenSet: Set<string>
  /**
   * Optional `Math.random` replacement. Production passes nothing
   * (defaults to `Math.random`); tests inject a deterministic source.
   */
  rng?: () => number
}

/**
 * Per-rarity sampling weight. Higher = more likely to surface. The
 * spread between Common (1) and Special Illustration Rare (50) is
 * intentional — a typical set is overwhelmingly Common / Uncommon,
 * so a uniform sample would surface bulk first.
 *
 * Keys are matched case-insensitively against the trimmed card's
 * `rarity` field, which mirrors pokemontcg.io's strings. Unknown
 * rarities fall back to {@link DEFAULT_WEIGHT}.
 */
const RARITY_WEIGHTS: Record<string, number> = {
  common: 1,
  uncommon: 2,
  rare: 5,
  promo: 5,
  'rare holo': 8,
  'rare holo lv.x': 12,
  'rare holo ex': 12,
  'rare holo gx': 12,
  'rare holo v': 12,
  'rare holo vmax': 14,
  'rare holo vstar': 14,
  'double rare': 12,
  'rare break': 20,
  'radiant rare': 20,
  'rare ace': 25,
  'rare prime': 25,
  'rare prism star': 25,
  'rare shining': 30,
  'rare star': 25,
  'rare shiny': 25,
  'shiny rare': 25,
  'amazing rare': 25,
  'shiny ultra rare': 35,
  'ultra rare': 30,
  'rare ultra': 30,
  'illustration rare': 30,
  'special illustration rare': 50,
  'hyper rare': 40,
  'rare secret': 40,
  'rare rainbow': 40,
  'trainer gallery rare holo': 18,
  'ace spec rare': 25,
}

const DEFAULT_WEIGHT = 5

function rarityWeight(rarity: string | null): number {
  if (!rarity) return DEFAULT_WEIGHT
  return RARITY_WEIGHTS[rarity.toLowerCase()] ?? DEFAULT_WEIGHT
}

/**
 * Weighted-random sample. Returns the index of the chosen item;
 * higher-weight entries are proportionally more likely.
 */
function weightedSample(weights: number[], rng: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return Math.floor(rng() * weights.length)
  let r = rng() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

export function useSwipeCandidates(opts: UseSwipeCandidatesOpts) {
  const { active, seenSet, rng = Math.random } = opts

  const [state, setState] = useState<State>({
    current: null,
    loading: false,
    exhausted: false,
    error: null,
  })

  // Full set catalog — seeded from the baked snapshot and revalidated
  // against `/api/v1/sets`. Not sorted; every set is equally likely
  // to be sampled on each pick.
  const [allSets, setAllSets] = useState<SetInfo[]>(() => [...BAKED_SETS])
  const cardsBySetRef = useRef<Record<string, SetCard[]>>({})
  // Sets the user has fully seen — skipped on subsequent picks so
  // we don't fetch them again.
  const exhaustedSetsRef = useRef<Set<string>>(new Set())

  // Revalidate the baked catalog against the live `/api/v1/sets`
  // endpoint — silently fall back to the baked snapshot on failure.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    void (async () => {
      try {
        const live = await fetchSets()
        if (cancelled) return
        if (live.length > 0) setAllSets(live)
      } catch {
        /* baked catalog is enough — silent fallback */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  // Pick the next candidate by sampling a random set, fetching its
  // card list if not yet cached, then rarity-weighted-sampling the
  // unseen card pool.
  const pick = useCallback(async () => {
    if (allSets.length === 0) return

    setState((s) => ({ ...s, loading: true, error: null }))

    // Recurse up to N times to skip exhausted sets / loop on fetch
    // errors without blowing the stack. N is bounded by the catalog
    // size + a small slack — the exhausted-set ref means we never
    // re-roll the same set in a single pick.
    for (let attempt = 0; attempt < allSets.length + 4; attempt++) {
      const available = allSets.filter(
        (s) => !exhaustedSetsRef.current.has(s.id),
      )
      if (available.length === 0) {
        setState({
          current: null,
          loading: false,
          exhausted: true,
          error: null,
        })
        return
      }

      const set = available[Math.floor(rng() * available.length)]
      let cards = cardsBySetRef.current[set.id]

      if (!cards) {
        try {
          cards = await fetchSetCards(set.id)
          cardsBySetRef.current[set.id] = cards
        } catch (e) {
          setState({
            current: null,
            loading: false,
            exhausted: false,
            error: e instanceof Error ? e.message : String(e),
          })
          return
        }
      }

      const unseen = cards.filter((c) => !seenSet.has(c.id))
      if (unseen.length === 0) {
        exhaustedSetsRef.current.add(set.id)
        continue
      }

      const weights = unseen.map((c) => rarityWeight(c.rarity))
      const idx = weightedSample(weights, rng)
      const chosen = unseen[idx]
      setState({
        current: { card: chosen, setId: set.id, setName: set.name },
        loading: false,
        exhausted: false,
        error: null,
      })
      return
    }

    // Defensive fallback — shouldn't happen unless the catalog is
    // wedged in a tight loop of always-empty sets.
    setState({
      current: null,
      loading: false,
      exhausted: true,
      error: null,
    })
  }, [allSets, seenSet, rng])

  // Whenever the set list changes (initial load + revalidation) or
  // the seen set updates (consumer swiped), advance to a fresh
  // candidate. See `useBrowseController` for the same eslint-disable
  // pattern — the cascading-render risk is mitigated by the
  // early-return guards inside `pick`.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!active) return
    if (allSets.length === 0) return
    void pick()
  }, [active, allSets, pick])
  /* eslint-enable react-hooks/set-state-in-effect */

  const advance = useCallback(() => {
    void pick()
  }, [pick])

  return {
    current: state.current,
    loading: state.loading,
    exhausted: state.exhausted,
    error: state.error,
    advance,
  }
}

// Test-only: surface the rarity table + weighted sampler so unit
// tests can pin the heuristic without going through the React tree.
export { RARITY_WEIGHTS, DEFAULT_WEIGHT, rarityWeight, weightedSample }
