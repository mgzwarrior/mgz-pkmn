/**
 * loadSavedRun — hydrate the editor + results store from a persisted run.
 *
 * Shared by [LibrarySearchesTab](./LibrarySearchesTab.tsx) (the Backpack's
 * Searches tab) and the results pane's empty state (#523), which both offer
 * a "load this saved search" entry point and need the same store writes.
 */
import { getRun } from '../api/client'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import type { RunDetail, RunRowDetail, RunSummary, Row } from '../types'

function runRowToRow(rr: RunRowDetail): Row {
  return {
    query: rr.query,
    card: rr.card,
    pricing: rr.pricing,
    tag: rr.tag,
    matched: rr.card !== null,
    reason: '',
  }
}

export async function loadSavedRun(run: RunSummary, onShowSearch: () => void): Promise<void> {
  const store = useAppStore.getState()
  const detail: RunDetail = await getRun(run.id)
  store.setInputText(detail.input_text)
  store.clearRows()
  store.setRows(detail.rows.map(runRowToRow))
  store.setProgress(null)
  store.setProcessingLines([])
  store.setRunStartedAt(null)
  store.setRunEndedAt(null)
  store.setCurrentRunId(detail.id)
  store.setViewState(
    detail.view_state ?? { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
  )
  // A prior lookup may have left the editor collapsed to its one-line
  // summary; this path never touches `isRunning` (the only other trigger
  // that re-expands it), so without this the loaded input would sit hidden
  // behind a stale line-count bar (#523).
  store.setEditorCollapsed(false)
  // The app opens on Swipe (#814); the loaded rows live in the Search
  // editor/results, so surface that mode or they stay hidden.
  onShowSearch()
}
