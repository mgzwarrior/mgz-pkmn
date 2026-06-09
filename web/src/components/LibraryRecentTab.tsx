/**
 * LibraryRecentTab — list of the last N (10) bulk-lookup *submissions*
 * for the Recent tab inside [LibraryPanel](./LibraryPanel.tsx). One tap
 * restores the input lines and triggers a fresh lookup via the parent's
 * `onRun` callback.
 *
 * Distinct from [LibrarySearchesTab](./LibrarySearchesTab.tsx) which
 * lists explicitly *saved* (named) runs persisted server-side.
 */
import { X } from 'lucide-react'
import { useAppStore } from '../store'
import { formatRelativeTime } from '../utils/format'
import type { RecentRun } from '../types'

interface Props {
  onRun: (overrideText: string) => void
}

const PREVIEW_LIMIT = 2

export function LibraryRecentTab({ onRun }: Props) {
  const { recentRuns, removeRecentRun, clearRecentRuns, isRunning, setInputText } = useAppStore()

  if (recentRuns.length === 0) {
    return (
      <p className="text-xs text-coconut-500 dark:text-sand-300">
        Your recent searches will land here once you run a lookup.
      </p>
    )
  }

  const handleRerun = (run: RecentRun) => {
    if (isRunning) return
    const text = run.lines.join('\n')
    setInputText(text)
    onRun(text)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-coconut-400 dark:text-sand-400">
          {recentRuns.length} {recentRuns.length === 1 ? 'entry' : 'entries'}
        </span>
        <button
          type="button"
          onClick={clearRecentRuns}
          className="rounded px-1.5 py-0.5 text-xs text-coconut-400 dark:text-sand-400 hover:text-coconut-600 dark:hover:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
        >
          Clear all
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {recentRuns.map((run) => (
          <RecentRunRow
            key={run.id}
            run={run}
            disabled={isRunning}
            onRerun={() => handleRerun(run)}
            onDelete={() => removeRecentRun(run.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function RecentRunRow({
  run,
  disabled,
  onRerun,
  onDelete,
}: {
  run: RecentRun
  disabled: boolean
  onRerun: () => void
  onDelete: () => void
}) {
  const preview = run.lines.slice(0, PREVIEW_LIMIT).join(', ')
  const extra = run.lines.length - PREVIEW_LIMIT
  const summary = extra > 0 ? `${preview}, +${extra} more` : preview
  const lineWord = run.lines.length === 1 ? 'line' : 'lines'

  return (
    <li className="group flex items-center gap-2 rounded border border-transparent hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-200 dark:hover:bg-husk-100/60 transition-colors">
      <button
        type="button"
        onClick={onRerun}
        disabled={disabled}
        aria-label={`Rerun search from ${formatRelativeTime(run.savedAt)}: ${summary}`}
        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex-shrink-0 tabular-nums text-coconut-400 dark:text-sand-400">
          {formatRelativeTime(run.savedAt)}
        </span>
        <span className="flex-shrink-0 rounded bg-sand-200 dark:bg-husk-100 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-coconut-400 dark:text-sand-300">
          {run.lines.length} {lineWord}
        </span>
        <span className="truncate font-mono text-coconut-600 dark:text-sand-200">{summary}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete recent search: ${summary}`}
        className="flex-shrink-0 rounded p-1 text-coconut-400 dark:text-sand-400 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-coconut-600 dark:hover:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100 transition-opacity"
      >
        <X size={12} />
      </button>
    </li>
  )
}
