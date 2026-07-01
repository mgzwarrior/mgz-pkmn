/**
 * useWishlists — shared fetcher + lightweight cache for the
 * `/api/v1/wishlists` summary list. Mirrors `useCollections` from the
 * third ADR-0013 slice; both the `AddToWishlistButton` picker and the
 * `LibraryBindersTab` listing read from here, so creating a want-list
 * in one surface lights up the other without a second round-trip.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  addCardToWishlist,
  bulkAddToWishlist,
  createWishlist,
  deleteWishlist,
  fetchWishlists,
  updateWishlist,
  type CreateWishlistOptions,
  type WishlistSummary,
} from '../api/client'
import { invalidateOwnership } from './useCardOwnership'

interface State {
  wishlists: WishlistSummary[]
  loading: boolean
  error: string | null
  // True once the first fetch has resolved or failed. Callers that gate on
  // load (e.g. binder slot math, #774) must check this, not `!loading`.
  fetched: boolean
}

const listeners = new Set<(s: State) => void>()
let state: State = { wishlists: [], loading: false, error: null, fetched: false }
let inflight: Promise<void> | null = null

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const fn of listeners) fn(state)
}

/** Refresh the shared wishlists cache from outside a mounted hook — the
 *  one-tap quick actions call this after a default-targeting save so the
 *  library list + "default" marker stay live (#762). */
export function refreshWishlistsCache(): Promise<void> {
  return refresh()
}

async function refresh(): Promise<void> {
  if (inflight) return inflight
  set({ loading: true, error: null })
  inflight = (async () => {
    try {
      const wishlists = await fetchWishlists()
      // Guard against a malformed (non-array) payload corrupting the cache —
      // subscribers iterate `wishlists`, so a stray null/undefined would crash
      // every mounted surface mid-render.
      set({ wishlists: Array.isArray(wishlists) ? wishlists : [], loading: false, fetched: true })
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
        fetched: true,
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

  const create = useCallback(async (name: string, options?: CreateWishlistOptions) => {
    const created = await createWishlist(name, options)
    set({
      wishlists: [
        {
          id: created.id,
          name: created.name,
          description: created.description,
          created_at: created.created_at,
          item_count: created.items.length,
          binder_id: created.binder_id,
        },
        ...state.wishlists,
      ],
    })
    return created
  }, [])

  // File a want-list into a binder (or pass null to unfile) and reflect the
  // new binder_id locally so the row + binder fill update without a refetch (#774).
  const file = useCallback(async (wishlistId: number, binderId: number | null) => {
    await updateWishlist(wishlistId, { binder_id: binderId })
    set({
      wishlists: state.wishlists.map((w) =>
        w.id === wishlistId ? { ...w, binder_id: binderId } : w,
      ),
    })
  }, [])

  // Rename a wishlist and patch the cached summary in place so the library
  // list updates without a refetch (#787). A name-only PATCH leaves is_default
  // and every other field intact (#762).
  const rename = useCallback(async (wishlistId: number, name: string) => {
    const updated = await updateWishlist(wishlistId, { name })
    set({
      wishlists: state.wishlists.map((w) =>
        w.id === wishlistId ? { ...w, name: updated.name } : w,
      ),
    })
    return updated
  }, [])

  const addCard = useCallback(
    async (
      wishlistId: number,
      card: Record<string, unknown>,
      opts?: { notes?: string; maxPrice?: number | null },
    ) => {
      await addCardToWishlist(wishlistId, card, opts)
      // Refresh the cross-surface ownership badge (#576) — this card is now
      // chased.
      invalidateOwnership()
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

  const bulkAdd = useCallback(
    async (
      wishlistId: number,
      cards: Record<string, unknown>[],
      opts?: { notes?: string | null; maxPrice?: number | null },
    ) => {
      const result = await bulkAddToWishlist(wishlistId, cards, opts)
      invalidateOwnership()
      set({
        wishlists: state.wishlists.map((w) =>
          w.id === wishlistId ? { ...w, item_count: w.item_count + result.added } : w,
        ),
      })
      return result
    },
    [],
  )

  const remove = useCallback(async (wishlistId: number) => {
    await deleteWishlist(wishlistId)
    // Cascade-removed chases drop the cards' ownership badges (#576) — bust
    // the shared cache so they re-fetch.
    invalidateOwnership()
    set({ wishlists: state.wishlists.filter((w) => w.id !== wishlistId) })
  }, [])

  return {
    ...snapshot,
    refresh,
    create,
    file,
    rename,
    addCard,
    bulkAdd,
    remove,
  }
}

// Test-only: reset the module-level cache between vitest runs.
export function _resetWishlistsCacheForTests() {
  state = { wishlists: [], loading: false, error: null, fetched: false }
  inflight = null
  listeners.clear()
}
