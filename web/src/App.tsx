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

import { useCallback, useRef } from 'react'
import { bulkLookup, lookupLine } from './api/client'
import { InputEditor } from './components/InputEditor'
import { ResultsTable } from './components/ResultsTable'
import { ExportBar } from './components/ExportBar'
import { SettingsDrawer } from './components/SettingsDrawer'
import { useAppStore } from './store'
import type { BulkEvent } from './types'

function App() {
  const {
    inputText,
    appendRow,
    clearRows,
    settings,
    isRunning,
    setIsRunning,
    setProgress,
  } = useAppStore()

  const abortRef = useRef<AbortController | null>(null)

  const handleRun = useCallback(async () => {
    if (isRunning) return
    const lines = inputText.split('\n')
    const nonEmpty = lines.filter((l) => l.trim() && !l.trim().startsWith('#'))
    if (nonEmpty.length === 0) return

    clearRows()
    setIsRunning(true)
    setProgress({ done: 0, total: nonEmpty.length })

    abortRef.current = new AbortController()

    // Track unique card IDs for client-side deduplication.
    const seenIds = new Set<string>()

    function onEvent(event: BulkEvent) {
      if (event.done) return

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
  }, [inputText, settings, isRunning, clearRows, appendRow, setIsRunning, setProgress])

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
          <div className="flex items-center gap-2">
            <span className="text-xl" role="img" aria-label="pokéball">🃏</span>
            <span className="font-bold text-zinc-100">mgz-pkmn</span>
            <span className="text-xs text-zinc-500 hidden sm:inline">card lookup</span>
          </div>
          <div className="flex items-center gap-2">
            <ExportBar />
            <SettingsDrawer />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Card list
          </h2>
          <InputEditor onRun={handleRun} onStop={handleStop} />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Results
          </h2>
          <ResultsTable onRerunLine={handleRerunLine} />
        </section>
      </main>

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
