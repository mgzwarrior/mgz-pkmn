/**
 * useCardOwnership — cross-collection ownership lookup for the inline badge
 * (#576), shared across the search / browse / swipe surfaces.
 *
 * Each surface hands the hook the `(set_id, number)` identities currently on
 * screen; the hook batches the *uncached* ones into a single
 * `POST /cards/ownership` and returns a `lookup(setId, number)` that reads
 * the result. A module-level cache dedupes across surfaces and across
 * re-fetches, so paging through Browse or swiping never re-asks about a card
 * it already knows.
 *
 * Cache entries are three-valued: `CardOwnership` (owned / chasing — render
 * a badge), `null` (fetched, no occupancy — render nothing), or `undefined`
 * (not yet known). After a save, {@link invalidateOwnership} clears the
 * cache so every mounted surface re-fetches its visible identities and the
 * badge reflects the new state.
 *
 * Degrades gracefully: a failed fetch (e.g. auth on + anonymous → 401)
 * marks the requested identities as "no occupancy", so the surfaces render
 * without badges instead of throwing.
 */
import { useCallback, useEffect, useReducer } from 'react'
import { fetchCardOwnership, type CardOwnership } from '../api/client'

export interface CardIdentity {
  setId: string
  number: string
}

/** Map key for a `(set_id, number)` pair — mirrors the server's `_key`. */
export function ownershipKey(setId: string, number: string): string {
  return `${setId}::${number}`
}

// ---- module-level shared cache ----

const cache = new Map<string, CardOwnership | null>()
const inflight = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

/** Server-side cap on one `POST /cards/ownership` batch — `MAX_CARDS` in
 *  `api/routes/ownership.py`. Bigger surfaces (a browse class like
 *  Supporters runs 1000+ cards, #911) split into requests of this size; a
 *  single oversized batch would 422 and falsely cache everything as
 *  unowned. */
const MAX_BATCH = 500

function notify() {
  version += 1
  for (const fn of listeners) fn()
}

/**
 * Fetch occupancy for any of `identities` not already cached or in flight.
 * No-ops when everything is known. Merges the sparse response back into the
 * cache (requested-but-absent keys become `null`).
 */
async function ensureOwnership(identities: CardIdentity[]): Promise<void> {
  const missing = identities.filter((c) => {
    const key = ownershipKey(c.setId, c.number)
    return !cache.has(key) && !inflight.has(key)
  })
  if (missing.length === 0) return

  for (const c of missing) inflight.add(ownershipKey(c.setId, c.number))
  const chunks: CardIdentity[][] = []
  for (let i = 0; i < missing.length; i += MAX_BATCH) {
    chunks.push(missing.slice(i, i + MAX_BATCH))
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const result = await fetchCardOwnership(
          chunk.map((c) => ({ set_id: c.setId, number: c.number })),
        )
        for (const c of chunk) {
          const key = ownershipKey(c.setId, c.number)
          cache.set(key, result[key] ?? null)
        }
      } catch {
        // Anonymous / offline → no badges. Mark absent so we don't refetch on
        // every render; an explicit invalidate (e.g. after sign-in + save)
        // clears this.
        for (const c of chunk) cache.set(ownershipKey(c.setId, c.number), null)
      } finally {
        for (const c of chunk) inflight.delete(ownershipKey(c.setId, c.number))
      }
    }),
  )
  notify()
}

/**
 * Drop every cached ownership entry and re-notify. Mounted surfaces
 * re-fetch their visible identities on the next render. Call after a card
 * is added to / removed from a collection or wishlist.
 */
export function invalidateOwnership(): void {
  cache.clear()
  inflight.clear()
  notify()
}

/**
 * Subscribe to the shared cache for the given on-screen identities. Returns
 * a `lookup` reading current occupancy: `CardOwnership` when owned / chasing,
 * `null` when known-empty, `undefined` until first known.
 */
export function useCardOwnership(identities: CardIdentity[]) {
  const [, force] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    listeners.add(force)
    return () => {
      listeners.delete(force)
    }
  }, [])

  // Re-key on the identity set so the effect refires when the visible cards
  // change. `version` is in the dep list so an `invalidateOwnership` (which
  // bumps it) re-runs the fetch against the freshly-cleared cache.
  const idsKey = identities
    .map((c) => ownershipKey(c.setId, c.number))
    .sort()
    .join(',')
  useEffect(() => {
    if (identities.length > 0) void ensureOwnership(identities)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, version])

  const lookup = useCallback(
    (setId: string, number: string): CardOwnership | null | undefined =>
      cache.get(ownershipKey(setId, number)),
    // Re-derive on every cache change so consumers see fresh values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  )

  return { lookup }
}

// Test-only: reset the shared cache + listeners between cases.
export function _resetCardOwnershipForTests() {
  cache.clear()
  inflight.clear()
  listeners.clear()
  version = 0
}
