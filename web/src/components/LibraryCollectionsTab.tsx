/**
 * LibraryCollectionsTab — list view of collections (*"I own these"*) for
 * the Collections tab inside [LibraryPanel](./LibraryPanel.tsx). Names +
 * card counts only in V1; the per-row Save-to-collection button on the
 * results table creates entries here.
 */
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { useCollections } from './useCollections'

export function LibraryCollectionsTab() {
  const { collections, loading, error, refresh } = useCollections()

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading && collections.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
        <Loader2 size={12} className="animate-spin" />
        Loading collections…
      </div>
    )
  }

  if (error) {
    return <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">{error}</div>
  }

  if (!loading && collections.length === 0) {
    return (
      <p className="text-xs text-coconut-500 dark:text-sand-300">
        You don&apos;t have any collections yet. Run a lookup, then click
        the bookmark icon on a matched row to start one.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-sand-200 dark:divide-husk-100">
      {collections.map((c) => (
        <li key={c.id} className="flex items-center justify-between py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-coconut-700 dark:text-sand-50">
              {c.name}
            </div>
            {c.description && (
              <div className="truncate text-[11px] text-coconut-400 dark:text-sand-300">
                {c.description}
              </div>
            )}
          </div>
          <span className="ml-3 shrink-0 rounded bg-sand-200 px-2 py-0.5 text-[11px] text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
            {c.item_count} {c.item_count === 1 ? 'card' : 'cards'}
          </span>
        </li>
      ))}
    </ul>
  )
}
