/**
 * useSwipeExclusions — server-backed "don't show me this card" memory for
 * the swipe deck (#581).
 *
 * Two layers, both keyed on the promoted `(set_id, number)` identity:
 *
 *   1. **No-repeat memory** (always on) — every shown card is recorded via
 *      `recordSeen` and persisted server-side, so a card never resurfaces
 *      across sessions until the user resets the deck.
 *   2. **Library-aware exclusion** (opt-in) — when `excludeOwned` /
 *      `excludeChasing` are set, the server folds the user's collection /
 *      wishlist cards into the same exclusion set.
 *
 * The hook hands back a `Set<string>` of exclusion keys (see {@link
 * exclusionKey}) that {@link useSwipeCandidates} drops from the pool: new
 * samples skip excluded identities, and any already-prefetched card that
 * becomes excluded (a toggle flip, the persisted set loading in) is pruned
 * from the stack and topped back up — no loader flash.
 *
 * Persistence degrades gracefully: when the endpoints are unreachable
 * (e.g. auth is on and the visitor is anonymous → 401), every call
 * silently no-ops and the deck falls back to the SPA's session-local
 * no-repeat set. The swipe surface keeps working; it just doesn't
 * remember across sessions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchSwipeExcluded,
  recordSwipeSeen,
  resetSwipeSeen,
} from '../api/client'

/**
 * Stable exclusion key for a `(set_id, number)` pair. Colon-joined rather
 * than reusing the `${set}-${number}` card-id form, since a hyphen appears
 * in both set ids and collector numbers but a colon appears in neither.
 */
export function exclusionKey(setId: string, number: string): string {
  return `${setId}::${number}`
}

interface UseSwipeExclusionsOpts {
  /** Fold the user's owned (collection) cards into the exclusion set. */
  excludeOwned: boolean
  /** Fold the user's chased (wishlist) cards into the exclusion set. */
  excludeChasing: boolean
}

interface UseSwipeExclusionsResult {
  /** Keys to drop from the candidate pool — see {@link exclusionKey}. */
  excludedKeys: Set<string>
  /** Persist one shown card (idempotent). Optimistically excludes it too. */
  recordSeen: (setId: string, number: string, dir?: string) => void
  /** Clear the deck — wipe seen memory and surface the full pool again. */
  resetDeck: () => void
}

export function useSwipeExclusions({
  excludeOwned,
  excludeChasing,
}: UseSwipeExclusionsOpts): UseSwipeExclusionsResult {
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(() => new Set())
  // Mirror the latest keys so the optimistic `recordSeen` path can extend
  // the set without depending on the render-time `excludedKeys` closure.
  // Synced in an effect (never written mid-render); the mutating callbacks
  // below also update it directly so rapid same-tick swipes compound.
  const keysRef = useRef(excludedKeys)
  useEffect(() => {
    keysRef.current = excludedKeys
  })

  // Load (and reload on toggle change) the server exclusion set. Failures
  // resolve to an empty set so an anonymous / offline visitor still gets a
  // working deck (session-local no-repeat only).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let keys: Set<string>
      try {
        const cards = await fetchSwipeExcluded({
          owned: excludeOwned,
          chasing: excludeChasing,
        })
        keys = new Set(cards.map((c) => exclusionKey(c.set_id, c.number)))
      } catch {
        keys = new Set()
      }
      if (cancelled) return
      setExcludedKeys(keys)
    })()
    return () => {
      cancelled = true
    }
  }, [excludeOwned, excludeChasing])

  const recordSeen = useCallback(
    (setId: string, number: string, dir?: string) => {
      const key = exclusionKey(setId, number)
      if (!keysRef.current.has(key)) {
        const next = new Set(keysRef.current)
        next.add(key)
        keysRef.current = next
        setExcludedKeys(next)
      }
      // Fire-and-forget; a failed persist just means this card may return
      // in a future session. The in-session exclusion above still holds.
      void recordSwipeSeen(setId, number, dir).catch(() => {})
    },
    [],
  )

  const resetDeck = useCallback(() => {
    const empty = new Set<string>()
    keysRef.current = empty
    setExcludedKeys(empty)
    void resetSwipeSeen().catch(() => {})
  }, [])

  return { excludedKeys, recordSeen, resetDeck }
}
