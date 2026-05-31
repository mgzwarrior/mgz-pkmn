/**
 * ProcessingQueue — per-line status panel shown while a bulk lookup is
 * in flight. Each input line moves through the lookup pipeline one stage
 * at a time (parsed → looking up → fallback / URL hint → pricing →
 * resolved / no match / error), driven by the `stage` field on the SSE
 * stream. The chip's color and label reflect the latest stage; a hover
 * tooltip reports how long the line has spent in it. The panel unmounts
 * as soon as the run finishes (whether by completion, Stop, or error) so
 * abandoned pending entries don't spin indefinitely.
 */
import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ChevronDown,
} from 'lucide-react'
import { useAppStore } from '../store'
import type { ProcessingLine, Stage } from '../types'

/**
 * Per-stage presentation. Colors are paired light/dark variants from
 * the tropical palette — `coconut`/`sand` for muted, `sky` for the
 * initial lookup, `palm` for pricing/resolved, `sun` for the warn
 * terminal, `ember` for error. All combinations clear WCAG 2.1 AA
 * contrast (≥ 4.5:1) against both surfaces (`bg-sand-50` light,
 * `bg-husk-400` dark) — see docs/accessibility.md.
 * `terminal` marks the three end states (which get a static icon);
 * the rest are in-flight and spin.
 */
const STAGE_CONFIG: Record<Stage, { label: string; color: string; terminal: boolean }> = {
  parsed: { label: 'Parsed', color: 'text-coconut-400 dark:text-sand-300', terminal: false },
  looking_up: { label: 'Looking up', color: 'text-sky-500 dark:text-sky-300', terminal: false },
  fallback: { label: 'Fallback', color: 'text-coconut-600 dark:text-coconut-200', terminal: false },
  url_hint: { label: 'URL hint', color: 'text-sky-400 dark:text-sky-400', terminal: false },
  pricing: { label: 'Pricing', color: 'text-palm-500 dark:text-palm-300', terminal: false },
  image: { label: 'Image', color: 'text-palm-400 dark:text-palm-100', terminal: false },
  resolved: { label: 'Resolved', color: 'text-palm-600 dark:text-palm-200', terminal: true },
  no_match: { label: 'No match', color: 'text-sun-600 dark:text-sun-300', terminal: true },
  error: { label: 'Error', color: 'text-ember-500 dark:text-ember-300', terminal: true },
}

/** Display order for the legend — pipeline order, terminal states last. */
const STAGE_ORDER: Stage[] = [
  'parsed',
  'looking_up',
  'fallback',
  'url_hint',
  'pricing',
  'image',
  'resolved',
  'no_match',
  'error',
]

