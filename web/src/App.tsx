/**
 * App — main layout for mgz-pkmn web frontend.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  Header (logo · settings · export)│
 *   ├──────────────────────────────────┤
 *   │  InputEditor (card list textarea) │
 *   ├──────────────────────────────────┤
 *   │  ResultsTable (streaming rows)    │
 *   └──────────────────────────────────┘
 */

import { useCallback, useRef, useState } from 'react'
import { bulkLookup, lookupLine } from './api/client'
import { InputEditor } from './components/InputEditor'
import { ResultsTable } from './components/ResultsTable'
import { ExportBar } from './components/ExportBar'
import { ProcessingQueue } from './components/ProcessingQueue'
import { SettingsDrawer } from './components/SettingsDrawer'
import { HelpModal } from './components/HelpModal'
import { Tour } from './components/Tour'
import { useAppStore } from './store'
import type { BulkEvent } from './types'
import logoUrl from './assets/logo.svg'

function App() {
  const {
    inputText,
    appendRow,
    clearRows,
    settings,
    isRunning,
    setIsRunning,
    setProgress,
    setProcessingLines,
    markLineStatus,
  } = useAppStore()

  const abortRef = useRef<AbortController | null>(null)
  const [tourOpen, setTourOpen] = useState(false)

  // Easter egg: 5 clicks on the brand reveals Exeggutor + claim code
  // EGG-EXEGGCUTE (referencing the six-egg pre-evolution). Reset on
  // dismiss. Wall of Eggs lives somewhere in the repo — finders find
  // it. Click count is a ref (not state) since we don't need a
  // re-render on each click — only on the 5th.
  const eggClicksRef = useRef(0)
  const [showEgg, setShowEgg] = useState(false)
  const handleBrandClick = useCallback(() => {
    eggClicksRef.current += 1
    if (eggClicksRef.current >= 5) {
      eggClicksRef.current = 0
      setShowEgg(true)
    }
  }, [])

  const handleRun = useCallback(async (overrideText?: string) => {
    if (isRunning) return
    const text = overrideText ?? inputText
    const lines = text.split('\n')
    const nonEmpty = lines.filter((l) => l.trim() && !l.trim().startsWith('#'))
    if (nonEmpty.length === 0) return

    clearRows()
    setProcessingLines(nonEmpty.map((line) => ({ line, status: 'pending' })))
    setIsRunning(true)
    setProgress({ done: 0, total: nonEmpty.length })

    abortRef.current = new AbortController()

    // Track unique card IDs for client-side deduplication.
    const seenIds = new Set<string>()

    function onEvent(event: BulkEvent) {
      if (event.done) return

      // First event for this input line transitions it out of "pending".
      // Subsequent events (top:N expansions) leave the status alone.
      markLineStatus(event.index, event.matched ? 'resolved' : 'error')

      if (settings.dedupe && event.matched && event.card) {
        const cid = event.card.id as string | undefined
        if (cid) {
          if (seenIds.has(cid)) return
          seenIds.add(cid)
        }
      }

      appendRow({
        query: event.query,
        card: event.card,
        pricing: event.pricing,
        tag: event.tag,
        matched: event.matched,
        reason: event.reason,
      })

      setProgress({ done: event.index + 1, total: event.total })
    }

    function onDone() {
      setIsRunning(false)
    }

    try {
      await bulkLookup(nonEmpty, settings, onEvent, onDone, abortRef.current.signal)
    } catch {
      setIsRunning(false)
    }
  }, [
    inputText,
    settings,
    isRunning,
    clearRows,
    appendRow,
    setIsRunning,
    setProgress,
    setProcessingLines,
    markLineStatus,
  ])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
  }, [setIsRunning])

  // Re-run a single line (called after adding a PriceCharting URL override).
  const handleRerunLine = useCallback(
    async (line: string) => {
      const newRows = await lookupLine(line, settings)
      for (const row of newRows) {
        appendRow(row)
      }
    },
    [settings, appendRow],
  )

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={handleBrandClick}
            className="flex items-center gap-3 cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-zinc-700"
            aria-label="mgz-pkmn"
          >
            <img src={logoUrl} alt="mgz-pkmn" className="h-8 w-auto" />
            <span className="text-xs text-zinc-500 hidden sm:inline">card lookup</span>
          </button>
          <div className="flex items-center gap-2">
            <div data-tour="exports">
              <ExportBar />
            </div>
            <HelpModal onStartTour={() => setTourOpen(true)} />
            <div data-tour="settings">
              <SettingsDrawer />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <section data-tour="input">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Card list
          </h2>
          <InputEditor onRun={handleRun} onStop={handleStop} />
        </section>

        <section data-tour="results">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Results
          </h2>
          <div className="flex flex-col gap-3">
            <ProcessingQueue />
            <ResultsTable onRerunLine={handleRerunLine} />
          </div>
        </section>
      </main>

      {tourOpen && <Tour onClose={() => setTourOpen(false)} onRun={handleRun} />}

      {/* Easter egg overlay — see handleBrandClick. */}
      {showEgg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setShowEgg(false)}
          role="dialog"
          aria-label="easter egg"
        >
          <div
            className="max-w-md rounded-lg border border-green-700 bg-zinc-900 p-8 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 text-6xl" role="img" aria-label="palm tree">
              🌴
            </div>
            <h2 className="mb-2 text-xl font-bold text-green-400">
              You found Exeggutor!
            </h2>
            <p className="mb-4 text-sm text-zinc-400">
              The maintainer&apos;s all-time favorite Pokemon, here since v.0.1!
            </p>
            <p className="mb-4 text-sm text-zinc-300">
              Claim code:{' '}
              <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-yellow-300">
                EGG-EXEGGCUTE
              </code>
            </p>
            <p className="mb-6 text-xs text-zinc-500">
              The Wall of Eggs is hidden somewhere in the repo. Find it
              to claim what you&apos;ve collected.
            </p>
            <div className="flex items-center justify-center gap-2">
              <a
                href="https://github.com/mgzwarrior/mgz-pkmn"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-green-700 bg-green-900/30 px-4 py-1.5 text-sm text-green-300 hover:bg-green-900/50"
              >
                View the repo →
              </a>
              <button
                type="button"
                onClick={() => setShowEgg(false)}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-zinc-800 py-4 text-center text-xs text-zinc-700">
        mgz-pkmn · a personal card-show prep tool ·{' '}
        <a
          href="https://github.com/mgzwarrior/mgz-pkmn"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-500"
        >
          GitHub
        </a>
      </footer>
    </div>
  )
}

export default App
