/**
 * LibraryPanel — unified destination for the visitor's saved stuff:
 * Searches (named saved runs), Recent (client-side input history),
 * Collections (*"I own these"*), and Wishlists (*"I want these"*). Four
 * tabs, one surface — replaces the desktop saved-searches rail and the
 * two header chips that used to open Collections / Wishlists modals.
 *
 * Two layouts share the same tab content:
 * - `variant="sidebar"` (desktop, lg+) — persistent left rail; can
 *   collapse to a compact icon strip. Replaces SavedSearchesSidebar.
 * - `variant="accordion"` (mobile, below lg) — collapsed-by-default
 *   accordion above the editor. Expanded reveals the full 4-tab
 *   library. Keeps the editor as the hero when the library is empty
 *   or short.
 *
 * Recent's *re-run* shortcut requires the parent's `onRun` callback so
 * one tap on a recent entry restores the lines and kicks off a fresh
 * lookup against the current settings.
 */
import { useState } from 'react'
import { Bookmark, ChevronDown, ChevronLeft, ChevronRight, Heart, History, Library, Search } from 'lucide-react'
import { useAppStore } from '../store'
import { LibrarySearchesTab } from './LibrarySearchesTab'
import { LibraryRecentTab } from './LibraryRecentTab'
import { LibraryCollectionsTab } from './LibraryCollectionsTab'
import { LibraryWishlistsTab } from './LibraryWishlistsTab'

type LibraryTab = 'searches' | 'recent' | 'collections' | 'wishlists'

const TABS: { value: LibraryTab; label: string; icon: typeof Search }[] = [
  { value: 'searches', label: 'Searches', icon: Bookmark },
  { value: 'recent', label: 'Recent', icon: History },
  { value: 'collections', label: 'Collections', icon: Library },
  { value: 'wishlists', label: 'Wishlists', icon: Heart },
]

interface Props {
  variant: 'sidebar' | 'accordion'
  onRun: (overrideText: string) => void
}

export function LibraryPanel({ variant, onRun }: Props) {
  const [activeTab, setActiveTab] = useState<LibraryTab>('searches')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [accordionOpen, setAccordionOpen] = useState(false)

  const runs = useAppStore((s) => s.runs)
  const recentCount = useAppStore((s) => s.recentRuns.length)

  const tabContent = renderTab(activeTab, onRun)

  if (variant === 'sidebar') {
    if (sidebarCollapsed) {
      return (
        <aside
          aria-label="Library (collapsed)"
          className="sticky top-20 flex h-fit w-9 flex-col items-center gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40 px-1 py-2"
        >
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="Expand Library"
            aria-expanded={false}
            className="flex h-7 w-7 items-center justify-center rounded text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-600 dark:hover:text-sand-200"
          >
            <ChevronRight size={16} />
          </button>
          <Library size={14} className="text-coconut-400 dark:text-sand-400" aria-hidden />
          <span className="text-[10px] font-medium text-coconut-400 dark:text-sand-400 tabular-nums">
            {runs.length}
          </span>
        </aside>
      )
    }

    return (
      <aside
        aria-label="Library"
        className="sticky top-20 flex h-fit max-h-[calc(100vh-6rem)] w-72 flex-col gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40 px-3 py-2"
      >
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-coconut-400 dark:text-sand-300">
            <Library size={12} aria-hidden />
            Library
          </h2>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            aria-label="Collapse Library"
            aria-expanded={true}
            className="rounded p-1 text-coconut-400 dark:text-sand-400 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-600 dark:hover:text-sand-200"
          >
            <ChevronLeft size={14} />
          </button>
        </header>
        <TabStrip
          activeTab={activeTab}
          onChange={setActiveTab}
          runsCount={runs.length}
          recentCount={recentCount}
        />
        <div className="overflow-y-auto">{tabContent}</div>
      </aside>
    )
  }

  // Mobile accordion above the editor: collapsed by default so the
  // editor stays the hero on small viewports.
  return (
    <section aria-label="Library" className="rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40">
      <button
        type="button"
        onClick={() => setAccordionOpen((o) => !o)}
        aria-expanded={accordionOpen}
        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-xs font-medium text-coconut-500 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Library size={14} aria-hidden />
          Library
          <span className="text-coconut-400 dark:text-sand-400">({runs.length})</span>
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform ${accordionOpen ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {accordionOpen && (
        <div className="flex flex-col gap-2 border-t border-sand-200 dark:border-husk-100 px-3 py-2">
          <TabStrip
            activeTab={activeTab}
            onChange={setActiveTab}
            runsCount={runs.length}
            recentCount={recentCount}
          />
          {tabContent}
        </div>
      )}
    </section>
  )
}

function renderTab(tab: LibraryTab, onRun: (overrideText: string) => void) {
  switch (tab) {
    case 'searches':
      return <LibrarySearchesTab />
    case 'recent':
      return <LibraryRecentTab onRun={onRun} />
    case 'collections':
      return <LibraryCollectionsTab />
    case 'wishlists':
      return <LibraryWishlistsTab />
  }
}

function TabStrip({
  activeTab,
  onChange,
  runsCount,
  recentCount,
}: {
  activeTab: LibraryTab
  onChange: (tab: LibraryTab) => void
  runsCount: number
  recentCount: number
}) {
  const counts: Record<LibraryTab, number | null> = {
    searches: runsCount,
    recent: recentCount,
    collections: null,
    wishlists: null,
  }
  return (
    <div
      role="tablist"
      aria-label="Library sections"
      className="grid grid-cols-2 gap-1 rounded border border-sand-200 dark:border-husk-100 bg-sand-100 dark:bg-husk-200 p-0.5"
    >
      {TABS.map((t) => {
        const Icon = t.icon
        const active = t.value === activeTab
        const count = counts[t.value]
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors ${
              active
                ? 'bg-sand-50 text-coconut-700 shadow-sm dark:bg-husk-400 dark:text-sand-50'
                : 'text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100'
            }`}
            title={t.label}
          >
            <Icon size={11} aria-hidden className="flex-shrink-0" />
            <span className="truncate">{t.label}</span>
            {count !== null && count > 0 && (
              <span className="flex-shrink-0 tabular-nums text-coconut-400 dark:text-sand-400">
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
