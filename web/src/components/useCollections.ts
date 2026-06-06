/**
 * useCollections — shared fetcher + lightweight cache for the
 * `/api/v1/collections` summary list. Both the `AddToCollectionButton`
 * picker (per result row) and the `CollectionsModal` listing read from
 * here, so creating a collection in one surface lights up the other
 * without a second round-trip.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  addCardToCollection,
  createCollection,
  fetchCollections,
  type CollectionSummary,
} from '../api/client'

interface State {
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
}

const listeners = new Set<(s: State) => void>()
let state: State = { collections: [], loading: false, error: null }
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
      set({ collections, loading: false })
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

  const create = useCallback(async (name: string, description?: string) => {
    const created = await createCollection(name, description)
    // Append to the cache and bump item_count when items arrive later.
    set({
      collections: [
        {
          id: created.id,
          name: created.name,
          description: created.description,
          created_at: created.created_at,
          item_count: created.items.length,
        },
        ...state.collections,
      ],
    })
    return created
  }, [])

  const addCard = useCallback(
    async (
      collectionId: number,
      card: Record<string, unknown>,
      notes?: string,
    ) => {
      await addCardToCollection(collectionId, card, notes)
      set({
        collections: state.collections.map((c) =>
          c.id === collectionId
            ? { ...c, item_count: c.item_count + 1 }
            : c,
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

// Test-only: reset the module-level cache between vitest runs so each
// test starts with an empty list. Production code should not call this.
export function _resetCollectionsCacheForTests() {
  state = { collections: [], loading: false, error: null }
  inflight = null
  listeners.clear()
}
