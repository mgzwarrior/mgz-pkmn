/**
 * useBinders — shared fetcher + lightweight cache for the `/api/v1/binders`
 * inventory list (#702). A binder is a physical binder you own that holds
 * collections; the `LibraryBindersTab` inventory view reads from here.
 *
 * Mirrors the module-level-store pattern in `useCollections` so a binder
 * created in one surface lights up every consumer without a refetch.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  createBinder,
  deleteBinder,
  fetchBinders,
  updateBinder,
  type BinderInput,
  type BinderSummary,
} from '../api/client'

interface State {
  binders: BinderSummary[]
  loading: boolean
  error: string | null
  /** True once the first fetch has resolved (success or error). Distinguishes
   *  "no binders yet" from "haven't loaded yet" — the list starts empty with
   *  `loading: false`, so callers that gate on load must check this, not
   *  `!loading` (#775 review). */
  fetched: boolean
}

const listeners = new Set<(s: State) => void>()
let state: State = { binders: [], loading: false, error: null, fetched: false }
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
      const binders = await fetchBinders()
      set({ binders, loading: false, fetched: true })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e), fetched: true })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useBinders() {
  const [snapshot, setSnapshot] = useState<State>(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    if (state.binders.length === 0 && !state.loading) {
      void refresh()
    }
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])

  const create = useCallback(async (name: string, input?: BinderInput) => {
    const created = await createBinder(name, input)
    set({
      binders: [
        {
          id: created.id,
          name: created.name,
          created_at: created.created_at,
          binder_format: created.binder_format,
          binder_color: created.binder_color,
          binder_type: created.binder_type,
          capacity: created.capacity,
          collection_count: created.collection_count,
          is_empty: created.is_empty,
        },
        ...state.binders,
      ],
    })
    return created
  }, [])

  const update = useCallback(
    async (binderId: number, patch: { name?: string } & BinderInput) => {
      const updated = await updateBinder(binderId, patch)
      set({
        binders: state.binders.map((b) =>
          b.id === binderId
            ? {
                ...b,
                name: updated.name,
                binder_format: updated.binder_format,
                binder_color: updated.binder_color,
                binder_type: updated.binder_type,
                capacity: updated.capacity,
              }
            : b,
        ),
      })
      return updated
    },
    [],
  )

  const remove = useCallback(async (binderId: number) => {
    await deleteBinder(binderId)
    set({ binders: state.binders.filter((b) => b.id !== binderId) })
  }, [])

  return { ...snapshot, refresh, create, update, remove }
}

// Test-only: reset the module-level cache between vitest runs.
export function _resetBindersCacheForTests() {
  state = { binders: [], loading: false, error: null, fetched: false }
  inflight = null
  listeners.clear()
}
