/**
 * useCollections — shared fetcher + lightweight cache for the
 * `/api/v1/collections` summary list. Both the `AddToCollectionButton`
 * picker (per result row) and the `LibraryBindersTab` listing read
 * from here, so creating a collection in one surface lights up the
 * other without a second round-trip.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  addCardToCollection,
  bulkAddToCollection,
  createCollection,
  deleteCollection,
  fetchCollections,
  updateCollection,
  updateCollectionItem,
  type CollectionSummary,
  type CreateCollectionOptions,
  type UpdateCollectionOptions,
} from '../api/client'
import { invalidateOwnership } from './useCardOwnership'

interface State {
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
  // True once the first fetch has resolved or failed. Callers that gate on
  // load (e.g. binder slot math, #774) must check this, not `!loading`: the
  // list starts empty with loading=false before the effect kicks off.
  fetched: boolean
}

const listeners = new Set<(s: State) => void>()
let state: State = { collections: [], loading: false, error: null, fetched: false }
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
      const collections = await fetchCollections()
      set({ collections, loading: false, fetched: true })
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

export function useCollections() {
  const [snapshot, setSnapshot] = useState<State>(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    if (state.collections.length === 0 && !state.loading) {
      void refresh()
    }
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])

  const create = useCallback(
    async (name: string, options?: CreateCollectionOptions) => {
      const created = await createCollection(name, options)
      // Append to the cache and bump item_count when items arrive later.
      // A dynamic collection lands with its already-resolved membership, so
      // seed item_count from the returned items rather than zero.
      set({
        collections: [
          {
            id: created.id,
            name: created.name,
            description: created.description,
            created_at: created.created_at,
            item_count: created.items.length,
            total_quantity: created.items.length,
            kind: created.kind,
            source_set_id: created.source_set_id,
            rule: created.rule,
            dynamic_scope: created.dynamic_scope,
            binder_id: created.binder_id,
            binder_format: created.binder_format,
            binder_color: created.binder_color,
            binder_type: created.binder_type,
            capacity: created.capacity,
            is_master_set: created.is_master_set,
          },
          ...state.collections,
        ],
      })
      return created
    },
    [],
  )

  const update = useCallback(
    async (collectionId: number, patch: UpdateCollectionOptions) => {
      const updated = await updateCollection(collectionId, patch)
      // Merge the edited identity back into the cached summary so every
      // surface re-renders without a refetch. item_count is untouched here.
      set({
        collections: state.collections.map((c) =>
          c.id === collectionId
            ? {
                ...c,
                name: updated.name,
                description: updated.description,
                binder_id: updated.binder_id,
                binder_format: updated.binder_format,
                binder_color: updated.binder_color,
                binder_type: updated.binder_type,
                capacity: updated.capacity,
                is_master_set: updated.is_master_set,
              }
            : c,
        ),
      })
      return updated
    },
    [],
  )

  const addCard = useCallback(
    async (
      collectionId: number,
      card: Record<string, unknown>,
      notes?: string,
    ) => {
      await addCardToCollection(collectionId, card, notes)
      // The card's ownership badge (#576) is now stale across every
      // surface — drop the shared cache so it re-fetches.
      invalidateOwnership()
      set({
        collections: state.collections.map((c) =>
          c.id === collectionId
            ? {
                ...c,
                item_count: c.item_count + 1,
                total_quantity: (c.total_quantity ?? c.item_count) + 1,
              }
            : c,
        ),
      })
    },
    [],
  )

  const bulkAdd = useCallback(
    async (
      collectionId: number,
      cards: Record<string, unknown>[],
      opts?: { notes?: string | null; addedVia?: string },
    ) => {
      const result = await bulkAddToCollection(collectionId, cards, opts)
      // Every added card's ownership badge (#576) is now stale — drop the
      // shared cache so it re-fetches.
      invalidateOwnership()
      set({
        collections: state.collections.map((c) =>
          c.id === collectionId
            ? {
                ...c,
                item_count: c.item_count + result.added,
                total_quantity: (c.total_quantity ?? c.item_count) + result.added,
              }
            : c,
        ),
      })
      return result
    },
    [],
  )

  // Set a card's owned quantity (#769). `quantityDelta` (new − old) keeps the
  // collection summary's total_quantity — binder fill / slot math — in sync
  // without a refetch; the ownership badge (#576) is busted since counts moved.
  const setItemQuantity = useCallback(
    async (collectionId: number, itemId: number, quantity: number, quantityDelta: number) => {
      const updated = await updateCollectionItem(collectionId, itemId, quantity)
      invalidateOwnership()
      if (quantityDelta !== 0) {
        set({
          collections: state.collections.map((c) =>
            c.id === collectionId
              ? { ...c, total_quantity: (c.total_quantity ?? c.item_count) + quantityDelta }
              : c,
          ),
        })
      }
      return updated
    },
    [],
  )

  const remove = useCallback(async (collectionId: number) => {
    await deleteCollection(collectionId)
    // Cascade-removed items drop the cards' ownership badges (#576) — bust
    // the shared cache so they re-fetch.
    invalidateOwnership()
    set({ collections: state.collections.filter((c) => c.id !== collectionId) })
  }, [])

  return {
    ...snapshot,
    refresh,
    create,
    update,
    addCard,
    bulkAdd,
    setItemQuantity,
    remove,
  }
}

// Test-only: reset the module-level cache between vitest runs so each
// test starts with an empty list. Production code should not call this.
export function _resetCollectionsCacheForTests() {
  state = { collections: [], loading: false, error: null, fetched: false }
  inflight = null
  listeners.clear()
}
