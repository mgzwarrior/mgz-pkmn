/**
 * useBinderFiling — shared state for the "file this list into a binder" control
 * (#726), used by both the collection and smart-collection create flows.
 *
 * Owns the picker state and the binder/collection data hooks, and exposes
 * `resolveTarget()`, which creates the inline binder when the "new binder" path
 * was chosen and named, and returns the binder id to file into (or null for
 * "don't file"). The presentational control lives in
 * [BinderFilePicker](./BinderFilePicker.tsx).
 */
import { useMemo, useState } from 'react'
import type { BinderSummary } from '../api/client'
import { useBinders } from './useBinders'
import { useCollections } from './useCollections'

/** What the list files into: an existing binder's id, `'new'` for the inline
 *  create form, or null for "don't file". */
export type FileTarget = number | 'new' | null

export interface BinderFiling {
  settled: boolean
  hasBinders: boolean
  binders: BinderSummary[]
  usedByBinder: Map<number, number>
  target: FileTarget
  setTarget: (t: FileTarget) => void
  newBinderName: string
  setNewBinderName: (v: string) => void
  newBinderColor: string | null
  setNewBinderColor: (v: string | null) => void
  newBinderCapacity: string
  setNewBinderCapacity: (v: string) => void
  /** Resolve the binder to file into, creating an inline binder when the "new
   *  binder" path was chosen and named. Returns its id, or null for "don't
   *  file" (including a "new binder" path left unnamed). */
  resolveTarget: () => Promise<number | null>
  /** Refresh binder slot counts after a list was filed. */
  refresh: () => Promise<void>
}

export function useBinderFiling(): BinderFiling {
  const { collections } = useCollections()
  const { binders, fetched, create: createBinder, refresh } = useBinders()

  const [target, setTarget] = useState<FileTarget>(null)
  const [newBinderName, setNewBinderName] = useState('')
  const [newBinderColor, setNewBinderColor] = useState<string | null>(null)
  const [newBinderCapacity, setNewBinderCapacity] = useState('')

  // Gate on the first fetch completing, not on `!loading`: the list starts
  // empty with loading=false, so an un-fetched state would otherwise read as
  // "no binders yet" and let the create submit before binders load (#775).
  const settled = fetched
  const hasBinders = binders.length > 0

  // Cards already filed into each binder — the sum of its collections' pocket
  // counts (vendor multiples via total_quantity, falling back to row count).
  const usedByBinder = useMemo(() => {
    const map = new Map<number, number>()
    for (const c of collections) {
      if (c.binder_id == null) continue
      map.set(c.binder_id, (map.get(c.binder_id) ?? 0) + (c.total_quantity ?? c.item_count))
    }
    return map
  }, [collections])

  async function resolveTarget(): Promise<number | null> {
    if (typeof target === 'number') return target
    // The inline create form is the active path either when explicitly chosen
    // ('new') or when there are no binders to choose from yet. An unnamed form
    // resolves to "don't file" — filing stays optional.
    const inlineName = newBinderName.trim()
    const creatingNew = target === 'new' || !hasBinders
    if (creatingNew && inlineName) {
      const cap = newBinderCapacity.trim() ? Number(newBinderCapacity.trim()) : null
      const created = await createBinder(inlineName, {
        binder_color: newBinderColor,
        capacity: cap && cap > 0 ? cap : null,
      })
      return created.id
    }
    return null
  }

  return {
    settled,
    hasBinders,
    binders,
    usedByBinder,
    target,
    setTarget,
    newBinderName,
    setNewBinderName,
    newBinderColor,
    setNewBinderColor,
    newBinderCapacity,
    setNewBinderCapacity,
    resolveTarget,
    refresh,
  }
}
