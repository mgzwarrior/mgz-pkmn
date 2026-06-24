/**
 * LibrarySearchesTab — list of *saved* runs (curated, named) for the
 * Searches tab inside [LibraryPanel](./LibraryPanel.tsx). Click a row to
 * hydrate the editor + results store with the saved input and persisted
 * `view_state`. Server-side every completed `/bulk` stream is persisted,
 * but only runs with a non-null `name` surface here.
 *
 * Distinct from [LibraryRecentTab](./LibraryRecentTab.tsx) which lists
 * recent *inputs* stored client-side for one-tap re-runs.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import { deleteRun, getRun, listRuns } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import { formatMoney, formatRelativeTime } from '../utils/format'
import type { RunDetail, RunRowDetail, RunSummary, Row } from '../types'

const RUN_LIST_LIMIT = 50

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

function summaryTotal(run: RunSummary): { amount: number; currency: string } | null {
  const entries = Object.entries(run.summary.totals_by_currency ?? {})
  if (entries.length === 0) return null
  const [currency, amount] = entries.reduce((a, b) => (b[1] > a[1] ? b : a))
  return { amount, currency }
}

export function LibrarySearchesTab() {
  const auth = useAuth()
  const {
    runs,
    setRuns,
    currentRunId,
    setCurrentRunId,
    isRunning,
    setInputText,
    setRows,
    clearRows,
    setProgress,
    setProcessingLines,
    setRunStartedAt,
    setRunEndedAt,
    setViewState,
  } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null)
  const [deletingRunId, setDeletingRunId] = useState<number | null>(null)
  // Synchronous guard against rapid-fire concurrent loads — see
  // SavedSearchesSidebar history; a ref updates synchronously where a
  // useState value would be stale across consecutive native click events
  // in the same tick.
  const loadInFlightRef = useRef(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (auth.loading || (auth.authEnabled && auth.user === null)) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { items } = await listRuns(RUN_LIST_LIMIT)
        if (!cancelled) setRuns(items)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load saved searches')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [auth.authEnabled, auth.loading, auth.user, refreshKey, setRuns])

  // Refresh when a streaming run finishes so a fresh save shows up
  // without a manual reload.
  const prevRunningRef = useRef(isRunning)
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      setRefreshKey((k) => k + 1)
    }
    prevRunningRef.current = isRunning
  }, [isRunning])

  const handleLoad = useCallback(
    async (run: RunSummary) => {
      if (isRunning || loadInFlightRef.current) return
      loadInFlightRef.current = true
      setLoadingRunId(run.id)
      setError(null)
      try {
        const detail: RunDetail = await getRun(run.id)
        setInputText(detail.input_text)
        clearRows()
        setRows(detail.rows.map(runRowToRow))
        setProgress(null)
        setProcessingLines([])
        setRunStartedAt(null)
        setRunEndedAt(null)
        setCurrentRunId(detail.id)
        setViewState(
          detail.view_state ?? {
            ...EMPTY_VIEW_STATE,
            filters: { ...EMPTY_VIEW_STATE.filters },
          },
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to load run ${run.id}`)
      } finally {
        setLoadingRunId(null)
        loadInFlightRef.current = false
      }
    },
    [
      isRunning,
      setInputText,
      clearRows,
      setRows,
      setProgress,
      setProcessingLines,
      setRunStartedAt,
      setRunEndedAt,
      setCurrentRunId,
      setViewState,
    ],
  )

  // Optimistic delete: drop the row immediately, restore it (and surface the
  // error) if the request fails. Mirrors the collection / wishlist list
  // mutation pattern. `setRuns` is a wholesale replace, so we snapshot and
  // restore the full list.
  const handleDelete = useCallback(
    async (run: RunSummary) => {
      if (deletingRunId !== null) return
      const previous = runs
      setDeletingRunId(run.id)
      setError(null)
      setRuns(runs.filter((r) => r.id !== run.id))
      if (run.id === currentRunId) setCurrentRunId(null)
      try {
        await deleteRun(run.id)
      } catch (err) {
        setRuns(previous)
        setError(err instanceof Error ? err.message : `Failed to delete run ${run.id}`)
      } finally {
        setDeletingRunId(null)
      }
    },
    [deletingRunId, runs, currentRunId, setRuns, setCurrentRunId],
  )

  if (auth.loading) {
    return <p className="text-xs text-coconut-400 dark:text-sand-400">Loading...</p>
  }

  if (auth.authEnabled && auth.user === null) {
    return (
      <p className="text-xs text-coconut-500 dark:text-sand-300">
        Sign in to see saved searches.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && runs.length === 0 && (
        <p className="text-xs text-coconut-400 dark:text-sand-400">Loading…</p>
      )}

      {!loading && runs.length === 0 && !error && (
        <p className="text-xs text-coconut-500 dark:text-sand-300">
          No saved searches yet. Run a lookup, then click <em>Save search</em> on the
          results to keep it here.
        </p>
      )}

      {runs.length > 0 && (
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {runs.map((run) => (
            <SavedSearchRow
              key={run.id}
              run={run}
              isCurrent={run.id === currentRunId}
              disabled={isRunning || loadingRunId !== null}
              deleting={deletingRunId === run.id}
              onLoad={() => handleLoad(run)}
              onDelete={() => handleDelete(run)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SavedSearchRow({
  run,
  isCurrent,
  disabled,
  deleting,
  onLoad,
  onDelete,
}: {
  run: RunSummary
  isCurrent: boolean
  disabled: boolean
  deleting: boolean
  onLoad: () => void
  onDelete: () => void
}) {
  // Two-step inline confirm — a saved search can be real iterative work, so
  // the trash icon flips to confirm/cancel rather than deleting on first
  // click. Mirrors the BinderInventory delete affordance.
  const [confirming, setConfirming] = useState(false)
  const total = summaryTotal(run)
  const createdAt = Date.parse(run.created_at)
  const tagEntries = Object.entries(run.summary.tag_counts ?? {})
  const rowWord = run.row_count === 1 ? 'row' : 'rows'
  const summaryLabel = total
    ? `${run.row_count} ${rowWord} · ${formatMoney(total.amount, total.currency)}`
    : `${run.row_count} ${rowWord}`
  const label = run.name ?? `Run ${run.id}`

  return (
    <li
      className={`group flex flex-col gap-1 rounded border px-2 py-1.5 transition-colors ${
        isCurrent
          ? 'border-palm-300 bg-palm-50 dark:border-palm-500 dark:bg-palm-500/10'
          : 'border-transparent hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-200 dark:hover:bg-husk-100/60'
      }`}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={onLoad}
          disabled={disabled}
          aria-label={`Load saved search ${label}: ${summaryLabel}`}
          aria-current={isCurrent ? 'true' : undefined}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="w-full truncate font-medium text-coconut-700 dark:text-sand-100">
            {label}
          </span>
          <span className="flex w-full items-baseline justify-between gap-2 font-mono text-[11px]">
            <span className="tabular-nums text-coconut-400 dark:text-sand-300">
              {formatRelativeTime(createdAt)}
            </span>
            <span className="truncate text-coconut-500 dark:text-sand-300">{summaryLabel}</span>
          </span>
        </button>
        {confirming ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                setConfirming(false)
                onDelete()
              }}
              disabled={deleting}
              aria-label={`Confirm delete saved search ${label}`}
              className="rounded p-1 text-ember-600 hover:bg-ember-500/10 disabled:opacity-50 dark:text-ember-300 dark:hover:bg-husk-100"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              aria-label="Cancel delete"
              className="rounded p-1 text-coconut-400 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
            >
              <X size={13} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleting}
            aria-label={`Delete saved search ${label}`}
            className="shrink-0 rounded p-1 text-coconut-400 hover:text-ember-500 disabled:opacity-50 dark:text-sand-300 dark:hover:text-ember-300"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {tagEntries.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tagEntries.map(([tag, count]) => (
            <span
              key={tag}
              className="rounded bg-sand-200 dark:bg-husk-100 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-coconut-500 dark:text-sand-300"
            >
              {tag} ×{count}
            </span>
          ))}
        </div>
      )}
    </li>
  )
}
