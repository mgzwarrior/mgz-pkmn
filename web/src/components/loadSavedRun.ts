/**
 * loadSavedRun — hydrate the editor + results store from a persisted run.
 *
 * Shared by [LibrarySearchesTab](./LibrarySearchesTab.tsx) (the Backpack's
 * Searches tab) and the results pane's empty state (#523), which both offer
 * a "load this saved search" entry point and need the same store writes.
 */
import { getRun } from '../api/client'
import { normalizeViewState, useAppStore } from '../store'
import type { RunDetail, RunRowDetail, RunSummary, Row } from '../types'
import { isCardCondition, rowConditionKey } from '../utils/conditionPricing'

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

function conditionOverridesForRows(rows: Row[]): Record<string, NonNullable<Row['pricing']['condition']>> {
  const overrides: Record<string, NonNullable<Row['pricing']['condition']>> = {}
  for (const row of rows) {
    const condition = row.pricing.condition
    if (isCardCondition(condition)) overrides[rowConditionKey(row)] = condition
  }
  return overrides
}

export async function loadSavedRun(run: RunSummary, onShowSearch: () => void): Promise<void> {
  const store = useAppStore.getState()
  const detail: RunDetail = await getRun(run.id)
  const rows = detail.rows.map(runRowToRow)
  store.setInputText(detail.input_text)
  store.clearRows()
  store.setRows(rows)
  store.setRowConditionOverrides(conditionOverridesForRows(rows))
  store.setProgress(null)
  store.setProcessingLines([])
  store.setRunStartedAt(null)
  store.setRunEndedAt(null)
  store.setCurrentRunId(detail.id)
  store.setViewState(normalizeViewState(detail.view_state))
  // A prior lookup may have left the editor collapsed to its one-line
  // summary; this path never touches `isRunning` (the only other trigger
  // that re-expands it), so without this the loaded input would sit hidden
  // behind a stale line-count bar (#523).
  store.setEditorCollapsed(false)
  // The app opens on Swipe (#814); the loaded rows live in the Search
  // editor/results, so surface that mode or they stay hidden.
  onShowSearch()
}
