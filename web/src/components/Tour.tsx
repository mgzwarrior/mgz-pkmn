/**
 * Tour — opt-in guided walkthrough of the main UI sections. Triggered
 * from HelpModal. Each step scrolls a target element into view, draws
 * a glowing ring around it, and shows a step card at the bottom of the
 * viewport with Prev / Next / Skip controls.
 *
 * Unlike a static highlight reel, the tour *drives* the app so a newcomer
 * actually sees each surface: it switches discovery modes (Swipe → Browse →
 * Search), opens a self-contained sample card-detail modal (so the modal +
 * ←/→ navigation + Want/Own quick actions are always demonstrable, no API
 * round-trip required), and flips the Backpack to its Binders tab. Steps that
 * only exist for a signed-in user (the Want/Own quick actions, the
 * collections/wishlists detail) are filtered out for anonymous visitors so the
 * tour never highlights an empty sign-in panel.
 *
 * Target elements are matched by `data-tour="<id>"` attributes.
 *
 * Mounted only while running — the parent renders <Tour /> when the
 * user starts the tour, so step state resets cleanly on each open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import { CardDetailModal } from './CardDetailModal'
import type { Row } from '../types'

type DiscoveryMode = 'search' | 'browse' | 'swipe'

const TOUR_SEED = 'Pikachu | Jungle'

interface Step {
  selector: string
  title: string
  body: string
  /** Switch the app into this discovery mode as the step activates. */
  mode?: DiscoveryMode
  /** Drop the step for anonymous visitors (the surface only renders signed in). */
  requiresAuth?: boolean
  /** Open the tour's self-contained sample card-detail modal for this step. */
  sampleDetail?: boolean
  /** Flip the Backpack to its Binders tab as the step activates. */
  openBinders?: boolean
  /** Fire the seeded lookup when advancing past this step. */
  runsLookup?: boolean
}

const STEPS: Step[] = [
  {
    selector: '[data-tour="discovery-modes"]',
    title: 'Find cards',
    body: 'Three ways in: Swipe one card at a time, Browse a whole set, or Search a wishlist you paste. This tour walks through each — new here, Swipe and Browse are the easiest start.',
  },
  {
    selector: '[data-tour="swipe"]',
    title: 'Swipe',
    body: 'Flip through cards one at a time and swipe to pass, keep, or love — by drag, the ← → ↑ keys, or the buttons. It learns what you like, and the keepers turn into a list in one tap.',
    mode: 'swipe',
  },
  {
    selector: '[data-tour="browse"]',
    title: 'Browse',
    body: 'Walk a whole set card by card, or switch to By Pokédex # to see every printing of one Pokémon. Filter by rarity or type, sort by number, name, or price.',
    mode: 'browse',
  },
  {
    selector: '[data-tour="card-detail"]',
    title: 'Card details',
    body: 'Tap any card — anywhere in the app — for the full-size art, market price, and every detail the source returned. ← / → step between cards without leaving the view.',
    sampleDetail: true,
  },
  {
    selector: '[data-tour="quick-actions"]',
    title: 'Want or Own',
    body: 'Two one-tap buttons on every card: Want for cards you’re chasing, Own for cards you already have. Tap to save, tap again to undo — a badge shows which of your lists hold it.',
    sampleDetail: true,
    requiresAuth: true,
  },
  {
    selector: '[data-tour="input"]',
    title: 'Card list',
    body: 'Search mode: paste or type one card per line. Try a precise "Charizard | Base Set | 4/102", a bulk "top:5 Charizard cards", or a name on its own. Look up runs them — Ctrl/Cmd + Enter is the shortcut.',
    mode: 'search',
    runsLookup: true,
  },
  {
    selector: '[data-tour="results"]',
    title: 'Results',
    body: 'Matched cards land here with market price and negotiation comps. Sort by any column header, Filter by text or price range, and Export to .xlsx, a PDF binder, or a checklist once you have rows.',
  },
  {
    selector: '[data-tour="library"], [data-tour="library-mobile"]',
    title: 'Backpack',
    body: 'Everything you save lives here: Binders (collections you Own and wishlists you Want), named Searches, and your Recent lookups. Sign in on the demo to keep Binders and Searches.',
  },
  {
    selector: '[data-tour="binders"]',
    title: 'Collections & wishlists',
    body: 'Open a binder for its detail: a collection tracks the cards you Own with quantities and value; a wishlist tracks what you’re chasing. Filter by Owned or Chasing.',
    requiresAuth: true,
    openBinders: true,
  },
  {
    selector: '[data-tour="settings"]',
    title: 'Settings',
    body: 'The API key, source tag, sort order, price cap, dedupe, eBay comps, lookup timer, and image toggles. Settings apply to both the table and every export.',
  },
]

