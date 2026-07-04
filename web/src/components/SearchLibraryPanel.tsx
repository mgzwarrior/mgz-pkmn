/**
 * SearchLibraryPanel — Searches (named saved runs) + Recent (client-side
 * input history) as part of the Search workspace (#868). Both are ways
 * back into the lookup loop, so they sit under the card-list editor
 * instead of in the Backpack — which now holds Binders only.
 *
 * Desktop (the side-by-side workspace) renders the two tabs expanded, in
 * the editor's sticky column so they stay reachable during a results
 * scroll. On mobile the panel collapses to a single disclosure row so
 * results stay one scroll away from the editor.
 */
import { useState } from 'react'
import { Bookmark, ChevronDown, History } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import { LibraryRecentTab } from './LibraryRecentTab'
import { LibrarySearchesTab } from './LibrarySearchesTab'
import { useIsMobileViewport } from './useIsMobileViewport'

type SearchLibraryTab = 'searches' | 'recent'

const TABS: { value: SearchLibraryTab; label: string; icon: typeof Bookmark }[] = [
  { value: 'searches', label: 'Searches', icon: Bookmark },
  { value: 'recent', label: 'Recent', icon: History },
]

interface Props {
  onRun: (overrideText: string) => void
  /** Loading a saved search restores rows into the Search workspace, so the
   *  parent has to make sure that workspace is the one showing (#814). */
  onShowSearch: () => void
}

export function SearchLibraryPanel({ onRun, onShowSearch }: Props) {
  const runs = useAppStore((s) => s.runs)
  const recentCount = useAppStore((s) => s.recentRuns.length)
  const auth = useAuth()
  // Same leak guard as the old Backpack tabs: `runs` stays cached in the
  // store across sign-out, so only an identified user's count shows.
  const savedCount = auth.user !== null ? runs.length : 0
  const isMobile = useIsMobileViewport()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SearchLibraryTab>('searches')
  const open = !isMobile || mobileOpen

  const counts: Record<SearchLibraryTab, number> = {
    searches: savedCount,
    recent: recentCount,
  }

  return (
    <section
      aria-label="Saved and recent lookups"
      className="rounded-md border border-sand-200 bg-sand-50 dark:border-husk-100 dark:bg-husk-200/40"
    >
      {isMobile && (
        <button
          type="button"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-xs font-medium text-coconut-500 dark:text-sand-200"
        >
          <span className="flex items-center gap-1.5">
            <Bookmark size={12} aria-hidden />
            Saved & recent
            {savedCount + recentCount > 0 && (
              <span className="text-coconut-400 dark:text-sand-400">
                ({savedCount + recentCount})
              </span>
            )}
          </span>
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform ${mobileOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
      )}
      {open && (
        <div
          className={`flex flex-col gap-2 px-3 py-2 ${
            isMobile ? 'border-t border-sand-200 dark:border-husk-100' : ''
          }`}
        >
          <div
            role="tablist"
            aria-label="Saved and recent lookups sections"
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
                  onClick={() => setActiveTab(t.value)}
                  className={`flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? 'bg-sand-50 text-coconut-700 shadow-sm dark:bg-husk-400 dark:text-sand-50'
                      : 'text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100'
                  }`}
                  title={t.label}
                >
                  <Icon size={11} aria-hidden className="flex-shrink-0" />
                  <span className="truncate">{t.label}</span>
                  {count > 0 && (
                    <span className="flex-shrink-0 tabular-nums text-coconut-400 dark:text-sand-400">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {activeTab === 'searches' ? (
            <LibrarySearchesTab onShowSearch={onShowSearch} />
          ) : (
            <LibraryRecentTab onRun={onRun} />
          )}
        </div>
      )}
    </section>
  )
}
