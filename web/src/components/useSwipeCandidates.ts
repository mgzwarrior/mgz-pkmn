/**
 * useSwipeCandidates — feeds the next card to the Swipe surface.
 *
 * V1 heuristic per [#483](https://github.com/mgzwarrior/mgz-pkmn/issues/483):
 *
 *   1. Pull the set catalog (shared with Browse via `BAKED_SETS` + the
 *      `/api/v1/sets` revalidation flow).
 *   2. Walk sets newest-first; for each, fetch its trimmed card list.
 *   3. From the unseen pool, pick the card with the highest profile
 *      score (ties broken by market price descending so a balanced
 *      profile still shows the headliners first). Once the user has
 *      no profile signal yet, the top of the pool is effectively a
 *      shuffled walk through the most recent sets.
 *   4. When a set is exhausted, advance to the next set.
 *
 * The hook returns `{ current, advance, loading, exhausted }`. The
 * consumer calls `advance()` after each swipe; the profile updates
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
  /** True only when every fetched set has been walked end-to-end. */
  exhausted: boolean
  error: string | null
}

interface UseSwipeCandidatesOpts {
  /** Whether the consumer is currently visible. Pauses fetching when false. */
  active: boolean
  /** Card IDs the user has already seen — filtered out of the pool. */
  seenSet: Set<string>
  /** Higher = better match. Used to rank the pool head. */
  scoreCard: (card: SetCard, setId: string) => number
}

// Sets are walked newest-first. Limit V1 to the recent few to keep
// rotation tight; the heuristic improves as the profile builds up.
const MAX_SETS_TO_WALK = 6

function sortSetsNewestFirst(sets: SetInfo[]): SetInfo[] {
  return [...sets].sort((a, b) => {
    const ay = a.releaseDate || ''
    const by = b.releaseDate || ''
    if (ay === by) return a.name.localeCompare(b.name)
    return by.localeCompare(ay)
  })
}

export function useSwipeCandidates(opts: UseSwipeCandidatesOpts) {
  const { active, seenSet, scoreCard } = opts

  const [state, setState] = useState<State>({
    current: null,
    loading: false,
    exhausted: false,
    error: null,
  })

  // Sets to walk + per-set card caches. `cardsBySet` keyed by set id.
  const [orderedSets, setOrderedSets] = useState<SetInfo[]>(() =>
    sortSetsNewestFirst(BAKED_SETS).slice(0, MAX_SETS_TO_WALK),
  )
  const cardsBySetRef = useRef<Record<string, SetCard[]>>({})
  const setCursorRef = useRef(0)

  // Revalidate the baked catalog against the live `/api/v1/sets` endpoint
  // — silently fall back to the baked snapshot on failure.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    void (async () => {
      try {
        const live = await fetchSets()
        if (cancelled) return
        const fresh = sortSetsNewestFirst(live).slice(0, MAX_SETS_TO_WALK)
        if (fresh.length > 0) setOrderedSets(fresh)
      } catch {
        /* baked catalog is enough — silent fallback */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  // Pick the next candidate from the current set, fetching cards on
  // demand. Encapsulated as a callback so `advance()` can re-run it.
  const pick = useCallback(async () => {
    if (orderedSets.length === 0) return

    setState((s) => ({ ...s, loading: true, error: null }))

    while (setCursorRef.current < orderedSets.length) {
      const set = orderedSets[setCursorRef.current]
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
      if (unseen.length > 0) {
        // Rank by profile score; tie-break on market desc so headliners
        // surface first in a cold-start profile.
        const ranked = [...unseen].sort((a, b) => {
          const sa = scoreCard(a, set.id)
          const sb = scoreCard(b, set.id)
          if (sa !== sb) return sb - sa
          return (b.market ?? 0) - (a.market ?? 0)
        })
        setState({
          current: { card: ranked[0], setId: set.id, setName: set.name },
          loading: false,
          exhausted: false,
          error: null,
        })
        return
      }

      // This set is fully seen — advance.
      setCursorRef.current += 1
    }

    setState({
      current: null,
      loading: false,
      exhausted: true,
      error: null,
    })
  }, [orderedSets, seenSet, scoreCard])

  // Whenever the set list changes (initial load + revalidation) or the
  // seen set updates (consumer swiped), advance to a fresh candidate.
  // `pick` itself fetches + setStates, which the lint rule flags as a
  // cascading-render risk — guarded by an early-return + the deps so it
  // only runs when one of the real inputs changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!active) return
    if (orderedSets.length === 0) return
    void pick()
  }, [active, orderedSets, pick])
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
