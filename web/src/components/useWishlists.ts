/**
 * useWishlists — shared fetcher + lightweight cache for the
 * `/api/v1/wishlists` summary list. Mirrors `useCollections` from the
 * third ADR-0013 slice; both the `AddToWishlistButton` picker and the
 * `LibraryWishlistsTab` listing read from here, so creating a wishlist
 * in one surface lights up the other without a second round-trip.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  addCardToWishlist,
  createWishlist,
  fetchWishlists,
  type WishlistSummary,
} from '../api/client'

interface State {
  wishlists: WishlistSummary[]
  loading: boolean
  error: string | null
}

const listeners = new Set<(s: State) => void>()
let state: State = { wishlists: [], loading: false, error: null }
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
      const wishlists = await fetchWishlists()
      set({ wishlists, loading: false })
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useWishlists() {
  const [snapshot, setSnapshot] = useState<State>(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    if (state.wishlists.length === 0 && !state.loading) {
      void refresh()
    }
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])

  const create = useCallback(async (name: string, description?: string) => {
    const created = await createWishlist(name, description)
    set({
      wishlists: [
        {
          id: created.id,
          name: created.name,
          description: created.description,
          created_at: created.created_at,
          item_count: created.items.length,
        },
        ...state.wishlists,
      ],
    })
    return created
  }, [])

  const addCard = useCallback(
    async (
      wishlistId: number,
      card: Record<string, unknown>,
      opts?: { notes?: string; maxPrice?: number | null },
    ) => {
      await addCardToWishlist(wishlistId, card, opts)
      set({
        wishlists: state.wishlists.map((w) =>
          w.id === wishlistId
            ? { ...w, item_count: w.item_count + 1 }
            : w,
        ),
      })
    },
    [],
  )

  return {
    ...snapshot,
    refresh,
    create,
    addCard,
  }
}

// Test-only: reset the module-level cache between vitest runs.
export function _resetWishlistsCacheForTests() {
  state = { wishlists: [], loading: false, error: null }
  inflight = null
  listeners.clear()
}
