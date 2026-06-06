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
import { Bookmark, Heart, Library, Search } from 'lucide-react'
import { bulkLookup, lookupLine } from './api/client'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { BrowsePanel } from './components/BrowsePanel'
import { SwipePanel } from './components/SwipePanel'
import { CollectionsModal } from './components/CollectionsModal'
import { WishlistsModal } from './components/WishlistsModal'
import { useBrowseController } from './components/useBrowseController'
import { InputEditor } from './components/InputEditor'
import { RecentRuns } from './components/RecentRuns'
import { ResultsTable } from './components/ResultsTable'
import { ExportBar } from './components/ExportBar'
import { ProcessingQueue } from './components/ProcessingQueue'
import { SettingsDrawer } from './components/SettingsDrawer'
import { HelpModal } from './components/HelpModal'
import { WhatsNewModal } from './components/WhatsNewModal'
import { SignInChip } from './components/SignInChip'
import { ThemeToggle } from './components/ThemeToggle'
import { Tour } from './components/Tour'
import { useAppStore } from './store'
import type { BulkEvent } from './types'
import logoLightUrl from '../../assets/logo.svg'
import logoDarkUrl from '../../assets/logo-dark.svg'

type DiscoveryMode = 'search' | 'browse' | 'swipe'

const MODES: { value: DiscoveryMode; label: string; icon: typeof Search; hint: string }[] = [
  { value: 'search', label: 'Search', icon: Search, hint: 'Paste a want-list' },
  { value: 'browse', label: 'Browse', icon: Library, hint: 'Walk a set' },
  { value: 'swipe', label: 'Swipe', icon: Heart, hint: 'Card-at-a-time' },
]

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
    updateLineStage,
    setRunStartedAt,
    setRunEndedAt,
    pushRecentRun,
  } = useAppStore()

  const abortRef = useRef<AbortController | null>(null)
  const [tourOpen, setTourOpen] = useState(false)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [wishlistsOpen, setWishlistsOpen] = useState(false)
  const [mode, setMode] = useState<DiscoveryMode>('search')
  // `active` flips when the user switches into browse mode so the
  // controller's reset effect fires.
  const browseController = useBrowseController(mode === 'browse')

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
    // Reset run timestamps. `runStartedAt` is set when the first SSE
    // event arrives so the elapsed value reflects user-felt latency.
    setRunStartedAt(null)
    setRunEndedAt(null)
    // Record the submission in the recent-searches history. We do
    // this at click time (not on completion) so a run the user stops
    // or that errors still leaves a re-runnable entry behind.
    pushRecentRun(nonEmpty)

    abortRef.current = new AbortController()

    // Track unique card IDs for client-side deduplication.
    const seenIds = new Set<string>()
    let firstEventSeen = false

    function onEvent(event: BulkEvent) {
      if ('done' in event && event.done) return
      if (!firstEventSeen) {
        firstEventSeen = true
        setRunStartedAt(Date.now())
      }

      // Record the latest stage for the line either way — both progress
      // frames and the terminal row frame carry one.
      updateLineStage(event.index, event.stage)

      // Progress-only frame (no row payload): the line advanced a stage but
      // hasn't resolved yet, so don't append a result or flip its status.
      if (!('matched' in event)) return

      // First row event for this input line transitions it out of "pending".
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

    // `bulkLookup` calls `onDone` on every normal exit path (non-OK
    // response, stream completion, abort). The only way it can throw
    // without calling `onDone` is if the initial `fetch` itself
    // rejects — a true network error. Guard both endpoints against
    // double-stamping by only stamping if the run hasn't already
    // ended; that way Stop, completion, and network-error paths each
    // land exactly one `runEndedAt` write.
    function stampEndIfMissing() {
      if (useAppStore.getState().runEndedAt != null) return
      setIsRunning(false)
      setRunEndedAt(Date.now())
    }

    try {
      await bulkLookup(nonEmpty, settings, onEvent, stampEndIfMissing, abortRef.current.signal)
    } catch {
      stampEndIfMissing()
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
    updateLineStage,
    setRunStartedAt,
    setRunEndedAt,
    pushRecentRun,
  ])

  const handleStop = useCallback(() => {
    // Just abort the stream. `bulkLookup`'s abort path will fire
    // `onDone(aborted=true)` which the handleRun-side guard stamps
    // exactly once. No need to stamp here ourselves — doing so used
    // to overwrite the actual stream-end timestamp.
    abortRef.current?.abort()
  }, [])

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
    <div className="min-h-screen bg-sand-50 text-coconut-700 dark:bg-husk-400 dark:text-sand-50">
      <AnnouncementBanner />
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-sand-300 bg-sand-50/80 dark:border-husk-200/80 dark:bg-husk-400/80 backdrop-blur">
        <h1 className="sr-only">mgz-pkmn — Pokemon card lookup</h1>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={handleBrandClick}
            className="flex items-center gap-3 cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-palm-400 dark:focus:ring-sun-300"
            aria-label="mgz-pkmn"
          >
            <img src={logoLightUrl} alt="mgz-pkmn" className="h-8 w-auto dark:hidden" />
            <img src={logoDarkUrl} alt="" aria-hidden="true" className="hidden h-8 w-auto dark:block" />
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCollectionsOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-sand-300 bg-sand-100 px-2.5 py-1.5 text-sm text-coconut-700 hover:bg-sand-200 hover:border-sand-400 dark:border-husk-50 dark:bg-husk-200 dark:text-sand-50 dark:hover:bg-husk-100 dark:hover:border-coconut-400 transition-colors sm:px-3"
              title="Collections"
              aria-label="Collections"
            >
              <Bookmark size={15} />
              <span className="hidden sm:inline">Collections</span>
            </button>
            <button
              type="button"
              onClick={() => setWishlistsOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-sand-300 bg-sand-100 px-2.5 py-1.5 text-sm text-coconut-700 hover:bg-sand-200 hover:border-sand-400 dark:border-husk-50 dark:bg-husk-200 dark:text-sand-50 dark:hover:bg-husk-100 dark:hover:border-coconut-400 transition-colors sm:px-3"
              title="Wishlists"
              aria-label="Wishlists"
            >
              <Heart size={15} />
              <span className="hidden sm:inline">Wishlists</span>
            </button>
            <div data-tour="exports">
              <ExportBar />
            </div>
            <WhatsNewModal />
            <HelpModal onStartTour={() => setTourOpen(true)} />
            <div data-tour="settings">
              <SettingsDrawer />
            </div>
            <ThemeToggle />
            <SignInChip />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <nav
          role="tablist"
          aria-label="Discovery mode"
          data-tour="discovery-modes"
          className="flex w-full flex-wrap items-center gap-1 rounded-lg border border-sand-300 bg-sand-100 p-1 dark:border-husk-50 dark:bg-husk-200"
        >
          {MODES.map((m) => {
            const Icon = m.icon
            const active = mode === m.value
            return (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m.value)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1 text-sm transition-colors min-w-[120px] ${
                  active
                    ? 'bg-sand-50 text-coconut-700 shadow-sm dark:bg-husk-400 dark:text-sand-50'
                    : 'text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100'
                }`}
              >
                <Icon size={15} aria-hidden />
                <span className="font-medium">{m.label}</span>
                <span className="hidden text-xs text-coconut-400 dark:text-sand-400 sm:inline">
                  · {m.hint}
                </span>
              </button>
            )
          })}
        </nav>

        {mode === 'search' && (
          <>
            <section data-tour="input">
              <InputEditor onRun={handleRun} onStop={handleStop} />
              <div className="mt-3">
                <RecentRuns onRun={handleRun} />
              </div>
            </section>

            <section data-tour="results">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
                Results
              </h2>
              <div className="flex flex-col gap-3">
                <ProcessingQueue />
                <ResultsTable onRerunLine={handleRerunLine} />
              </div>
            </section>
          </>
        )}

        {mode === 'browse' && (
          <section aria-label="Browse cards by set">
            <BrowsePanel controller={browseController} />
          </section>
        )}

        {mode === 'swipe' && (
          <section aria-label="Swipe cards">
            <SwipePanel active={mode === 'swipe'} />
          </section>
        )}
      </main>

      {tourOpen && (
        <Tour onClose={() => setTourOpen(false)} onRun={handleRun} onStop={handleStop} />
      )}

      <CollectionsModal open={collectionsOpen} onOpenChange={setCollectionsOpen} />

      <WishlistsModal open={wishlistsOpen} onOpenChange={setWishlistsOpen} />

      {/* Easter egg overlay — see handleBrandClick. */}
      {showEgg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-coconut-700/60 dark:bg-husk-500/80 backdrop-blur-sm"
          onClick={() => setShowEgg(false)}
          role="dialog"
          aria-label="easter egg"
        >
          <div
            className="max-w-md rounded-lg border border-palm-300 bg-sand-50 dark:border-palm-500 dark:bg-husk-200 p-8 text-center shadow-2xl shadow-coconut-700/30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 text-6xl" role="img" aria-label="palm tree">
              🌴
            </div>
            <h2 className="mb-2 text-xl font-bold text-palm-500 dark:text-palm-200">
              You found Exeggutor!
            </h2>
            <p className="mb-4 text-sm text-coconut-500 dark:text-sand-300">
              The maintainer&apos;s all-time favorite Pokemon, here since v.0.1!
            </p>
            <p className="mb-4 text-sm text-coconut-700 dark:text-sand-200">
              Claim code:{' '}
              <code className="rounded bg-sand-200 px-2 py-1 font-mono text-coconut-700 dark:bg-husk-100 dark:text-sun-300">
                EGG-EXEGGCUTE
              </code>
            </p>
            <p className="mb-6 text-xs text-sand-500 dark:text-sand-400">
              The Wall of Eggs is hidden somewhere in the repo. Find it
              to claim what you&apos;ve collected.
            </p>
            <div className="flex items-center justify-center gap-2">
              <a
                href="https://github.com/mgzwarrior/mgz-pkmn"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-palm-300 bg-palm-50 px-4 py-1.5 text-sm text-palm-600 hover:bg-palm-100 dark:border-palm-500 dark:bg-palm-500/15 dark:text-palm-200 dark:hover:bg-palm-500/25 transition-colors"
              >
                View the repo →
              </a>
              <button
                type="button"
                onClick={() => setShowEgg(false)}
                className="rounded-md border border-sand-300 bg-sand-100 px-4 py-1.5 text-sm text-coconut-700 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:hover:bg-husk-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-sand-300 dark:border-husk-200 py-4 text-center text-xs text-coconut-400 dark:text-sand-400">
        mgz-pkmn · a personal card-show prep tool ·{' '}
        <a
          href="https://github.com/mgzwarrior/mgz-pkmn"
          target="_blank"
          rel="noopener noreferrer"
          className="text-palm-500 hover:text-palm-400 dark:text-sun-300 dark:hover:text-sun-200 transition-colors"
        >
          GitHub
        </a>{' '}
        ·{' '}
        <a
          href="https://www.buymeacoffee.com/mgz.pkmn"
          target="_blank"
          rel="noopener noreferrer"
          className="text-palm-500 hover:text-palm-400 dark:text-sun-300 dark:hover:text-sun-200 transition-colors"
        >
          Buy me a pizza
        </a>
      </footer>
    </div>
  )
}

export default App
