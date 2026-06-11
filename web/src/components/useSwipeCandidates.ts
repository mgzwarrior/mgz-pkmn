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
import type { RarityFloor, SetCard, SetInfo } from '../types'
import { exclusionKey } from './useSwipeExclusions'

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
   * Library-aware exclusion keys (#581), keyed by `${set_id}::${number}`
   * (see {@link exclusionKey}). The persisted no-repeat set plus the
   * opt-in owned / chasing cards. Unlike `seenSet` (card-id keyed, the
   * SPA's session-local memory), these come from the server and survive
   * across sessions. Excluded identities are dropped from new samples and
   * pruned from the prefetched stack. Defaults to empty.
   */
  excludedKeys?: Set<string>
  /**
   * Rarity floor — trims the candidate pool toward chase cards. Defaults
   * to `chase` (each set's top tier). See {@link isEligible}.
   */
  rarityFloor?: RarityFloor
  /**
   * Optional `Math.random` replacement. Production passes nothing
   * (defaults to `Math.random`); tests inject a deterministic source.
   */
  rng?: () => number
}

/**
 * Per-rarity sampling weight. Higher = more likely to surface. Swipe mode
 * is a chase-card reel, not an inventory walk (#580): Ultra-tier and above
 * carry weights ~100+ while Commons are fractional, so even when bulk is in
 * the pool a draw lands on a chase card the overwhelming majority of the
 * time.
 *
 * Keys are matched case-insensitively against the trimmed card's
 * `rarity` field, which mirrors pokemontcg.io's strings. Unknown
 * rarities fall back to {@link DEFAULT_WEIGHT}.
 */
const RARITY_WEIGHTS: Record<string, number> = {
  common: 0.25,
  uncommon: 0.5,
  rare: 4,
  promo: 4,
  'rare holo': 10,
  'trainer gallery rare holo': 12,
  'rare holo lv.x': 30,
  'rare holo ex': 30,
  'rare holo gx': 30,
  'rare holo v': 30,
  'rare holo vmax': 40,
  'rare holo vstar': 40,
  'double rare': 35,
  'rare break': 45,
  'radiant rare': 45,
  'amazing rare': 45,
  'rare ace': 45,
  'ace spec rare': 45,
  'rare prime': 45,
  'rare prism star': 45,
  'rare star': 45,
  'rare shining': 45,
  'rare shiny': 45,
  'shiny rare': 45,
  'ultra rare': 110,
  'rare ultra': 110,
  'illustration rare': 110,
  'shiny ultra rare': 130,
  'hyper rare': 150,
  'rare secret': 150,
  'rare rainbow': 150,
  'special illustration rare': 160,
}

/** Unknown rarity ≈ a low rare — keep it in the running without dominating. */
const DEFAULT_WEIGHT = 8

function rarityWeight(rarity: string | null): number {
  if (!rarity) return DEFAULT_WEIGHT
  return RARITY_WEIGHTS[rarity.toLowerCase()] ?? DEFAULT_WEIGHT
}

/** Tier 3 — rarer than a base rare: the ex/gx/v family, double rare, ultra
 *  rare, and the assorted special-set rarities. */
const ULTRA_TIER = new Set([
  'rare holo lv.x',
  'rare holo ex',
  'rare holo gx',
  'rare holo v',
  'rare holo vmax',
  'rare holo vstar',
  'double rare',
  'rare break',
  'radiant rare',
  'amazing rare',
  'rare ace',
  'ace spec rare',
  'rare prime',
  'rare prism star',
  'rare star',
  'rare shining',
  'rare shiny',
  'shiny rare',
  'ultra rare',
  'rare ultra',
])

/** Tier 4 — the chase ceiling: illustration / secret rarities. */
const SECRET_TIER = new Set([
  'illustration rare',
  'special illustration rare',
  'hyper rare',
  'rare secret',
  'rare rainbow',
  'shiny ultra rare',
])

/**
 * Absolute rarity tier — collapses the many rarity strings into ordered
 * bands so the floor can compare across them: `0` common · `1` uncommon ·
 * `2` rare (incl. base holos / trainer gallery) · `3` ultra ({@link
 * ULTRA_TIER}) · `4` secret / illustration ({@link SECRET_TIER}). Null /
 * unrecognised rarities fall back to `2`, matching {@link DEFAULT_WEIGHT}'s
 * "treat as a low rare" stance.
 */
function rarityTier(rarity: string | null): number {
  if (!rarity) return 2
  const r = rarity.toLowerCase()
  if (r === 'common') return 0
  if (r === 'uncommon') return 1
  if (SECRET_TIER.has(r)) return 4
  if (ULTRA_TIER.has(r)) return 3
  // Base rares + trainer gallery + anything unrecognised → low rare.
  return 2
}

/** The highest rarity tier present in a set — its "chase" tier. */
function chaseTierForSet(cards: SetCard[]): number {
  let max = 0
  for (const c of cards) {
    const t = rarityTier(c.rarity)
    if (t > max) max = t
  }
  return max
}

/**
 * Whether a card clears the rarity floor. `all` keeps everything, `rare`
 * drops Common + Uncommon (absolute tier ≥ 2), and `chase` keeps only the
 * set's top tier — passed in as `setMaxTier` so the band scales with each
 * set's era (Base Set → Rare Holo, modern → Special Illustration Rare).
 */
function isEligible(
  rarity: string | null,
  floor: RarityFloor,
  setMaxTier: number,
): boolean {
  if (floor === 'all') return true
  if (floor === 'rare') return rarityTier(rarity) >= 2
  return rarityTier(rarity) >= setMaxTier
}

/** In-place-free Fisher–Yates shuffle driven by the injected rng. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
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

const EMPTY_KEYS: Set<string> = new Set()

export function useSwipeCandidates(opts: UseSwipeCandidatesOpts) {
  const {
    active,
    seenSet,
    excludedKeys = EMPTY_KEYS,
    rarityFloor = 'chase',
    rng = Math.random,
  } = opts
  // Read the live exclusion set at sample time (like `rngRef`) so an
  // incremental `recordSeen` is honored on the next pick without churning
  // the `sampleOne` / `fill` callback identities. Refreshed in an effect so
  // we never write the ref mid-render.
  const excludedKeysRef = useRef(excludedKeys)
  useEffect(() => {
    excludedKeysRef.current = excludedKeys
  })
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
  // Tracks the active floor so we can rebuild the stack when it changes.
  const prevFloorRef = useRef(rarityFloor)

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

  // Sample one candidate, excluding any card id in `exclude` (already seen
  // or already in the stack) and any card below `floor`. Walks the
  // un-retired sets in a random order, fetching each on demand, and returns
  // the first floor-eligible card it finds. Iterating each set at most once
  // (rather than random-with-replacement) avoids coupon-collector
  // false-exhaustion when chase-tier cards are sparse at the tail.
  const sampleOne = useCallback(
    async (exclude: Set<string>, floor: RarityFloor): Promise<SampleResult> => {
      if (allSets.length === 0) return { kind: 'exhausted' }

      const available = shuffled(
        allSets.filter((s) => !exhaustedSetsRef.current.has(s.id)),
        rngRef.current,
      )

      for (const set of available) {
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
          // Every card in this set is seen-or-dealt — retire it (floor-
          // independent, so a floor change never permanently strands a
          // set). A reset clears both `exhaustedSetsRef` and `dealtRef`.
          exhaustedSetsRef.current.add(set.id)
          continue
        }

        const setMaxTier = chaseTierForSet(cards)
        const excluded = excludedKeysRef.current
        const eligible = remaining.filter(
          (c) =>
            isEligible(c.rarity, floor, setMaxTier) &&
            !excluded.has(exclusionKey(set.id, c.number)),
        )
        // Eligible pool empty but cards remain → the floor or the library
        // filter dropped this set out for now. Skip it without retiring
        // (retirement keys off `seen`/`dealt` only, so toggling a library
        // exclusion off — or a lower floor — brings the set back).
        if (eligible.length === 0) continue

        const weights = eligible.map((c) => rarityWeight(c.rarity))
        const idx = weightedSample(weights, rngRef.current)
        return {
          kind: 'card',
          card: { card: eligible[idx], setId: set.id, setName: set.name },
        }
      }

      // No floor-eligible card anywhere in the catalog.
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

        const res = await sampleOne(exclude, rarityFloor)

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
  }, [allSets, seenSet, rarityFloor, sampleOne])

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

  // Floor change → drop the prefetched stack (built under the old floor)
  // so the top-up effect refills under the new one. Keep `dealtRef` /
  // `exhaustedSetsRef` intact: already-shown cards still shouldn't repeat,
  // and retired sets were walked floor-independently.
  useEffect(() => {
    if (rarityFloor !== prevFloorRef.current) {
      prevFloorRef.current = rarityFloor
      queueRef.current = []
      setState({ queue: [], loading: true, exhausted: false, error: null })
    }
  }, [rarityFloor])

  // Exclusion set changed (a library toggle flipped, or the persisted seen
  // set loaded in) → prune any prefetched card that's now excluded and top
  // the stack back up. Gentler than a full rebuild: no loader flash, and an
  // incremental `recordSeen` (the common case) prunes nothing because the
  // just-seen card has already advanced off the queue.
  useEffect(() => {
    const pruned = queueRef.current.filter(
      (c) => !excludedKeys.has(exclusionKey(c.setId, c.card.number)),
    )
    if (pruned.length !== queueRef.current.length) {
      queueRef.current = pruned
      setState((s) => ({ ...s, queue: pruned }))
      void fill()
    }
  }, [excludedKeys, fill])

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

// Test-only: surface the rarity table + weighted sampler + tier/floor
// helpers so unit tests can pin the heuristics without going through the
// React tree.
export {
  RARITY_WEIGHTS,
  DEFAULT_WEIGHT,
  rarityWeight,
  weightedSample,
  rarityTier,
  chaseTierForSet,
  isEligible,
  STACK_SIZE,
}
