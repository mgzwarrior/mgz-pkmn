/**
 * Tour — opt-in guided walkthrough of the main UI sections. Triggered
 * from HelpModal. Each step scrolls a target element into view, draws
 * a glowing ring around it, and shows a step card at the bottom of
 * the viewport with Prev / Next / Skip controls.
 *
 * Target elements are matched by `data-tour="<id>"` attributes.
 *
 * Mounted only while running — the parent renders <Tour /> when the
 * user starts the tour, so step state resets cleanly on each open.
 */
import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '../store'

const TOUR_SEED = 'Pikachu | Jungle'

interface Step {
  selector: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    selector: '[data-tour="input"]',
    title: 'Card list',
    body: 'Paste or type one card per line. Try a precise format like "Charizard | Base Set | 4/102", a bulk lookup like "top:5 Charizard cards", or a name on its own. Blank lines and # comments are skipped.',
  },
  {
    selector: '[data-tour="run"]',
    title: 'Look up',
    body: 'Run the lookup. Results stream in as each line resolves — ⌘ Enter is the keyboard shortcut.',
  },
  {
    selector: '[data-tour="settings"]',
    title: 'Settings',
    body: 'Drawer for the API key, source tag, sort order, price cap, dedupe, and image toggles. Settings apply to both the table and every export.',
  },
  {
    selector: '[data-tour="results"]',
    title: 'Results',
    body: 'Matched cards appear here with prices and negotiation comps. Click any column header to sort; use Filter for per-column substring or price ranges.',
  },
  {
    selector: '[data-tour="exports"]',
    title: 'Exports',
    body: 'Download .xlsx, PDF binder, condensed PDF, or per-tag checklist once you have matched rows. "Set ID cards" works without any input.',
  },
]

interface Props {
  onClose: () => void
}

export function Tour({ onClose }: Props) {
  const [stepIndex, setStepIndex] = useState(0)
  const setInputText = useAppStore((s) => s.setInputText)

  // Seed the textarea with a sample line on first mount so disabled-only
  // elements (Look up button) have a meaningful highlight at step 2.
  // Restore on unmount only if the seed is still there untouched — never
  // clobber the user's own input.
  useEffect(() => {
    const initial = useAppStore.getState().inputText
    if (initial.trim() !== '') return
    setInputText(TOUR_SEED)
    return () => {
      if (useAppStore.getState().inputText === TOUR_SEED) {
        setInputText('')
      }
    }
  }, [setInputText])

  // Scroll the target element into view and glow it while this step is active.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(STEPS[stepIndex].selector)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('tour-highlight')
    return () => el.classList.remove('tour-highlight')
  }, [stepIndex])

  // Esc closes; arrows step.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
      else if (e.key === 'ArrowLeft') setStepIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const step = STEPS[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  function next() {
    if (isLast) onClose()
    else setStepIndex((i) => i + 1)
  }

  function prev() {
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(560px,92vw)] rounded-lg border border-blue-500/60 bg-zinc-900 shadow-2xl"
      role="dialog"
      aria-label={`Tour: ${step.title}`}
    >
      <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-blue-400">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
          <span className="text-sm font-semibold text-zinc-100">{step.title}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
          aria-label="Skip tour"
          title="Skip tour"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-4 py-3 text-sm text-zinc-300">{step.body}</div>
      <div className="flex items-center justify-between border-t border-zinc-700 px-4 py-2.5">
        <button
          onClick={prev}
          disabled={isFirst}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={14} />
          Back
        </button>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          Skip
        </button>
        <button
          onClick={next}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
        >
          {isLast ? 'Done' : 'Next'}
          {!isLast && <ChevronRight size={14} />}
        </button>
      </div>
    </div>
  )
}
