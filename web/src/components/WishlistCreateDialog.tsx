/**
 * WishlistCreateDialog — the New ▾ → Want-list create flow (#774).
 *
 * Mirrors {@link CollectionCreateDialog}: a want-list can now be filed into a
 * physical binder at create time via the shared {@link BinderFilePicker} —
 * pick an existing binder, create one inline, or leave it loose — so all three
 * logical lists (collection, smart collection, want-list) are binder-aware.
 * State flows through [useWishlists](./useWishlists.ts) / [useBinders](./useBinders.ts)
 * so every surface re-renders without a refetch.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import { useState } from 'react'
import type { CardData } from '../types'
import { BinderFilePicker } from './BinderFilePicker'
import { useBinderFiling } from './useBinderFiling'
import { useWishlists } from './useWishlists'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Seed the name field (e.g. opened from Browse for a set/species). */
  prefillName?: string
  /** When set, bulk-add these cards into the new want-list on create — the
   *  Browse "create a want-list of this set/species" path (#737). */
  seedCards?: CardData[]
}

export function WishlistCreateDialog({ open, onOpenChange, prefillName, seedCards }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          {/* Form state only mounts while open, so each open starts fresh. */}
          {open && (
            <CreateForm
              onClose={() => onOpenChange(false)}
              prefillName={prefillName}
              seedCards={seedCards}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CreateForm({
  onClose,
  prefillName,
  seedCards,
}: {
  onClose: () => void
  prefillName?: string
  seedCards?: CardData[]
}) {
  const { create: createWishlist, bulkAdd: bulkAddWishlist } = useWishlists()
  const filing = useBinderFiling()

  const [name, setName] = useState(prefillName ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim().length > 0 && !submitting && filing.settled

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const target = await filing.resolveTarget()
      const created = await createWishlist(
        name.trim(),
        target != null ? { binder_id: target } : undefined,
      )
      // Seeded from Browse (#737): drop the set's cards / species' printings in.
      if (seedCards && seedCards.length > 0) {
        await bulkAddWishlist(created.id, seedCards)
      }
      if (target != null) await filing.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded border border-sand-300 bg-coconut-50 px-2.5 py-1.5 text-sm text-coconut-700 placeholder:text-coconut-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-100 dark:bg-husk-100 dark:text-sand-50 dark:focus:ring-sun-300'

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
        <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
          New wishlist
        </Dialog.Title>
        <Dialog.Close asChild>
          <button
            aria-label="Close"
            className="rounded p-1 text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
          >
            <X size={18} />
          </button>
        </Dialog.Close>
      </header>
      <Dialog.Description className="sr-only">
        Name the wishlist and optionally file it into one of your binders.
      </Dialog.Description>

      <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
            Name
          </span>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Chase cards"
            className={inputClass}
          />
        </label>

        <BinderFilePicker filing={filing} />

        {error && (
          <div role="alert" className="text-[11px] text-sun-600 dark:text-sun-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-sand-200 pt-3 dark:border-husk-100">
          <Dialog.Close asChild>
            <button
              type="button"
              className="rounded px-3 py-1.5 text-xs font-medium text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
            >
              Cancel
            </button>
          </Dialog.Close>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded bg-palm-500 px-3.5 py-1.5 text-xs font-medium text-coconut-50 hover:bg-palm-600 disabled:opacity-50 dark:text-husk-300"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </>
  )
}
