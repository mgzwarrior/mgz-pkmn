/**
 * CollectionDetail — the detail view for a collection (#723).
 *
 * Opens from any owned row in [LibraryBindersTab](./LibraryBindersTab.tsx)
 * that isn't a catalog-scope target (those open
 * [SmartCollectionTarget](./SmartCollectionTarget.tsx) instead). Lists the
 * cards in the collection with their snapshot price, and surfaces an empty
 * state for a freshly-created collection so it's never a dead end.
 *
 * Owned quantity per card is shown and editable here (#769) — the canonical
 * place to manage counts. Cards are still added from Browse / Search via the
 * save buttons; seeded placeholder slots are a separate effort (#725). Editing
 * is gated to manual/set collections — a dynamic (smart) collection's
 * membership is rule-derived, so its counts aren't hand-adjustable.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ImageOff, Loader2, Minus, Plus, Wallet, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchCollection, type CollectionItem, type CollectionSummary } from '../api/client'
import { coverSwatch } from './binderIdentity'
import { useCollections } from './useCollections'
import { formatMoney } from '../utils/format'

interface Props {
  collection: CollectionSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function cardImage(item: CollectionItem): string | undefined {
  if (item.card_image_url) return item.card_image_url
  const images = item.card.images as { small?: string; large?: string } | undefined
  return images?.small ?? images?.large
}

function cardLabel(item: CollectionItem): string {
  return item.card_name ?? (item.card.name as string | undefined) ?? 'Unknown card'
}

export function CollectionDetail({ collection, open, onOpenChange }: Props) {
  const { setItemQuantity } = useCollections()
  const [items, setItems] = useState<CollectionItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  // A dynamic (smart) collection's membership comes from its rule, so its
  // counts aren't hand-editable — only manual/set collections get the stepper.
  const editable = collection != null && collection.kind !== 'dynamic'

  // Persist a card's new owned quantity, optimistically updating the row and
  // reverting on failure (#769).
  async function changeQuantity(item: CollectionItem, next: number) {
    if (!collection || next < 1) return
    const prev = item.quantity ?? 1
    if (next === prev) return
    setEditError(null)
    setItems((list) =>
      list ? list.map((i) => (i.id === item.id ? { ...i, quantity: next } : i)) : list,
    )
    try {
      await setItemQuantity(collection.id, item.id, next, next - prev)
    } catch (e) {
      setItems((list) =>
        list ? list.map((i) => (i.id === item.id ? { ...i, quantity: prev } : i)) : list,
      )
      setEditError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    if (!open || !collection) return
    let cancelled = false
    // Reset + fetch inside an async load (not synchronously in the effect
    // body) — mirrors SmartCollectionTarget and avoids the cascading-render
    // lint on set-state-in-effect.
    const load = async () => {
      setItems(null)
      setError(null)
      setEditError(null)
      setLoading(true)
      try {
        const c = await fetchCollection(collection.id)
        if (!cancelled) setItems(c.items)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, collection])

  const cover = coverSwatch(collection?.binder_color)
  const total = (items ?? []).reduce(
    (sum, it) => sum + (it.price_snapshot ?? 0) * (it.quantity ?? 1),
    0,
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <div className="flex min-w-0 items-center gap-2">
              {collection?.binder_color ? (
                <span
                  className={`h-4 w-4 shrink-0 rounded-full ${cover.className}`}
                  style={cover.style}
                  aria-hidden
                />
              ) : (
                <Wallet size={18} className="shrink-0 text-coconut-600 dark:text-sand-200" />
              )}
              <Dialog.Title className="truncate text-lg font-semibold text-coconut-700 dark:text-sand-50">
                {collection?.name ?? 'Collection'}
              </Dialog.Title>
            </div>
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
            The cards in this collection, with their snapshot prices.
          </Dialog.Description>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
                <Loader2 size={14} className="animate-spin" />
                Loading cards…
              </div>
            ) : error ? (
              <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">
                {error}
              </div>
            ) : items && items.length > 0 ? (
              <>
                <div className="mb-3 flex items-baseline justify-between text-xs text-coconut-500 dark:text-sand-300">
                  <span>
                    {items.length} {items.length === 1 ? 'card' : 'cards'}
                  </span>
                  {total > 0 && (
                    <span>
                      Snapshot total{' '}
                      <span className="font-medium text-coconut-700 dark:text-sand-50">
                        {formatMoney(total, 'USD')}
                      </span>
                    </span>
                  )}
                </div>
                {editError && (
                  <div role="alert" className="mb-2 text-[11px] text-sun-600 dark:text-sun-300">
                    Couldn&apos;t update quantity: {editError}
                  </div>
                )}
                <ul className="divide-y divide-sand-200 dark:divide-husk-100">
                  {items.map((it) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      editable={editable}
                      onChangeQuantity={(next) => void changeQuantity(it, next)}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-sand-300 px-4 py-8 text-center dark:border-husk-100">
                <p className="text-sm text-coconut-600 dark:text-sand-200">No cards yet.</p>
                <p className="mt-1 text-xs text-coconut-400 dark:text-sand-300">
                  Add cards from Browse or Search with the save-to-collection button.
                </p>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ItemRow({
  item,
  editable,
  onChangeQuantity,
}: {
  item: CollectionItem
  editable: boolean
  onChangeQuantity: (next: number) => void
}) {
  const [broken, setBroken] = useState(false)
  const img = cardImage(item)
  const qty = item.quantity ?? 1
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-sand-200 dark:bg-husk-100">
        {img && !broken ? (
          <img
            src={img}
            alt={cardLabel(item)}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageOff size={14} className="text-coconut-400 dark:text-sand-300" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-coconut-700 dark:text-sand-50">
          {cardLabel(item)}
        </div>
        <div className="truncate text-[11px] text-coconut-400 dark:text-sand-300">
          {item.card_set_id}
          {item.card_number ? `-${item.card_number}` : ''}
          {item.card_rarity ? ` · ${item.card_rarity}` : ''}
        </div>
      </div>
      {editable ? (
        <QuantityStepper
          qty={qty}
          label={cardLabel(item)}
          onChange={onChangeQuantity}
        />
      ) : (
        <span className="shrink-0 text-xs text-coconut-500 dark:text-sand-300" aria-label="Owned quantity">
          {qty}x
        </span>
      )}
      {item.price_snapshot != null && (
        <span className="w-16 shrink-0 text-right text-xs font-medium text-palm-600 dark:text-palm-200">
          {formatMoney(item.price_snapshot, 'USD')}
        </span>
      )}
    </li>
  )
}

/** The −/+ owned-quantity control for one card (#769). Floored at 1 — removing
 *  the last copy is a separate delete, not a zero here. */
function QuantityStepper({
  qty,
  label,
  onChange,
}: {
  qty: number
  label: string
  onChange: (next: number) => void
}) {
  const btn =
    'flex h-6 w-6 items-center justify-center rounded text-coconut-500 hover:bg-sand-200 disabled:opacity-40 disabled:hover:bg-transparent dark:text-sand-300 dark:hover:bg-husk-100'
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        disabled={qty <= 1}
        aria-label={`Decrease quantity of ${label}`}
        className={btn}
      >
        <Minus size={13} />
      </button>
      <span
        className="min-w-[1.5rem] text-center text-xs font-medium tabular-nums text-coconut-700 dark:text-sand-50"
        aria-label={`Owned quantity of ${label}`}
      >
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        aria-label={`Increase quantity of ${label}`}
        className={btn}
      >
        <Plus size={13} />
      </button>
    </div>
  )
}
