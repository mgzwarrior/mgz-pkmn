/**
 * ProcessingQueue — per-line status panel shown while a bulk lookup is
 * in flight. Each input line transitions pending → resolved / error as
 * its first SSE event arrives. The panel unmounts as soon as the run
 * finishes (whether by completion, Stop, or error) so abandoned
 * pending entries don't spin indefinitely.
 */
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import type { ProcessingLine } from '../types'

export function ProcessingQueue() {
  const { processingLines, isRunning, runStartedAt, settings } = useAppStore()

  if (processingLines.length === 0) return null
  // Hide as soon as the run finishes — covers both the success case
  // (where every line is already resolved/error) and the abort/error
  // case (where some lines would otherwise stay pending forever).
  if (!isRunning) return null

  const done = processingLines.filter((l) => l.status !== 'pending').length
  const total = processingLines.length

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">
          Looking up cards…
        </span>
        <span className="text-xs tabular-nums text-zinc-400">
          {done} of {total} done
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3">
        {processingLines.map((pl, i) => (
          <LineStatus
            key={`${i}:${pl.line}`}
            line={pl}
            runStartedAt={runStartedAt}
            showTimer={settings.showTimer}
          />
        ))}
      </ul>
    </div>
  )
}

function LineStatus({
  line,
  runStartedAt,
  showTimer,
}: {
  line: ProcessingLine
  runStartedAt: number | null
  showTimer: boolean
}) {
  const icon =
    line.status === 'pending' ? (
      <Loader2 size={12} className="flex-shrink-0 animate-spin text-blue-400" />
    ) : line.status === 'resolved' ? (
      <CheckCircle2 size={12} className="flex-shrink-0 text-green-400" />
    ) : (
      <AlertTriangle size={12} className="flex-shrink-0 text-amber-400" />
    )

  // Per-line elapsed badge: wall-clock from the run start to the moment
  // this line transitioned out of pending. Gated by the same setting as
  // the global timer so the queue isn't noisy by default.
  const elapsedMs =
    showTimer && line.endedAt != null && runStartedAt != null
      ? Math.max(0, line.endedAt - runStartedAt)
      : null

  return (
    <li className="flex items-center gap-1.5 text-xs text-zinc-400">
      {icon}
      <span className="truncate">{line.line}</span>
      {elapsedMs != null && (
        <span
          className="ml-auto flex-shrink-0 rounded bg-zinc-800 px-1 py-0.5 font-mono text-[10px] tabular-nums text-zinc-400"
          aria-label={`Finished in ${elapsedMs} milliseconds`}
        >
          {elapsedMs}ms
        </span>
      )}
    </li>
  )
}
