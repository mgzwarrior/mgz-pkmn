/**
 * LookupTimer — wall-clock elapsed display for a bulk lookup run.
 *
 * While a run is in flight, ticks every 100ms from `runStartedAt`. After
 * the run finishes, the final elapsed value stays visible with a
 * `total · count · ms/card` breakdown so the user has a stable number
 * to report. Gated by the `showTimer` setting; renders nothing when
 * off, or when no run has started in this session.
 *
 * Timing is wall-clock from the first SSE event to the done event,
 * measured frontend-side so it includes network + SSE overhead — i.e.
 * the latency a real user feels.
 */
import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { useAppStore } from '../store'
import { formatElapsed } from '../utils/format'

export function LookupTimer() {
  const { settings, isRunning, runStartedAt, runEndedAt, rows } = useAppStore()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // Gate the interval on `showTimer` so a run with the toggle off
    // doesn't schedule a 10 Hz re-render against a component that
    // would render `null` anyway.
    if (!settings.showTimer || !isRunning || runStartedAt == null) return
    // 100ms cadence keeps the clock smooth without burning CPU.
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [settings.showTimer, isRunning, runStartedAt])

  if (!settings.showTimer) return null
  if (runStartedAt == null) return null

  const endTs = isRunning ? now : (runEndedAt ?? now)
  const elapsedMs = Math.max(0, endTs - runStartedAt)

  if (isRunning) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Lookup timer"
        className="flex items-center gap-1.5 text-xs tabular-nums text-coconut-400 dark:text-sand-300"
      >
        <Timer size={12} className="text-palm-500 dark:text-sun-300" />
        <span>{formatElapsed(elapsedMs)}</span>
      </div>
    )
  }

  // Final summary. Use the matched row count for the per-card average —
  // a `top:N` line expands into many rows, so total/lines under-counts
  // the actual work the user is waiting on.
  const count = rows.length
  if (count === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs tabular-nums text-coconut-400 dark:text-sand-300">
        <Timer size={12} />
        <span>{formatElapsed(elapsedMs)}</span>
      </div>
    )
  }
  const perCard = Math.round(elapsedMs / count)
  const cardWord = count === 1 ? 'card' : 'cards'
  return (
    <div className="flex items-center gap-1.5 text-xs tabular-nums text-coconut-400 dark:text-sand-300">
      <Timer size={12} />
      <span>
        {formatElapsed(elapsedMs)} · {count} {cardWord} · {perCard} ms/card
      </span>
    </div>
  )
}