/**
 * A wall-clock value that advances ~4×/sec, so the per-stage elapsed time
 * in chip tooltips keeps ticking for lines still in flight. Reading
 * `Date.now()` straight in render is impure (and flagged by lint); this
 * keeps the time in state and updates it on an interval instead.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [active])
  return now
}

export function ProcessingQueue() {
  const { processingLines, isRunning, runStartedAt, settings } = useAppStore()
  const [legendOpen, setLegendOpen] = useState(false)
  const now = useNow(isRunning)

  if (processingLines.length === 0) return null
  // Hide as soon as the run finishes — covers both the success case
  // (where every line is already resolved/error) and the abort/error
  // case (where some lines would otherwise stay pending forever).
  if (!isRunning) return null

  const done = processingLines.filter((l) => l.status !== 'pending').length
  const total = processingLines.length

  return (
    <div className="rounded-md border border-sand-300 bg-sand-100 dark:border-husk-50 dark:bg-husk-200/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-coconut-500 dark:text-sand-300">Looking up cards…</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            className="flex items-center gap-1 rounded text-xs text-coconut-400 hover:text-coconut-700 dark:text-sand-300 dark:hover:text-sand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-palm-400 dark:focus-visible:ring-sun-300"
          >
            Legend
            <ChevronDown
              size={12}
              className={`transition-transform ${legendOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <span className="text-xs tabular-nums text-coconut-400 dark:text-sand-300">
            {done} of {total} done
          </span>
        </div>
      </div>
      {legendOpen && <StageLegend />}
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3">
        {processingLines.map((pl, i) => (
          <LineStatus
            key={`${i}:${pl.line}`}
            line={pl}
            runStartedAt={runStartedAt}
            showTimer={settings.showTimer}
            now={now}
          />
        ))}
      </ul>
    </div>
  )
}

/** Color key explaining what each chip color means. Collapsed by default. */
function StageLegend() {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 rounded bg-sand-50 dark:bg-husk-300/80 px-2 py-1.5">
      {STAGE_ORDER.map((stage) => {
        const cfg = STAGE_CONFIG[stage]
        return (
          <li key={stage} className="flex items-center gap-1 text-[10px]">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full bg-current ${cfg.color}`}
            />
            <span className="text-coconut-500 dark:text-sand-300">{cfg.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

function stageIcon(line: ProcessingLine) {
  // Before the first stage frame arrives, fall back to the generic
  // in-flight spinner (matches the historical pending appearance).
  if (!line.stage) {
    return <Loader2 size={12} className="flex-shrink-0 animate-spin text-sky-500 dark:text-sky-300" />
  }
  const cfg = STAGE_CONFIG[line.stage]
  if (!cfg.terminal) {
    return <Loader2 size={12} className={`flex-shrink-0 animate-spin ${cfg.color}`} />
  }
  if (line.stage === 'resolved') {
    return <CheckCircle2 size={12} className={`flex-shrink-0 ${cfg.color}`} />
  }
  if (line.stage === 'no_match') {
    return <AlertTriangle size={12} className={`flex-shrink-0 ${cfg.color}`} />
  }
  return <XCircle size={12} className={`flex-shrink-0 ${cfg.color}`} />
}

function LineStatus({
  line,
  runStartedAt,
  showTimer,
  now,
}: {
  line: ProcessingLine
  runStartedAt: number | null
  showTimer: boolean
  now: number
}) {
  const cfg = line.stage ? STAGE_CONFIG[line.stage] : null

  // Per-line elapsed badge: wall-clock from the run start to the moment
  // this line transitioned out of pending. Gated by the same setting as
  // the global timer so the queue isn't noisy by default.
  const elapsedMs =
    showTimer && line.endedAt != null && runStartedAt != null
      ? Math.max(0, line.endedAt - runStartedAt)
      : null

  // Time spent in the current stage, for the hover tooltip. Uses the
  // line's end time once it's resolved, else the ticking wall clock.
  const inStageMs =
    line.stageStartedAt != null
      ? Math.max(0, (line.endedAt ?? now) - line.stageStartedAt)
      : null
  const tooltip =
    cfg != null
      ? inStageMs != null
        ? `${cfg.label} · ${inStageMs}ms`
        : cfg.label
      : undefined

  return (
    <li
      className="flex items-center gap-1.5 text-xs text-coconut-500 dark:text-sand-300"
      title={tooltip}
      aria-label={tooltip ? `${line.line} — ${tooltip}` : undefined}
    >
      {stageIcon(line)}
      <span className="truncate">{line.line}</span>
      {cfg && (
        <span className={`ml-auto flex-shrink-0 text-[10px] ${cfg.color}`}>{cfg.label}</span>
      )}
      {elapsedMs != null && (
        <span
          className="flex-shrink-0 rounded bg-sand-200 dark:bg-husk-100 px-1 py-0.5 font-mono text-[10px] tabular-nums text-coconut-500 dark:text-sand-300"
          aria-label={`Finished in ${elapsedMs} milliseconds`}
        >
          {elapsedMs}ms
        </span>
      )}
    </li>
  )
}
