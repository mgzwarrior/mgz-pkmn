/**
 * CollectionsModal — header-triggered list view of every collection
 * the user has saved. Minimal V1 surface: names, item counts, and an
 * empty-state nudge that points at the per-row "Save to collection"
 * button. Rename / delete / drill-in arrive in follow-ups.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Library, Loader2, X } from 'lucide-react'
import { useEffect } from 'react'
import { useCollections } from './useCollections'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CollectionsModal({ open, onOpenChange }: Props) {
  const { collections, loading, error, refresh } = useCollections()

  // Re-fetch each time the modal opens so changes made on this device
  // (or another tab) since the last open show up without a full reload.
  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 dark:bg-husk-500/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby="collections-description"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200"
        >
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <div className="flex items-center gap-2">
              <Library size={18} className="text-coconut-600 dark:text-sand-200" />
              <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
                Collections
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 text-coconut-400 hover:bg-sand-200 hover:text-coconut-700 dark:text-sand-300 dark:hover:bg-husk-100 dark:hover:text-sand-50"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>

          <p
            id="collections-description"
            className="px-5 pt-3 text-sm text-coconut-400 dark:text-sand-300"
          >
            Cards you&apos;ve pinned across runs. Use the bookmark button on a
            result row to save into one.
          </p>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-coconut-400 dark:text-sand-300">
                <Loader2 size={14} className="animate-spin" />
                Loading collections…
              </div>
            )}
            {error && (
              <div className="text-sm text-sun-600 dark:text-sun-300">{error}</div>
            )}
            {!loading && !error && collections.length === 0 && (
              <p className="text-sm text-coconut-400 dark:text-sand-300">
                You don&apos;t have any collections yet. Run a lookup, then click
                the bookmark icon on a matched row to start one.
              </p>
            )}
            {!loading && collections.length > 0 && (
              <ul className="divide-y divide-sand-200 dark:divide-husk-100">
                {collections.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50">
                        {c.name}
                      </div>
                      {c.description && (
                        <div className="truncate text-xs text-coconut-400 dark:text-sand-300">
                          {c.description}
                        </div>
                      )}
                    </div>
                    <span className="ml-3 shrink-0 rounded bg-sand-200 px-2 py-0.5 text-xs text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
                      {c.item_count} {c.item_count === 1 ? 'card' : 'cards'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
