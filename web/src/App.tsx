/**
 * App — main layout for mgz-pkmn web frontend.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  Header (logo · settings)         │
 *   ├──────────────────────────────────┤
 *   │  InputEditor (card list textarea) │
 *   ├──────────────────────────────────┤
 *   │  Results (export · streaming rows)│
 *   └──────────────────────────────────┘
 *
 * Export lives in the Search-mode Results section — it only applies to
 * matched rows, so Browse and Swipe don't surface it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { GalleryHorizontalEnd, Layers, Search } from 'lucide-react'
import { bulkLookup, completeOnboarding, listRuns, lookupLine, saveRun } from './api/client'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { SaveSearchNameDialog } from './components/SaveSearchNameDialog'
import { BrowsePanel } from './components/BrowsePanel'
import { SwipePanel } from './components/SwipePanel'
import { useBrowseController } from './components/useBrowseController'
import { InputEditor } from './components/InputEditor'
import { LibraryPanel } from './components/LibraryPanel'
import { ResultsTable } from './components/ResultsTable'
import { consumePendingSaveSearch, type PendingSaveSearch } from './components/pendingSaveSearch'
import { ExportBar } from './components/ExportBar'
import { InsightsNavButton } from './components/InsightsNavButton'
import { ProcessingQueue } from './components/ProcessingQueue'
import { SettingsDrawer } from './components/SettingsDrawer'
import { FavoritePokemonOnboarding } from './components/FavoritePokemonOnboarding'
import { HelpModal } from './components/HelpModal'
import { SignInChip } from './components/SignInChip'
import { ThemeToggle } from './components/ThemeToggle'
import { Tour } from './components/Tour'
import { CollectionInsights } from './components/CollectionInsights'
import { MobileTabBar, type MobileTab } from './components/MobileTabBar'
import { MobileUtilitySheet, UtilityRow } from './components/MobileUtilitySheet'
import { useAuth } from './hooks/useAuth'
import { useAppStore } from './store'
import type { BulkEvent } from './types'
import logoLightUrl from '../../assets/logo.svg'
import logoDarkUrl from '../../assets/logo-dark.svg'

type DiscoveryMode = 'search' | 'browse' | 'swipe'

// Ordered newcomer-first to match the Help modal (#792, #814): Swipe is the
// lowest-friction way in, so it leads; text Search sits last. The Swipe icon
// is a card deck — the stack you flip through — not a heart (which already
// means the swipe-up "love" action).
const MODES: { value: DiscoveryMode; label: string; icon: typeof Search; hint: string }[] = [
  { value: 'swipe', label: 'Swipe', icon: Layers, hint: 'Card-at-a-time' },
  { value: 'browse', label: 'Browse', icon: GalleryHorizontalEnd, hint: 'Walk a set' },
  { value: 'search', label: 'Search', icon: Search, hint: 'Paste a wishlist' },
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
    setCurrentRunId,
    setCacheStatus,
    resetViewState,
    setRuns,
  } = useAppStore()

  const abortRef = useRef<AbortController | null>(null)
  const [tourOpen, setTourOpen] = useState(false)
  const [mode, setMode] = useState<DiscoveryMode>('swipe')
  // Mobile bottom-tab destination (#519). Desktop never renders the bar, so it
  // stays 'discover' there and the layout is unchanged. Insights opens over the
  // last surface tab (Discover/Backpack) and returns to it on close.
  const [mobileTab, setMobileTab] = useState<MobileTab>('discover')
  const lastSurfaceRef = useRef<MobileTab>('discover')
  const selectMobileTab = useCallback((tab: MobileTab) => {
    if (tab === 'discover' || tab === 'backpack') lastSurfaceRef.current = tab
    setMobileTab(tab)
  }, [])
  // The discovery mode the user was in when they opened the tour, restored when
  // it closes — the tour switches modes as it walks through Swipe/Browse/Search.
  const preTourModeRef = useRef<DiscoveryMode>('swipe')
  // The tour drives the discovery mode itself (Swipe → Browse → Search) as it
  // advances. Remember where the user was so we can put them back on close.
  const startTour = useCallback(() => {
    preTourModeRef.current = mode
    setTourOpen(true)
  }, [mode])
  const closeTour = useCallback(() => {
    setTourOpen(false)
    setMode(preTourModeRef.current)
  }, [])
  const { user: authedUser, refresh: refreshAuth } = useAuth()

  // First-login onboarding survey (#742): the favorite-Pokémon pop-up shows
  // once per account, gated server-side via `onboardingCompleted`. Dismissing
  // (Done or Skip) marks it complete and re-polls `/me` so it never re-nags;
  // the local flag hides it immediately, ahead of the round-trip.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const showOnboarding =
    authedUser != null && authedUser.onboardingCompleted === false && !onboardingDismissed
  const closeOnboarding = useCallback(() => {
    setOnboardingDismissed(true)
    void completeOnboarding()
      .then(() => refreshAuth())
      .catch(() => {
        // Best-effort — the local flag already hid the pop-up for this session.
      })
  }, [refreshAuth])
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

  // Post-sign-in name prompt: once the OAuth / magic-link round-trip
  // resolves and the visitor is signed in, surface the design-system
  // name dialog so they can finish the "Sign in to save" flow they
  // started before the redirect. The pending blob carries just the run
  // identifier + view state — the name is collected here, not pre-
  // emptively before the picker opened, so the visitor's first
  // interaction with sign-in was the auth modal and not a native prompt.
  const [pendingSave, setPendingSave] = useState<PendingSaveSearch | null>(null)
  useEffect(() => {
    if (authedUser === null) return
    // Defer the consume + setState past the effect's sync body so we
    // don't trip the `react-hooks/set-state-in-effect` cascade-render
    // rule. Consuming inside the microtask still removes the
    // sessionStorage entry exactly once per sign-in transition because
    // the effect's `authedUser` dependency only re-fires on a real
    // change.
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      const pending = consumePendingSaveSearch()
      if (pending !== null) setPendingSave(pending)
    })
    return () => {
      cancelled = true
    }
  }, [authedUser])

  const handlePendingSaveSubmit = useCallback(
    async (name: string) => {
      if (pendingSave === null) return
      try {
        await saveRun(pendingSave.runId, name, pendingSave.viewState)
        const { items } = await listRuns(50)
        setRuns(items)
      } catch {
        // One-time handoff from the auth redirect: if the run disappeared
        // or the session is no longer valid, the user can click Save again.
      } finally {
        setPendingSave(null)
      }
    },
    [pendingSave, setRuns],
  )

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

    // Results render only in Search mode, and the app now opens on Swipe (#814).
    // A rerun fired from the Backpack's Recent tab must surface the editor +
    // results rather than leaving them hidden behind the Swipe panel.
    setMode('search')

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
    // Drop any "currently loaded saved run" marker — the sidebar's
    // highlight should follow the visible results, and fresh streamed
    // rows aren't a saved search yet. The done frame surfaces the
    // freshly-persisted `run_id` so the Save button has a target.
    setCurrentRunId(null)
    // Clear the prior run's cache-source signal so the chip doesn't linger
    // with a stale value while the new run streams in (#310).
    setCacheStatus(null)
    // Fresh stream → reset the view state so a saved search's sort or
    // filters don't bleed onto the new run.
    resetViewState()

    abortRef.current = new AbortController()

    // Track unique card IDs for client-side deduplication.
    const seenIds = new Set<string>()
    // Distinct input lines that have produced a terminal row. The server now
    // streams results out of completion order (#303), so progress counts
    // resolved lines rather than reading the latest event's index — otherwise
    // a late-finishing early line would make the bar regress.
    const resolvedLines = new Set<number>()
    let firstEventSeen = false

    function onEvent(event: BulkEvent) {
      if ('done' in event && event.done) {
        // Capture the persisted run id so the in-page Save button can
        // promote this run into the saved-search sidebar. `null` is
        // a legitimate value when persistence fell through server-side
        // (best-effort) — leave currentRunId unset in that case.
        if (event.run_id != null) setCurrentRunId(event.run_id)
        // Surface the run's disk-cache freshness for the lookup-timer chip.
        setCacheStatus(event.cache_status)
        return
      }
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

      // Count the line toward progress before any dedupe skip — a duplicate
      // card ID still resolved its line, so omitting it here would strand the
      // bar below total (e.g. `Pikachu\nPikachu\nMew` finishing at 2 / 3).
      resolvedLines.add(event.index)
      setProgress({ done: resolvedLines.size, total: event.total })

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
    setCurrentRunId,
    setCacheStatus,
    resetViewState,
    setMode,
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
          {/* Desktop: the full header cluster. On mobile these split by type —
              destinations move to the bottom tab bar, utility to the More sheet. */}
          <div className="hidden items-center gap-2 lg:flex">
            <InsightsNavButton />
            <HelpModal onStartTour={startTour} />
            <div data-tour="settings">
              <SettingsDrawer />
            </div>
            <ThemeToggle />
            <SignInChip />
          </div>
          {/* Mobile: brand + a single "More" affordance holding the utility set. */}
          <div className="lg:hidden">
            <MobileUtilitySheet>
              <UtilityRow label="Appearance">
                <ThemeToggle />
              </UtilityRow>
              <UtilityRow label="Settings">
                <SettingsDrawer />
              </UtilityRow>
              <UtilityRow label="Help">
                <HelpModal onStartTour={startTour} />
              </UtilityRow>
            </MobileUtilitySheet>
          </div>
        </div>
      </header>

      {/* Main content. Extra bottom padding on mobile clears the fixed tab bar. */}
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:pb-6">
        <div className="flex gap-4">
          <div className="hidden lg:block lg:w-auto lg:flex-shrink-0" data-tour="library">
            <LibraryPanel
              variant="sidebar"
              onRun={handleRun}
              onShowSearch={() => setMode('search')}
            />
          </div>
          <div className="flex-1 min-w-0 space-y-6">
            {/* Discover: the discovery workspace. On mobile it's the Discover
                tab; desktop always shows it (the bottom bar never renders). */}
            <div className={`space-y-6 ${mobileTab === 'discover' ? '' : 'hidden'} lg:block`}>
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
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
                    Card list
                  </h2>
                  <InputEditor onRun={handleRun} onStop={handleStop} />
                </section>

                <section data-tour="results">
                  <div className="mb-2 flex items-end justify-between gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
                      Results
                    </h2>
                    <div data-tour="exports">
                      <ExportBar />
                    </div>
                  </div>
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
            </div>

            {/* Backpack: the library as a mobile destination. Desktop keeps the
                left rail; this only renders under the breakpoint. */}
            {mobileTab === 'backpack' && (
              <div className="lg:hidden" data-tour="library-mobile">
                <LibraryPanel
                  variant="accordion"
                  onRun={handleRun}
                  onShowSearch={() => {
                    setMode('search')
                    selectMobileTab('discover')
                  }}
                />
              </div>
            )}

            {/* Account: sign-in / account as a mobile destination. Desktop keeps
                the header chip. */}
            {mobileTab === 'account' && (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-sand-300 bg-sand-50 px-4 py-8 lg:hidden dark:border-husk-50 dark:bg-husk-100">
                <p className="text-sm text-coconut-500 dark:text-sand-300">Your account</p>
                <SignInChip />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Insights opens the existing dashboard over the current surface and
          returns to it on close (#519). Desktop uses the header button instead. */}
      <CollectionInsights
        open={mobileTab === 'insights'}
        onOpenChange={(o) => {
          if (!o) selectMobileTab(lastSurfaceRef.current)
        }}
      />
      <MobileTabBar active={mobileTab} onSelect={selectMobileTab} />

      {tourOpen && (
        <Tour onClose={closeTour} onRun={handleRun} onStop={handleStop} onSetMode={setMode} />
      )}

      <FavoritePokemonOnboarding open={showOnboarding} onClose={closeOnboarding} />

      <SaveSearchNameDialog
        open={pendingSave !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSave(null)
        }}
        mode="name"
        onSubmit={(name) => void handlePendingSaveSubmit(name)}
      />

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
        <p>
          mgz-pkmn · a personal card-show prep tool ·{' '}
          <a
            href="https://mgz-pkmn.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-palm-500 hover:text-palm-400 dark:text-sun-300 dark:hover:text-sun-200 transition-colors"
          >
            mgz-pkmn.com
          </a>{' '}
          ·{' '}
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
        </p>
        <p className="mt-2 px-4 text-[11px] leading-relaxed text-sand-500 dark:text-sand-400">
          Affiliate disclosure: mgz-pkmn may earn from qualifying purchases through eBay and
          TCGplayer links.
        </p>
      </footer>
    </div>
  )
}

export default App
