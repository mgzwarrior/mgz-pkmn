/**
 * RecentRuns — a collapsible panel under the input editor showing the
 * last N (default 10) bulk-lookup submissions. Entries are clickable:
 * one click restores the list into the editor and triggers a lookup
 * via the parent's `onRun` callback. A small × on hover deletes a
 * single entry; **Clear all** in the header wipes the whole list.
 *
 * The panel renders nothing when there are no entries — the
 * empty-state example chips already cover the "what do I do?"
 * moment, and an empty Recent panel would just be noise.
 */
import { useState } from 'react'
import { History, X, ChevronDown, ChevronUp } from 'lucide-react'
import { useAppStore } from '../store'
import { formatRelativeTime } from '../utils/format'
import type { RecentRun } from '../types'

interface Props {
  onRun: (overrideText: string) => void
}

/** How many of an entry's lines we show inline before the `+N more` tail. */
const PREVIEW_LIMIT = 2

export function RecentRuns({ onRun }: Props) {
  const { recentRuns, removeRecentRun, clearRecentRuns, isRunning, setInputText } = useAppStore()
  const [collapsed, setCollapsed] = useState(false)

  if (recentRuns.length === 0) return null

  const handleRerun = (run: RecentRun) => {
    if (isRunning) return
    const text = run.lines.join('\n')
    setInputText(text)
    onRun(text)
  }

  return (
    <section
      aria-label="Recent searches"
      className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2"
    >
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 rounded text-xs font-medium text-zinc-400 hover:text-zinc-200"
        >
          <History size={12} />
          Recent searches
          <span className="text-zinc-500">({recentRuns.length})</span>
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={clearRecentRuns}
            className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Clear all
          </button>
        )}
      </header>
      {!collapsed && (
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
      )}
    </section>
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
    <li className="group flex items-center gap-2 rounded border border-transparent hover:border-zinc-700 hover:bg-zinc-800/60 transition-colors">
      <button
        type="button"
        onClick={onRerun}
        disabled={disabled}
        aria-label={`Rerun search from ${formatRelativeTime(run.savedAt)}: ${summary}`}
        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex-shrink-0 tabular-nums text-zinc-500">
          {formatRelativeTime(run.savedAt)}
        </span>
        <span className="flex-shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-400">
          {run.lines.length} {lineWord}
        </span>
        <span className="truncate font-mono text-zinc-300">{summary}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete recent search: ${summary}`}
        className="flex-shrink-0 rounded p-1 text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-200 hover:bg-zinc-700 transition-opacity"
      >
        <X size={12} />
      </button>
    </li>
  )
}