// Three iconic cards the sample detail modal pages through, so the card-detail
// and quick-actions steps always have real content + working ←/→ navigation
// regardless of what the live API returns. Images load straight from
// pokemontcg.io like every card in the app.
function sampleRow(name: string, number: string, total: number, market: number): Row {
  return {
    query: {
      raw: name,
      name,
      set_hint: 'Base Set',
      number,
      variant_hint: null,
      url_hint: null,
      bulk_top: null,
      bulk_all: false,
      price_min: null,
      price_max: null,
    },
    card: {
      id: `base1-${number}`,
      name,
      number,
      rarity: 'Rare Holo',
      set: { id: 'base1', name: 'Base Set', series: 'Base', total, releaseDate: '1999/01/09' },
      images: {
        small: `https://images.pokemontcg.io/base1/${number}.png`,
        large: `https://images.pokemontcg.io/base1/${number}_hires.png`,
      },
    },
    pricing: { market, variant: null, source: 'PriceCharting', url: null, currency: 'USD' },
    tag: '',
    matched: true,
    reason: '',
  }
}

const SAMPLE_ROWS: Row[] = [
  sampleRow('Charizard', '4', 102, 320),
  sampleRow('Blastoise', '2', 102, 180),
  sampleRow('Venusaur', '15', 102, 150),
]

// The Backpack ships as a desktop sidebar and a mobile accordion; both mount,
// but only one is on screen (the other is display:none → no offsetParent).
function visibleLibraryRoot(): HTMLElement | null {
  const roots = document.querySelectorAll<HTMLElement>(
    '[data-tour="library"], [data-tour="library-mobile"]',
  )
  return Array.from(roots).find((e) => e.offsetParent !== null) ?? null
}

// Open the visible Backpack so its Binders tab can be reached: a collapsed
// sidebar or a closed mobile accordion exposes a single `aria-expanded="false"`
// toggle — click it. The tab itself is clicked a frame later, once the
// expanded panel (and its tab strip) has mounted.
function openBindersTab() {
  const root = visibleLibraryRoot()
  root?.querySelector<HTMLElement>('[aria-expanded="false"]')?.click()
}

interface Props {
  onClose: () => void
  onRun: (overrideText?: string) => void
  onStop: () => void
  /** Switch the app's discovery mode — the tour drives this as it advances. */
  onSetMode: (mode: DiscoveryMode) => void
}

