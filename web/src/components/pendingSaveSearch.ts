import type { SavedViewState } from '../types'

const PENDING_SAVE_SEARCH_KEY = 'mgz-pkmn:pending-save-search'

export interface PendingSaveSearch {
  runId: number
  name: string
  viewState: SavedViewState
}

export function storePendingSaveSearch(pending: PendingSaveSearch) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(PENDING_SAVE_SEARCH_KEY, JSON.stringify(pending))
}

export function consumePendingSaveSearch(): PendingSaveSearch | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(PENDING_SAVE_SEARCH_KEY)
  if (raw === null) return null
  window.sessionStorage.removeItem(PENDING_SAVE_SEARCH_KEY)
  try {
    const parsed = JSON.parse(raw) as PendingSaveSearch
    if (
      typeof parsed.runId !== 'number' ||
      typeof parsed.name !== 'string' ||
      parsed.viewState === null ||
      typeof parsed.viewState !== 'object'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
