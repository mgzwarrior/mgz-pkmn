/**
 * LibraryPanel — unified destination for the visitor's saved stuff:
 * Searches (named saved runs), Recent (client-side input history), and
 * Binders — the merged home for collections (*"I own these"*) and
 * want-lists (*"I'm chasing these"*). Three tabs, one surface — replaces
 * the desktop saved-searches rail and the two header chips that used to
 * open Collections / Wishlists modals.
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
import { Backpack, Bookmark, ChevronDown, ChevronLeft, ChevronRight, History, Library, Search } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import { LibrarySearchesTab } from './LibrarySearchesTab'
import { LibraryRecentTab } from './LibraryRecentTab'
import { LibraryBindersTab } from './LibraryBindersTab'

export type LibraryTab = 'searches' | 'recent' | 'binders'

const ALL_TABS: { value: LibraryTab; label: string; icon: typeof Search }[] = [
  { value: 'searches', label: 'Searches', icon: Bookmark },
  { value: 'recent', label: 'Recent', icon: History },
  { value: 'binders', label: 'Binders', icon: Library },
]

// Binders (collections + want-lists) are a user-scoped surface. On
// auth-enabled deploys with no identified user the tab is hidden — same
// gate the pre-Library header chips applied. Self-host (authEnabled=false)
// falls back to the default user so the tab stays visible.
const USER_SCOPED_TABS = new Set<LibraryTab>(['binders'])

interface Props {
  variant: 'sidebar' | 'accordion'
  onRun: (overrideText: string) => void
  /** Surface the Search editor + results — the app opens on Swipe, so loading
   *  a saved search has to switch modes for its rows to be visible (#814). */
  onShowSearch: () => void
  /** Collapse state for `variant="sidebar"` only, lifted to the parent so it
   *  can auto-collapse the rail on entering Search mode (#522 follow-up) —
   *  the split editor/results layout is tight on a non-ultrawide desktop.
   *  Ignored by `variant="accordion"`, which has its own open/close state. */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** Lift the active tab to the parent (e.g. the command palette's "Open
   *  Collections"/"Open Wishlists" jumping straight to Binders, #525).
   *  Omit for the usual self-contained tab-click behavior. */
  activeTab?: LibraryTab
  onActiveTabChange?: (tab: LibraryTab) => void
}

export function LibraryPanel({
  variant,
  onRun,
  onShowSearch,
  collapsed,
  onCollapsedChange,
  activeTab: activeTabProp,
  onActiveTabChange,
}: Props) {
  const [internalActiveTab, setInternalActiveTab] = useState<LibraryTab>('searches')
  const activeTab = activeTabProp ?? internalActiveTab
  const setActiveTab = onActiveTabChange ?? setInternalActiveTab
  const [accordionOpen, setAccordionOpen] = useState(false)

  const runs = useAppStore((s) => s.runs)
  const recentCount = useAppStore((s) => s.recentRuns.length)
  const auth = useAuth()
  const showUserScoped = auth.user !== null
  const tabs = showUserScoped
    ? ALL_TABS
    : ALL_TABS.filter((t) => !USER_SCOPED_TABS.has(t.value))

  // Sign-out while sitting on a user-scoped tab → fall back to Searches
  // for rendering. Resolving inline (instead of via useEffect+setState)
  // keeps `react-hooks/set-state-in-effect` happy and avoids a render
  // flicker; the stored activeTab catches up on the next user click.
  const resolvedActive: LibraryTab =
    !showUserScoped && USER_SCOPED_TABS.has(activeTab) ? 'searches' : activeTab
  const tabContent = renderTab(resolvedActive, onRun, onShowSearch)
  // The cached `runs` array is server-fetched and user-scoped; signOut()
  // only clears `auth.user`, not the store, so reading `runs.length`
  // straight through would leak the previous user's saved-search count
  // after sign-out. Treat it as zero (hidden) until an identified user
  // is back.
  const savedSearchCount = showUserScoped ? runs.length : 0

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
          {showUserScoped && (
            <span className="text-[10px] font-medium text-coconut-400 dark:text-sand-400 tabular-nums">
              {savedSearchCount}
            </span>
          )}
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
        <TabStrip
          tabs={tabs}
          activeTab={resolvedActive}
          onChange={setActiveTab}
          runsCount={savedSearchCount}
          recentCount={recentCount}
        />
        <div className="overflow-y-auto">{tabContent}</div>
      </aside>
    )
  }

  // Mobile accordion above the editor: collapsed by default so the
  // editor stays the hero on small viewports.
  return (
    <section aria-label="Backpack" className="rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-200/40">
      <button
        type="button"
        onClick={() => setAccordionOpen((o) => !o)}
        aria-expanded={accordionOpen}
        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-xs font-medium text-coconut-500 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Backpack size={14} aria-hidden />
          Backpack
          {showUserScoped && (
            <span className="text-coconut-400 dark:text-sand-400">({savedSearchCount})</span>
          )}
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
            tabs={tabs}
            activeTab={resolvedActive}
            onChange={setActiveTab}
            runsCount={savedSearchCount}
            recentCount={recentCount}
          />
          {tabContent}
        </div>
      )}
    </section>
  )
}

function renderTab(
  tab: LibraryTab,
  onRun: (overrideText: string) => void,
  onShowSearch: () => void,
) {
  switch (tab) {
    case 'searches':
      return <LibrarySearchesTab onShowSearch={onShowSearch} />
    case 'recent':
      return <LibraryRecentTab onRun={onRun} />
    case 'binders':
      return <LibraryBindersTab />
  }
}

function TabStrip({
  tabs,
  activeTab,
  onChange,
  runsCount,
  recentCount,
}: {
  tabs: typeof ALL_TABS
  activeTab: LibraryTab
  onChange: (tab: LibraryTab) => void
  runsCount: number
  recentCount: number
}) {
  const counts: Record<LibraryTab, number | null> = {
    searches: runsCount,
    recent: recentCount,
    binders: null,
  }
  return (
    <div
      role="tablist"
      aria-label="Backpack sections"
      className="grid grid-cols-2 gap-1 rounded border border-sand-200 dark:border-husk-100 bg-sand-100 dark:bg-husk-200 p-0.5"
    >
      {tabs.map((t, i) => {
        const Icon = t.icon
        const active = t.value === activeTab
        const count = counts[t.value]
        // An odd final tab spans the full row so the 2-col grid never
        // leaves a dangling empty cell (signed-in: Searches/Recent/Binders).
        const spanFull = i === tabs.length - 1 && tabs.length % 2 === 1
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-tour={t.value === 'binders' ? 'binders-tab' : undefined}
            onClick={() => onChange(t.value)}
            className={`flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors ${
              spanFull ? 'col-span-2' : ''
            } ${
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
