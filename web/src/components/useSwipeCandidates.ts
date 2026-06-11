/**
 * useSwipeCandidates — feeds the Swipe surface a small prefetched *stack*
 * of cards.
 *
 * V1 heuristic per [#483](https://github.com/mgzwarrior/mgz-pkmn/issues/483):
 *
 *   1. Pull the full set catalog (BAKED_SETS + live `/api/v1/sets`
 *      revalidation). No recency bias — every set is in the pool.
 *   2. On each `sampleOne()`, choose a random set the user hasn't already
 *      exhausted, fetch its trimmed card list on demand, then sample
 *      one un-dealt card with **rarity-weighted random selection**
 *      (heavily biased toward higher-rarity cards via `RARITY_WEIGHTS`).
 *      If the chosen set is fully dealt, mark it exhausted and recurse.
 *   3. When every set is exhausted, surface the exhausted state.
 *
 * Rather than tracking a single `current` card, the hook keeps a queue of
 * up to {@link STACK_SIZE} candidates so the consumer can render the next
 * few cards as a real stack and reveal — not refetch — the next card when
 * the top one is swiped away ([#624](https://github.com/mgzwarrior/mgz-pkmn/issues/624)).
 * `advance()` drops the top card and tops the queue back up in the
 * background; because the next card is already fetched there's no loader
 * flash between swipes.
 *
 * The taste profile (rarity / set / supertype counters) tracked by
 * `useSwipeProfile` is intentionally *not* fed back into selection
 * here — it's saved for the prep-list output. The user wanted simple
 * rarity-weighted random across the whole catalog, not a recency-
 * or profile-shaped walk.
 *
 * The hook returns `{ current, upcoming, advance, loading, exhausted,
 * error }`. The consumer calls `advance()` after each swipe; profile
 * updates happen separately in `useSwipeProfile.act`.
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

/** Top card + the cards peeking beneath it. */
const STACK_SIZE = 3

interface State {
  /** Prefetched stack; `queue[0]` is the current (top) card. */
  queue: Candidate[]
  loading: boolean
  /** True only when every set in the catalog has been walked end-to-end. */
  exhausted: boolean
  error: string | null
}