export function Tour({ onClose, onRun, onStop, onSetMode }: Props) {
  const { user } = useAuth()
  const signedIn = user !== null

  // Anonymous visitors don't have the Want/Own quick actions or the
  // collections/wishlists surfaces, so those steps are dropped rather than
  // pointed at an empty sign-in panel.
  const steps = useMemo(
    () => STEPS.filter((s) => !s.requiresAuth || signedIn),
    [signedIn],
  )

  const [stepIndex, setStepIndex] = useState(0)
  const [sampleIndex, setSampleIndex] = useState(0)
  const setInputText = useAppStore((s) => s.setInputText)
  const hasRunRef = useRef(false)
  const stepIndexRef = useRef(0)

  useEffect(() => {
    stepIndexRef.current = stepIndex
  }, [stepIndex])

  const step = steps[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === steps.length - 1
  const detailOpen = !!step?.sampleDetail

  // Seed the textarea with a sample line on first mount so the Search step has
  // content and the seeded lookup has something to resolve. On unmount, undo
  // everything the tour put in place: clear the seeded input (only if it's
  // still untouched), and — only if the seed is *still* the input text and the
  // tour kicked off its own lookup — abort any in-flight tour request and clear
  // the rows / processing queue / progress state too. The seed check is the key
  // guard: if the user typed over the seed and ran their own query, their
  // results stay put.
  useEffect(() => {
    const initial = useAppStore.getState().inputText
    if (initial.trim() !== '') return
    setInputText(TOUR_SEED)
    return () => {
      const store = useAppStore.getState()
      const seedIntact = store.inputText === TOUR_SEED
      if (seedIntact) {
        store.setInputText('')
      }
      if (hasRunRef.current && seedIntact) {
        onStop() // aborts the underlying request so streaming events stop
        store.clearRows()
        store.setProcessingLines([])
        store.setProgress(null)
        store.setIsRunning(false)
      }
    }
  }, [setInputText, onStop])

  // Drive the app for the active step (switch mode / open the Binders tab),
  // then scroll the target element into view and glow it. Work is deferred a
  // beat so a mode switch or tab flip has rendered before we look for the
  // target, and sequenced across animation frames so the Binders tab is opened
  // *before* we hunt for its (then-mounted) content. A step may list more than
  // one anchor (the Backpack renders as a desktop sidebar *and* a mobile
  // accordion, only one visible at a time) — always prefer the visible match so
  // neither the tab click nor the highlight lands on a hidden node.
  useEffect(() => {
    if (!step) return
    if (step.mode) onSetMode(step.mode)
    let raf1 = 0
    let raf2 = 0
    const timer = window.setTimeout(() => {
      if (step.openBinders) openBindersTab()
      raf1 = window.requestAnimationFrame(() => {
        if (step.openBinders) {
          visibleLibraryRoot()?.querySelector<HTMLElement>('[data-tour="binders-tab"]')?.click()
        }
        raf2 = window.requestAnimationFrame(() => {
          const els = document.querySelectorAll<HTMLElement>(step.selector)
          const el = Array.from(els).find((e) => e.offsetParent !== null) ?? els[0]
          if (!el) return
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('tour-highlight')
        })
      })
    }, 80)
    return () => {
      window.clearTimeout(timer)
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      // Clear every highlight (not just one captured ref) so a deferred add
      // that lands after this cleanup schedules is still torn down next step.
      document.querySelectorAll('.tour-highlight').forEach((e) => e.classList.remove('tour-highlight'))
    }
  }, [step, onSetMode])

  // Advance one step. The first time the user advances past the step that owns
  // the seeded lookup, kick it off so the Results step has real streaming data.
  const next = useCallback(() => {
    const i = stepIndexRef.current
    if (i === steps.length - 1) {
      onClose()
      return
    }
    if (steps[i]?.runsLookup && !hasRunRef.current) {
      hasRunRef.current = true
      onRun(TOUR_SEED)
    }
    setStepIndex((n) => Math.min(n + 1, steps.length - 1))
  }, [onClose, onRun, steps])

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0))
  }, [])

  // Esc closes; arrows step — but only when the user is not typing in an
  // input/textarea/contentEditable (so the Search step doesn't hijack the
  // textarea cursor) and not while the sample card-detail modal is open (it
  // owns ←/→ to page between cards).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (detailOpen) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, next, prev, detailOpen])

  if (!step) return null

  return (
    <>
      {/* Our own dim backdrop behind the sample modal. The modal runs
          non-modal (so the tour controls below stay clickable), which means
          Radix doesn't render its own overlay — this stands in for it, and is
          pointer-events-none so it never swallows a click on the tour card. */}
      {detailOpen && (
        <div
          className="fixed inset-0 z-40 bg-coconut-700/60 dark:bg-husk-500/70 backdrop-blur-sm pointer-events-none"
          aria-hidden="true"
        />
      )}

      {/* The tour's own card-detail modal — controlled, fed canned sample rows
          so it always shows real content + working ←/→ nav. Runs non-modal so
          the tour card's Next/Back/Skip (rendered as siblings) stay clickable.
          onChangeIndex(null) (overlay/Esc close attempts) is ignored: the tour
          owns when it's open so closing it can't strand the walkthrough. */}
      <CardDetailModal
        rows={SAMPLE_ROWS}
        index={detailOpen ? sampleIndex : null}
        onChangeIndex={(n) => {
          if (n !== null) setSampleIndex(n)
        }}
        modal={false}
      />

      <div
        className="fixed inset-x-0 bottom-4 z-[60] mx-auto w-[min(560px,92vw)] rounded-lg border border-palm-400/60 dark:border-sun-300/60 bg-sand-50 dark:bg-husk-200 shadow-2xl shadow-coconut-700/30"
        role="dialog"
        aria-label={`Tour: ${step.title}`}
      >
        <div className="flex items-center justify-between border-b border-sand-300 dark:border-husk-50 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-palm-500 dark:text-sun-300">
              Step {stepIndex + 1} of {steps.length}
            </span>
            <span className="text-sm font-semibold text-coconut-700 dark:text-sand-50">{step.title}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
            aria-label="Skip tour"
            title="Skip tour"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3 text-sm text-coconut-600 dark:text-sand-200">{step.body}</div>
        <div className="flex items-center justify-between border-t border-sand-300 dark:border-husk-50 px-4 py-2.5">
          <button
            onClick={prev}
            disabled={isFirst}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-coconut-400 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50 hover:bg-sand-200 dark:hover:bg-husk-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} />
            Back
          </button>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-coconut-400 dark:text-sand-400 hover:text-coconut-600 dark:hover:text-sand-200 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={next}
            className="flex items-center gap-1 rounded-md bg-sun-300 dark:bg-sun-300 px-3 py-1 text-xs font-medium text-coconut-700 dark:text-husk-500 hover:bg-sun-400 dark:hover:bg-sun-200 transition-colors"
          >
            {isLast ? 'Done' : 'Next'}
            {!isLast && <ChevronRight size={14} />}
          </button>
        </div>
      </div>
    </>
  )
}
