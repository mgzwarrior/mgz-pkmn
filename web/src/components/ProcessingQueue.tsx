/**
 * ProcessingQueue — per-line status panel shown while a bulk lookup is
 * in flight. Each input line transitions pending → resolved / error as
 * its first SSE event arrives. Resolved lines fade out after a short
 * delay so the user can see the green check before the row settles.
 */
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import type { ProcessingLine } from '../types'

export function ProcessingQueue() {
  const { processingLines, isRunning } = useAppStore()

  if (processingLines.length === 0) return null

  const done = processingLines.filter((l) => l.status !== 'pending').length
  const total = processingLines.length
  // Hide once everything has resolved and the run has finished.
  if (!isRunning && done === total) return null

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">
          Looking up cards…
        </span>
        <span className="text-xs tabular-nums text-zinc-500">
          {done} of {total} done
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3">
        {processingLines.map((pl, i) => (
          <LineStatus key={`${i}:${pl.line}`} line={pl} />
        ))}
      </ul>
    </div>
  )
}

function LineStatus({ line }: { line: ProcessingLine }) {
  const icon =
    line.status === 'pending' ? (
      <Loader2 size={12} className="flex-shrink-0 animate-spin text-blue-400" />
    ) : line.status === 'resolved' ? (
      <CheckCircle2 size={12} className="flex-shrink-0 text-green-400" />
    ) : (
      <AlertTriangle size={12} className="flex-shrink-0 text-amber-400" />
    )
  return (
    <li className="flex items-center gap-1.5 text-xs text-zinc-400">
      {icon}
      <span className="truncate">{line.line}</span>
    </li>
  )
}