/** Result of a single sampling attempt. */
type SampleResult =
  | { kind: 'card'; card: Candidate }
  | { kind: 'exhausted' }
  | { kind: 'error'; message: string }

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
  // Keep the rng behind a ref so an inline `rng` prop (a fresh function each
  // render) doesn't churn the `sampleOne`/`fill` callback identities and
  // re-fire the top-up effect on every render. Refreshed in an effect rather
  // than during render so we never write a ref mid-render.
  const rngRef = useRef(rng)
  useEffect(() => {
    rngRef.current = rng
  })

  const [state, setState] = useState<State>({
    queue: [],
    loading: false,
    exhausted: false,
    error: null,
  })

  // Full set catalog — seeded from the baked snapshot and revalidated
  // against `/api/v1/sets`. Not sorted; every set is equally likely
  // to be sampled on each pick.
  const [allSets, setAllSets] = useState<SetInfo[]>(() => [...BAKED_SETS])
  const cardsBySetRef = useRef<Record<string, SetCard[]>>({})
  // Sets the user has fully walked — skipped on subsequent picks so
  // we don't fetch them again.
  const exhaustedSetsRef = useRef<Set<string>>(new Set())
  // Authoritative copy of the queue so the async fill loop and `advance`
  // read fresh values across `await`s without waiting for a re-render.
  const queueRef = useRef<Candidate[]>([])
  // Every card id ever placed in the stack this session. Excluded from
  // sampling so a just-swiped card can never resurface deeper in the
  // queue, even before the profile's `seen` set has caught up. Cleared
  // on profile reset (see below) so cards come back.
  const dealtRef = useRef<Set<string>>(new Set())
  // Guards against two `fill()` runs fetching into the queue at once.
  const fillingRef = useRef(false)
  // Tracks the seen-set size so we can detect a profile reset (shrink).
  const prevSeenSizeRef = useRef(seenSet.size)

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

  // Sample one candidate, excluding any card id in `exclude` (already
  // seen or already in the stack). Samples a random set, fetching its
  // card list if not yet cached, then rarity-weighted-samples the pool
  // of remaining cards. Recurses (bounded) past exhausted sets / fetch
  // errors without blowing the stack.
  const sampleOne = useCallback(
    async (exclude: Set<string>): Promise<SampleResult> => {
      if (allSets.length === 0) return { kind: 'exhausted' }

      for (let attempt = 0; attempt < allSets.length + 4; attempt++) {
        const available = allSets.filter(
          (s) => !exhaustedSetsRef.current.has(s.id),
        )
        if (available.length === 0) return { kind: 'exhausted' }

        const set = available[Math.floor(rngRef.current() * available.length)]
        let cards = cardsBySetRef.current[set.id]

        if (!cards) {
          try {
            cards = await fetchSetCards(set.id)
            cardsBySetRef.current[set.id] = cards
          } catch (e) {
            return {
              kind: 'error',
              message: e instanceof Error ? e.message : String(e),
            }
          }
        }

        const remaining = cards.filter((c) => !exclude.has(c.id))
        if (remaining.length === 0) {
          // Every card in this set is seen-or-dealt — retire it. A reset
          // clears both `exhaustedSetsRef` and `dealtRef` together, so
          // this stays consistent.
          exhaustedSetsRef.current.add(set.id)
          continue
        }

        const weights = remaining.map((c) => rarityWeight(c.rarity))
        const idx = weightedSample(weights, rngRef.current)
        return {
          kind: 'card',
          card: { card: remaining[idx], setId: set.id, setName: set.name },
        }
      }

      // Defensive fallback — shouldn't happen unless the catalog is
      // wedged in a tight loop of always-empty sets.
      return { kind: 'exhausted' }
    },
    [allSets],
  )

  // Top the queue back up to STACK_SIZE, fetching the next candidates in
  // the background. Only flips `loading` when the queue is empty so
  // refilling the tail never flashes the loader between swipes.
  const fill = useCallback(async () => {
    if (fillingRef.current || allSets.length === 0) return
    fillingRef.current = true
    try {
      while (queueRef.current.length < STACK_SIZE) {
        if (queueRef.current.length === 0) {
          setState((s) => ({ ...s, loading: true, error: null }))
        }
        const exclude = new Set(seenSet)
        for (const id of dealtRef.current) exclude.add(id)

        const res = await sampleOne(exclude)

        if (res.kind === 'error') {
          setState({
            queue: queueRef.current,
            loading: false,
            exhausted: false,
            error: res.message,
          })
          return
        }
        if (res.kind === 'exhausted') {
          // Stop topping up. Only the *whole* catalog being walked
          // surfaces the exhausted state — a short tail (e.g. the last
          // few cards excluded by the in-flight stack) just leaves a
          // smaller stack that self-heals as the user swipes.
          setState({
            queue: queueRef.current,
            loading: false,
            exhausted: queueRef.current.length === 0,
            error: null,
          })
          return
        }

        dealtRef.current.add(res.card.card.id)
        queueRef.current = [...queueRef.current, res.card]
        setState({
          queue: queueRef.current,
          loading: false,
          exhausted: false,
          error: null,
        })
      }
    } finally {
      fillingRef.current = false
    }
  }, [allSets, seenSet, sampleOne])

  // Initial load + top-up: whenever the catalog changes or the queue has
  // drained to empty, fetch a fresh stack. `fill`'s own guards make the
  // non-empty / in-flight cases cheap no-ops.
  useEffect(() => {
    if (!active) return
    if (allSets.length === 0) return
    if (queueRef.current.length > 0) return
    void fill()
  }, [active, allSets, fill])

  // Detect a profile reset (the seen set shrinking) and start the walk
  // over: clear the dealt/exhausted bookkeeping and the stack so the
  // top-up effect above re-fills from scratch.
  useEffect(() => {
    if (seenSet.size < prevSeenSizeRef.current) {
      dealtRef.current = new Set()
      exhaustedSetsRef.current = new Set()
      queueRef.current = []
      setState({ queue: [], loading: true, exhausted: false, error: null })
    }
    prevSeenSizeRef.current = seenSet.size
  }, [seenSet])

  const advance = useCallback(() => {
    queueRef.current = queueRef.current.slice(1)
    setState((s) => ({ ...s, queue: queueRef.current }))
    void fill()
  }, [fill])

  return {
    current: state.queue[0] ?? null,
    upcoming: state.queue.slice(1),
    loading: state.loading,
    exhausted: state.exhausted,
    error: state.error,
    advance,
  }
}

// Test-only: surface the rarity table + weighted sampler so unit
// tests can pin the heuristic without going through the React tree.
export { RARITY_WEIGHTS, DEFAULT_WEIGHT, rarityWeight, weightedSample, STACK_SIZE }
