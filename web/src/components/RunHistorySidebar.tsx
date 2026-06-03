/**
 * RunHistorySidebar — collapsible left-rail panel listing server-side
 * lookup history persisted under `/api/v1/runs`. Each entry surfaces
 * timestamp, input-line count, total value, and the tag breakdown
 * computed at run-completion time (no `run_rows` payload load needed).
 *
 * Clicking a run fetches the full record from `/api/v1/runs/{id}` and
 * hydrates the editor + results store with its `input_text` and rows —
 * the existing ResultsTable renders the loaded run unmodified. The
 * **Re-export** action posts to `/api/v1/runs/{id}/export`, regenerating
 * the artifact server-side from persisted rows (no re-lookup).
 *
 * Distinct from {@link RecentRuns} which lives under the editor and
 * stores submitted *inputs* client-side for quick re-runs. This panel
 * is the canonical "load saved results" surface.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { History, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { exportRun, getRun, listRuns } from '../api/client'
import { useAppStore } from '../store'
import { formatMoney, formatRelativeTime } from '../utils/format'
import type { RunDetail, RunRowDetail, RunSummary, Row } from '../types'

/** How many runs to request from `/runs` on initial load. */
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

export function RunHistorySidebar() {
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
  } = useAppStore()
  const [collapsed, setCollapsed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null)
  const [exportingRunId, setExportingRunId] = useState<number | null>(null)
  // Synchronous guard against rapid-fire concurrent loads. A useState
  // value would be stale across consecutive native click events in the
  // same tick — React batches re-renders, so closures captured at
  // render time still see `loadingRunId === null` on the second click.
  // A ref updates synchronously and is the right tool for the race.
  const loadInFlightRef = useRef(false)

  // Bumping `refreshKey` triggers the loader effect. Kept as a counter
  // (rather than calling a refresh callback) so the actual fetch +
  // setState happen inside the effect — keeping
  // `react-hooks/set-state-in-effect` happy, matching the pattern used
  // by `BrowseModal` for its in-set card loader.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { items } = await listRuns(RUN_LIST_LIMIT)
        if (!cancelled) setRuns(items)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load run history')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [refreshKey, setRuns])

  // Refresh when a streaming run finishes — `/bulk` persists the run on
  // completion, so the sidebar should reflect the new entry without a
  // manual reload.
  const prevRunningRef = useRef(isRunning)
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      setRefreshKey((k) => k + 1)
    }
    prevRunningRef.current = isRunning
  }, [isRunning])

  const handleLoad = useCallback(
    async (run: RunSummary) => {
      // Concurrency guard: bail on any in-flight load (not just this row's)
      // so rapid-fire clicks on different rows can't race — last response
      // wins would otherwise hydrate the wrong run. Also no-op while a
      // bulk lookup is streaming.
      if (isRunning || loadInFlightRef.current) return
      loadInFlightRef.current = true
      setLoadingRunId(run.id)
      setError(null)
      try {
        const detail: RunDetail = await getRun(run.id)
        setInputText(detail.input_text)
        clearRows()
        setRows(detail.rows.map(runRowToRow))
        // Reset ephemeral lookup-progress UI so the ProcessingQueue and
        // LookupTimer don't reflect an unrelated streaming run after the
        // hydrate.
        setProgress(null)
        setProcessingLines([])
        setRunStartedAt(null)
        setRunEndedAt(null)
        setCurrentRunId(detail.id)
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
    ],
  )

  const handleReexport = useCallback(async (run: RunSummary) => {
    setExportingRunId(run.id)
    setError(null)
    try {
      await exportRun(run.id, 'xlsx')
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to re-export run ${run.id}`)
    } finally {
      setExportingRunId(null)
    }
  }, [])

  if (collapsed) {
    return (
      <aside
        aria-label="Run history (collapsed)"
        className="sticky top-20 flex h-fit flex-col items-center gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40 px-2 py-3"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand run history"
          aria-expanded={false}
          className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-600 dark:hover:text-sand-200"
        >
          <ChevronRight size={16} />
        </button>
        <History size={14} className="text-coconut-400 dark:text-sand-400" aria-hidden />
        <span className="text-[10px] font-medium text-coconut-400 dark:text-sand-400 tabular-nums">
          {runs.length}
        </span>
      </aside>
    )
  }

  return (
    <aside
      aria-label="Run history"
      className="sticky top-20 flex h-fit max-h-[calc(100vh-6rem)] w-64 flex-col gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40 px-3 py-2"
    >
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
          <History size={12} aria-hidden />
          Run history
          <span className="text-coconut-400 dark:text-sand-400 normal-case font-medium">
            ({runs.length})
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse run history"
          aria-expanded={true}
          className="rounded p-1 text-coconut-400 dark:text-sand-400 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-600 dark:hover:text-sand-200"
        >
          <ChevronLeft size={14} />
        </button>
      </header>

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
          No saved runs yet. Run a lookup and it&apos;ll appear here so you can
          re-open or re-export it later.
        </p>
      )}

      {runs.length > 0 && (
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              isCurrent={run.id === currentRunId}
              disabled={isRunning || loadingRunId !== null}
              isExporting={exportingRunId === run.id}
              onLoad={() => handleLoad(run)}
              onReexport={() => handleReexport(run)}
            />
          ))}
        </ul>
      )}
    </aside>
  )
}

function RunRow({
  run,
  isCurrent,
  disabled,
  isExporting,
  onLoad,
  onReexport,
}: {
  run: RunSummary
  isCurrent: boolean
  disabled: boolean
  isExporting: boolean
  onLoad: () => void
  onReexport: () => void
}) {
  const total = summaryTotal(run)
  const createdAt = Date.parse(run.created_at)
  const tagEntries = Object.entries(run.summary.tag_counts ?? {})
  const rowWord = run.row_count === 1 ? 'row' : 'rows'
  const summaryLabel = total
    ? `${run.row_count} ${rowWord} · ${formatMoney(total.amount, total.currency)}`
    : `${run.row_count} ${rowWord}`

  return (
    <li
      className={`group flex flex-col gap-1 rounded border px-2 py-1.5 transition-colors ${
        isCurrent
          ? 'border-palm-300 bg-palm-50 dark:border-palm-500 dark:bg-palm-500/10'
          : 'border-transparent hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-200 dark:hover:bg-husk-100/60'
      }`}
    >
      <button
        type="button"
        onClick={onLoad}
        disabled={disabled}
        aria-label={`Load run from ${formatRelativeTime(createdAt)}: ${summaryLabel}`}
        aria-current={isCurrent ? 'true' : undefined}
        className="flex w-full items-baseline justify-between gap-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="tabular-nums text-coconut-500 dark:text-sand-300">
          {formatRelativeTime(createdAt)}
        </span>
        <span className="truncate font-mono text-[11px] text-coconut-700 dark:text-sand-200">
          {summaryLabel}
        </span>
      </button>
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
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReexport}
          disabled={isExporting}
          aria-label={`Re-export run ${run.id} as xlsx`}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-coconut-400 dark:text-sand-400 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-600 dark:hover:text-sand-200 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          <Download size={10} aria-hidden />
          {isExporting ? 'Re-exporting…' : 'Re-export'}
        </button>
      </div>
    </li>
  )
}

