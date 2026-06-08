import type { SavedViewState } from '../types'

const PENDING_SAVE_SEARCH_KEY = 'mgz-pkmn:pending-save-search'

/**
 * Cross-reload handoff for "I clicked Sign in to save". Stashed before
 * the OAuth / magic-link round-trip and consumed by App.tsx after sign-
 * in resolves on the fresh mount. Carries just the run identifier and
 * the view state — the *name* is collected post-sign-in via the design-
 * system {@link SaveSearchNameDialog}, not pre-emptively before the
 * provider picker opens, so the visitor's first interaction with the
 * sign-in flow is the auth modal itself.
 */
export interface PendingSaveSearch {
  runId: number
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
