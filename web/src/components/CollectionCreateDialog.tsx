/**
 * CollectionCreateDialog — the New ▾ → Collection create flow (#723).
 *
 * A plain collection lives inside a physical binder (the inventory unit from
 * #702), so this dialog connects the two at create time:
 *
 * - **Binders exist:** pick one to file the new collection into, each shown
 *   with its available slots (capacity minus what's already filed; an empty
 *   binder shows its full capacity). Filing stays optional — "Don't file"
 *   leaves the collection loose.
 * - **No binders yet:** create one inline (name + optional cover color and
 *   capacity) and the collection drops straight into it.
 *
 * Both paths go through [useCollections](./useCollections.ts) /
 * [useBinders](./useBinders.ts) so every surface re-renders without a refetch.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Library, Loader2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BinderSummary } from '../api/client'
import type { CardData } from '../types'
import { BinderColorPicker } from './BinderColorPicker'
import { coverSwatch } from './binderIdentity'
import { useBinders } from './useBinders'
import { useCollections } from './useCollections'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Seed the name field (e.g. opened from Browse for a set/species). */
  prefillName?: string
  /** When set, bulk-add these cards into the new collection on create — the
   *  Browse "create a collection of this set/species" path (#737). */
  seedCards?: CardData[]
}

export function CollectionCreateDialog({ open, onOpenChange, prefillName, seedCards }: Props) {
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

/** Slots still free in a binder: capacity minus the cards already filed into
 *  it. Returns null when the binder has no capacity pinned (no slot limit). */
function freeSlots(binder: BinderSummary, usedByBinder: Map<number, number>): number | null {
  if (binder.capacity == null) return null
  return Math.max(0, binder.capacity - (usedByBinder.get(binder.id) ?? 0))
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
  const { collections, create: createCollection, bulkAdd: bulkAddCollection } = useCollections()
  const {
    binders,
    loading: bindersLoading,
    create: createBinder,
    refresh: refreshBinders,
  } = useBinders()

  const [name, setName] = useState(prefillName ?? '')
  // Existing-binder target: a binder id, or null for "don't file".
  const [binderId, setBinderId] = useState<number | null>(null)
  // Inline-binder fields (only used when no binders exist yet).
  const [newBinderName, setNewBinderName] = useState('')
  const [newBinderColor, setNewBinderColor] = useState<string | null>(null)
  const [newBinderCapacity, setNewBinderCapacity] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Until the binder list resolves, neither branch is safe to show: an empty
  // `binders` during the in-flight fetch would falsely read as "no binders
  // yet" and offer the inline-create / loose-collection path even though
  // existing binders are about to appear (#724 review). Gate on the settled
  // state instead.
  const bindersSettled = !bindersLoading
  const hasBinders = binders.length > 0

  // Cards already filed into each binder — the sum of its collections' pocket
  // counts (vendor multiples via total_quantity, falling back to row count).
  const usedByBinder = useMemo(() => {
    const map = new Map<number, number>()
    for (const c of collections) {
      if (c.binder_id == null) continue
      map.set(c.binder_id, (map.get(c.binder_id) ?? 0) + (c.total_quantity ?? c.item_count))
    }
    return map
  }, [collections])

  const canSubmit = name.trim().length > 0 && !submitting && bindersSettled

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      // No binders yet + the user named one inline → make the binder first,
      // then drop the collection straight into it.
      let target = binderId
      const inlineName = newBinderName.trim()
      if (!hasBinders && inlineName) {
        const cap = newBinderCapacity.trim() ? Number(newBinderCapacity.trim()) : null
        const binder = await createBinder(inlineName, {
          binder_color: newBinderColor,
          capacity: cap && cap > 0 ? cap : null,
        })
        target = binder.id
      }
      const created = await createCollection(
        name.trim(),
        target != null ? { binder_id: target } : undefined,
      )
      // Seeded from Browse (#737): drop the set's cards / species' printings
      // straight in. The hook's bulkAdd updates the count and busts the shared
      // ownership cache (#576) so the badges/chips reflect the new cards.
      if (seedCards && seedCards.length > 0) {
        await bulkAddCollection(created.id, seedCards, { addedVia: 'browse' })
      }
      if (target != null) await refreshBinders()
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
          New collection
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
        Name the collection and optionally file it into one of your binders.
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
            placeholder="Base Set holos"
            className={inputClass}
          />
        </label>

        {!bindersSettled ? (
          <div className="flex items-center gap-2 text-[11px] text-coconut-400 dark:text-sand-300">
            <Loader2 size={12} className="animate-spin" />
            Loading your binders…
          </div>
        ) : hasBinders ? (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
              File into a binder (optional)
            </legend>
            <BinderRadio
              checked={binderId === null}
              onSelect={() => setBinderId(null)}
              label="Don't file"
              hint="Leave the collection loose."
            />
            {binders.map((b) => {
              const free = freeSlots(b, usedByBinder)
              const swatch = coverSwatch(b.binder_color)
              return (
                <BinderRadio
                  key={b.id}
                  checked={binderId === b.id}
                  onSelect={() => setBinderId(b.id)}
                  label={b.name}
                  hint={slotHint(free, b.capacity)}
                  swatch={swatch}
                />
              )
            })}
          </fieldset>
        ) : (
          <div className="space-y-2 rounded-md border border-sand-200 bg-coconut-50 p-3 dark:border-husk-100 dark:bg-husk-100">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-coconut-500 dark:text-sand-200">
              <Library size={12} aria-hidden />
              No binders yet — create one to file this into (optional)
            </div>
            <input
              type="text"
              value={newBinderName}
              onChange={(e) => setNewBinderName(e.target.value)}
              placeholder="Binder name, e.g. Slot 1"
              aria-label="New binder name"
              className={inputClass}
            />
            <BinderColorPicker value={newBinderColor} onChange={setNewBinderColor} label="Cover color" />
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-coconut-500 dark:text-sand-300">
                Capacity (slots)
              </span>
              <input
                type="number"
                min={1}
                value={newBinderCapacity}
                onChange={(e) => setNewBinderCapacity(e.target.value)}
                placeholder="360"
                aria-label="New binder capacity (slots)"
                className={inputClass}
              />
            </label>
          </div>
        )}

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

/** The free/capacity hint under a binder option. Empty binders read "Empty",
 *  capacity-less binders read "No slot limit". */
function slotHint(free: number | null, capacity: number | null | undefined): string {
  if (capacity == null) return 'No slot limit'
  if (free === capacity) return `Empty · ${capacity} slots`
  return `${free} of ${capacity} slots free`
}

function BinderRadio({
  checked,
  onSelect,
  label,
  hint,
  swatch,
}: {
  checked: boolean
  onSelect: () => void
  label: string
  hint: string
  swatch?: { className: string; style?: { backgroundColor: string } }
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-left transition ${
        checked
          ? 'border-palm-400 bg-palm-50 dark:border-palm-300 dark:bg-husk-100'
          : 'border-sand-300 bg-coconut-50 hover:border-sand-400 dark:border-husk-100 dark:bg-husk-100'
      }`}
    >
      <input
        type="radio"
        name="collection-binder"
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {swatch ? (
        <span
          className={`h-5 w-4 shrink-0 rounded-sm ${swatch.className}`}
          style={swatch.style}
          aria-hidden
        />
      ) : (
        <span className="h-5 w-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-coconut-700 dark:text-sand-50">
          {label}
        </span>
        <span className="block text-[10px] text-coconut-400 dark:text-sand-300">{hint}</span>
      </span>
    </label>
  )
}
