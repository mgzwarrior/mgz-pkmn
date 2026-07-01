/**
 * ResultsEmptyState — the results pane before any lookup has run (#523).
 *
 * The blank pane used to just say "run a lookup" — wasted space that
 * taught nothing. This fills it with a way forward: a taste of the search
 * grammar (a fuller list already lives in the editor's own empty state,
 * so this shows a handful rather than repeating all of it), a "Walk a
 * set" shortcut into Browse mode, and — signed in, with saved searches —
 * a few one-tap shortcuts back into recent work.
 */
import { useCallback, useState } from 'react'
import { GalleryHorizontalEnd } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import { loadSavedRun } from './loadSavedRun'
import type { RunSummary } from '../types'

const SAMPLE_QUERIES = ['All Charizard cards | Base Set', 'top:5 Charizard cards', 'Mew ex']

const SAVED_SEARCH_LIMIT = 3

interface Props {
  onRun?: (text: string) => void
  onBrowse?: () => void
}

export function ResultsEmptyState({ onRun, onBrowse }: Props) {
  const auth = useAuth()
  const runs = useAppStore((s) => s.runs)
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const savedSearches = auth.user !== null ? runs.slice(0, SAVED_SEARCH_LIMIT) : []
  // A saved-search load is a multi-step store hydration (input, rows, view
  // state, ...) — running an example query or switching to Browse mid-load
  // would race those writes, so the rest of the panel disables while one is
  // in flight.
  const loading = loadingRunId !== null

  const handleLoadSaved = useCallback(
    async (run: RunSummary) => {
      if (loading) return
      setLoadingRunId(run.id)
      setError(null)
      try {
        // Already in Search mode (this pane only renders there) — no mode
        // switch needed on load, unlike the Backpack's Searches tab.
        await loadSavedRun(run, () => {})
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to load run ${run.id}`)
      } finally {
        setLoadingRunId(null)
      }
    },
    [loading],
  )

  return (
    <div className="flex flex-col gap-4 rounded-md border border-sand-300 bg-sand-50 px-4 py-6 text-sm dark:border-husk-50 dark:bg-husk-200">
      <p className="text-center text-coconut-400 dark:text-sand-300">
        Results will appear here after you run a lookup.
      </p>

      {(onRun || onBrowse) && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
            Try a query
          </span>
          <div className="flex flex-wrap gap-1.5">
            {onRun &&
              SAMPLE_QUERIES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => onRun(example)}
                  disabled={loading}
                  className="rounded-full border border-sand-300 bg-sand-100 px-2.5 py-1 font-mono text-xs text-coconut-600 hover:border-palm-400 hover:bg-sand-200 hover:text-coconut-700 dark:border-husk-50 dark:bg-husk-300 dark:text-sand-200 dark:hover:border-sun-300 dark:hover:bg-husk-100 dark:hover:text-sand-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {example}
                </button>
              ))}
            {onBrowse && (
              <button
                type="button"
                onClick={onBrowse}
                disabled={loading}
                className="flex items-center gap-1 rounded-full border border-sand-300 bg-sand-100 px-2.5 py-1 text-xs text-coconut-600 hover:border-palm-400 hover:bg-sand-200 hover:text-coconut-700 dark:border-husk-50 dark:bg-husk-300 dark:text-sand-200 dark:hover:border-sun-300 dark:hover:bg-husk-100 dark:hover:text-sand-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <GalleryHorizontalEnd size={12} aria-hidden />
                Walk a set
              </button>
            )}
          </div>
        </div>
      )}

      {savedSearches.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
            Your saved searches
          </span>
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1">
            {savedSearches.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => handleLoadSaved(run)}
                disabled={loading}
                className="flex items-center justify-between gap-2 rounded-md border border-sand-300 bg-sand-100 px-2.5 py-1.5 text-left text-xs text-coconut-600 hover:border-palm-400 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-300 dark:text-sand-200 dark:hover:border-sun-300 dark:hover:bg-husk-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="truncate font-medium">{run.name ?? `Run ${run.id}`}</span>
                <span className="flex-shrink-0 text-coconut-400 dark:text-sand-400">
                  {run.row_count} row{run.row_count !== 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
