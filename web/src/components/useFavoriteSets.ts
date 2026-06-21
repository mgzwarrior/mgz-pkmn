/**
 * useFavoriteSets — shared fetcher + cache for the `/api/v1/favorite-sets`
 * pinned-set list and its owned-signal suggestions (#712, epic #701).
 *
 * Favorite sets are the durable, server-side half of the swipe taste
 * profile: an explicit "I love this set" the user curates, kept in the DB
 * so other surfaces can read it across devices.
 *
 * Mirrors the module-level-store pattern in `useBinders` so a pin in one
 * surface lights up every consumer without a refetch. Pins and unpins are
 * optimistic; suggestions drop a set the moment it's pinned.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  fetchFavoriteSets,
  fetchFavoriteSetSuggestions,
  pinFavoriteSet,
  unpinFavoriteSet,
  type FavoriteSet,
  type FavoriteSetSuggestion,
} from '../api/client'

interface State {
  favorites: FavoriteSet[]
  suggestions: FavoriteSetSuggestion[]
  loading: boolean
  error: string | null
}

const listeners = new Set<(s: State) => void>()
let state: State = {
  favorites: [],
  suggestions: [],
  loading: false,
  error: null,
}
let inflight: Promise<void> | null = null

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const fn of listeners) fn(state)
}

async function refresh(): Promise<void> {
  if (inflight) return inflight
  set({ loading: true, error: null })
  inflight = (async () => {
    try {
      const [favorites, suggestions] = await Promise.all([
        fetchFavoriteSets(),
        fetchFavoriteSetSuggestions(),
      ])
      set({ favorites, suggestions, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * @param enabled When false, skip the auto-fetch on mount — favorite sets
 *   are per-user, so a signed-out consumer (e.g. the candidate-weighting in
 *   `SwipePanel`) reads an empty list instead of hitting the endpoint as the
 *   default user. Defaults to true.
 */
export function useFavoriteSets({ enabled = true }: { enabled?: boolean } = {}) {
  const [snapshot, setSnapshot] = useState<State>(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    if (
      enabled &&
      state.favorites.length === 0 &&
      state.suggestions.length === 0 &&
      !state.loading
    ) {
      void refresh()
    }
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [enabled])

  const pin = useCallback(async (setId: string) => {
    if (state.favorites.some((f) => f.set_id === setId)) return
    // Optimistic: add the pin and drop it from the suggestion list. Keep
    // both snapshots so a failed request restores the suggestion too —
    // otherwise a transient error would strand the set, pinned nowhere and
    // no longer suggested.
    const previousFavorites = state.favorites
    const previousSuggestions = state.suggestions
    set({
      favorites: [
        { set_id: setId, pinned_at: new Date().toISOString() },
        ...state.favorites,
      ],
      suggestions: state.suggestions.filter((s) => s.set_id !== setId),
    })
    try {
      await pinFavoriteSet(setId)
    } catch (e) {
      set({
        favorites: previousFavorites,
        suggestions: previousSuggestions,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }, [])

  const unpin = useCallback(async (setId: string) => {
    const previous = state.favorites
    set({ favorites: state.favorites.filter((f) => f.set_id !== setId) })
    try {
      await unpinFavoriteSet(setId)
    } catch (e) {
      set({
        favorites: previous,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }, [])

  const isPinned = useCallback(
    (setId: string) => snapshot.favorites.some((f) => f.set_id === setId),
    [snapshot.favorites],
  )

  return { ...snapshot, refresh, pin, unpin, isPinned }
}

// Test-only: reset the module-level cache between vitest runs.
export function _resetFavoriteSetsCacheForTests() {
  state = { favorites: [], suggestions: [], loading: false, error: null }
  inflight = null
  listeners.clear()
}
