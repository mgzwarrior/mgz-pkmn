/**
 * LibraryPanel — the Backpack: the visitor's Binders, the merged home for
 * collections (*"I own these"*) and want-lists (*"I'm chasing these"*).
 *
 * Searches and Recent used to live here as sibling tabs, but they're
 * search artifacts — ways back into the lookup loop — so they moved into
 * the Search workspace itself ([SearchLibraryPanel](./SearchLibraryPanel.tsx),
 * #868). That leaves the Backpack holding exactly what the name promises:
 * the stuff you carry.
 *
 * Two layouts share the same content:
 * - `variant="sidebar"` (desktop, lg+) — persistent left rail; can
 *   collapse to a compact icon strip.
 * - `variant="accordion"` (mobile, below lg) — the entire content of the
 *   dedicated Backpack bottom tab (#519), always expanded.
 */
import { Backpack, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { LibraryBindersTab } from './LibraryBindersTab'

interface Props {
  variant: 'sidebar' | 'accordion'
  /** Collapse state for `variant="sidebar"` only, lifted to the parent so it
   *  can auto-collapse the rail on entering Search mode (#522 follow-up) —
   *  the split editor/results layout is tight on a non-ultrawide desktop.
   *  Ignored by `variant="accordion"`, which is always expanded. */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

export function LibraryPanel({ variant, collapsed, onCollapsedChange }: Props) {
  const auth = useAuth()
  // Binders are user-scoped. On auth-enabled deploys with no identified
  // user, show a sign-in nudge instead — same gate the pre-Library header
  // chips applied. Self-host (authEnabled=false) falls back to the default
  // user so the binders stay visible.
  const showUserScoped = auth.user !== null

  const content = showUserScoped ? (
    <LibraryBindersTab />
  ) : (
    <p className="text-xs text-coconut-500 dark:text-sand-300">
      Sign in to build binders — collections you own and wishlists you&apos;re
      chasing.
    </p>
  )

  if (variant === 'sidebar') {
    if (collapsed) {
      return (
        <aside
          aria-label="Backpack (collapsed)"
          className="sticky top-20 flex h-fit w-9 flex-col items-center gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40 px-1 py-2"
        >
          <button
            type="button"
            onClick={() => onCollapsedChange?.(false)}
            aria-label="Expand Backpack"
            aria-expanded={false}
            className="flex h-7 w-7 items-center justify-center rounded text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-600 dark:hover:text-sand-200"
          >
            <ChevronRight size={16} />
          </button>
          <Backpack size={14} className="text-coconut-400 dark:text-sand-400" aria-hidden />
        </aside>
      )
    }

    return (
      <aside
        aria-label="Backpack"
        className="sticky top-20 flex h-fit max-h-[calc(100vh-6rem)] w-72 flex-col gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40 px-3 py-2"
      >
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
            <Backpack size={12} aria-hidden />
            Backpack
          </h2>
          <button
            type="button"
            onClick={() => onCollapsedChange?.(true)}
            aria-label="Collapse Backpack"
            aria-expanded={true}
            className="rounded p-1 text-coconut-400 dark:text-sand-400 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-600 dark:hover:text-sand-200"
          >
            <ChevronLeft size={14} />
          </button>
        </header>
        <div className="overflow-y-auto">{content}</div>
      </aside>
    )
  }

  // This is the entire content of the dedicated Backpack bottom tab — no
  // sibling content to save space for, so it's always expanded (#857
  // follow-up).
  return (
    <section aria-label="Backpack" className="rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40">
      <h2 className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-coconut-500 dark:text-sand-200">
        <Backpack size={14} aria-hidden />
        Backpack
      </h2>
      <div className="flex flex-col gap-2 border-t border-sand-200 dark:border-husk-100 px-3 py-2">
        {content}
      </div>
    </section>
  )
}
