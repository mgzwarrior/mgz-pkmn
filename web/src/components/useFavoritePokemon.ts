/**
 * useFavoritePokemon — shared fetcher + cache for the `/api/v1/favorite-pokemon`
 * pinned-species list (#742, epic #701).
 *
 * The species-level sibling of {@link useFavoriteSets}: favorite Pokémon are
 * the durable, server-side half of the swipe taste profile — an explicit "I
 * love this Pokémon" the user curates, kept in the DB (keyed by national
 * Pokédex number) so Browse and Swipe can read it across devices.
 *
 * Mirrors the module-level-store pattern so a pin in one surface (the pokedex
 * tiles, the onboarding survey) lights up every consumer without a refetch.
 * Pins and unpins are optimistic.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  fetchFavoritePokemon,
  pinFavoritePokemon,
  unpinFavoritePokemon,
  type FavoritePokemon,
} from '../api/client'

interface State {
  favorites: FavoritePokemon[]
  loading: boolean
  error: string | null
}

const listeners = new Set<(s: State) => void>()
let state: State = { favorites: [], loading: false, error: null }
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
      const favorites = await fetchFavoritePokemon()
      set({ favorites, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * @param enabled When false, skip the auto-fetch on mount — favorite Pokémon
 *   are per-user, so a signed-out consumer reads an empty list instead of
 *   hitting the endpoint as the default user. Defaults to true.
 */
export function useFavoritePokemon({ enabled = true }: { enabled?: boolean } = {}) {
  const [snapshot, setSnapshot] = useState<State>(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    if (enabled && state.favorites.length === 0 && !state.loading) {
      void refresh()
    }
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [enabled])

  const pin = useCallback(async (dexNumber: number) => {
    if (state.favorites.some((f) => f.dex_number === dexNumber)) return
    const previous = state.favorites
    set({
      favorites: [
        { dex_number: dexNumber, pinned_at: new Date().toISOString() },
        ...state.favorites,
      ],
    })
    try {
      await pinFavoritePokemon(dexNumber)
    } catch (e) {
      set({ favorites: previous, error: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  const unpin = useCallback(async (dexNumber: number) => {
    const previous = state.favorites
    set({ favorites: state.favorites.filter((f) => f.dex_number !== dexNumber) })
    try {
      await unpinFavoritePokemon(dexNumber)
    } catch (e) {
      set({ favorites: previous, error: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  const isFavorite = useCallback(
    (dexNumber: number) => snapshot.favorites.some((f) => f.dex_number === dexNumber),
    [snapshot.favorites],
  )

  return { ...snapshot, refresh, pin, unpin, isFavorite }
}

// Test-only: reset the module-level cache between vitest runs.
export function _resetFavoritePokemonCacheForTests() {
  state = { favorites: [], loading: false, error: null }
  inflight = null
  listeners.clear()
}
