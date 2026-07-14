/**
 * BinderDetail - a physical-binder spread view (#743).
 *
 * A binder is the organized "I have" surface: it reads the collections filed
 * into a real binder, preserves that order, expands collection quantities into
 * occupied pockets, and hands those same rows to ExportBar.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { BookOpen, ChevronLeft, ChevronRight, ImageOff, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  fetchBinder,
  fetchCollection,
  type BinderFormat,
  type BinderSummary,
  type CollectionItem,
} from '../api/client'
import { formatMoney } from '../utils/format'
import { BINDER_TYPE_OPTIONS, coverSwatch } from './binderIdentity'
import { ExportBar } from './ExportBar'
import { InlineRenameTitle } from './InlineRenameTitle'
import { itemsToExportRows } from './exportRows'
import { detailDialogContentClass } from './responsiveDialog'
import { useBinders } from './useBinders'

interface Props {
  binder: BinderSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface OrderedItem {
  item: CollectionItem
  collectionName: string
}

interface BinderSlot {
  key: string
  item: CollectionItem
  collectionName: string
  copy: number
}

interface BinderLayout {
  cols: number
  rows: number
}

const LAYOUTS: Record<BinderFormat, BinderLayout> = {
  '4-pocket': { cols: 2, rows: 2 },
  '9-pocket': { cols: 3, rows: 3 },
  '12-pocket': { cols: 3, rows: 4 },
}

const DEFAULT_FORMAT: BinderFormat = '9-pocket'

function layoutFor(format: BinderFormat | null | undefined): BinderLayout {
  return LAYOUTS[format ?? DEFAULT_FORMAT] ?? LAYOUTS[DEFAULT_FORMAT]
}

function pageSize(layout: BinderLayout): number {
  return layout.cols * layout.rows
}

function spreadPages(spread: number, pageCount: number): number[] {
  if (spread <= 0) return [0]
  const first = 1 + (spread - 1) * 2
  return [first, first + 1].filter((page) => page < pageCount)
}

function maxSpreadFor(pageCount: number): number {
  if (pageCount <= 1) return 0
  return Math.ceil((pageCount - 1) / 2)
}

function cardImage(item: CollectionItem): string | undefined {
  if (item.card_image_url) return item.card_image_url
  const images = item.card.images as { small?: string; large?: string } | undefined
  return images?.small ?? images?.large
}

function cardLabel(item: CollectionItem): string {
  return item.card_name ?? (item.card.name as string | undefined) ?? 'Unknown card'
}

function cardRef(item: CollectionItem): string {
  return `${item.card_set_id ?? ''}${item.card_number ? `-${item.card_number}` : ''}`
}

function expandSlots(items: OrderedItem[]): BinderSlot[] {
  return items.flatMap(({ item, collectionName }) => {
    const copies = Math.max(1, item.quantity ?? 1)
    return Array.from({ length: copies }, (_, index) => ({
      key: `${item.id}-${index}`,
      item,
      collectionName,
      copy: index + 1,
    }))
  })
}

const BINDER_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  BINDER_TYPE_OPTIONS.map((o) => [o.value, o.label]),
)

export function BinderDetail({ binder, open, onOpenChange }: Props) {
  const { update } = useBinders()
  const [items, setItems] = useState<OrderedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [spread, setSpread] = useState(0)
  const [name, setName] = useState(binder?.name ?? '')
  const [syncedId, setSyncedId] = useState(binder?.id)

  if (binder?.id !== syncedId) {
    setSyncedId(binder?.id)
    setName(binder?.name ?? '')
    setSpread(0)
  }

  async function handleRename(next: string) {
    if (!binder) return
    const updated = await update(binder.id, { name: next })
    setName(updated.name)
  }

  useEffect(() => {
    if (!open || !binder) return
    let cancelled = false
    const load = async () => {
      setItems([])
      setError(null)
      setLoading(true)
      setSpread(0)
      try {
        const detail = await fetchBinder(binder.id)
        const collections = await Promise.all(
          detail.collections.map(async (c) => ({
            summary: c,
            detail: await fetchCollection(c.id),
          })),
        )
        if (!cancelled) {
          setName(detail.name)
          setItems(
            collections.flatMap(({ summary, detail: collection }) =>
              collection.items.map((item) => ({ item, collectionName: summary.name })),
            ),
          )
        }
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
  }, [open, binder])

  const layout = layoutFor(binder?.binder_format)
  const perPage = pageSize(layout)
  const slots = useMemo(() => expandSlots(items), [items])
  const totalPockets = Math.max(binder?.capacity ?? 0, slots.length, perPage)
  const pageCount = Math.max(1, Math.ceil(totalPockets / perPage))
  const maxSpread = maxSpreadFor(pageCount)
  const safeSpread = Math.min(spread, maxSpread)
  const pages = spreadPages(safeSpread, pageCount)
  const formatLabel = binder?.binder_format ?? DEFAULT_FORMAT
  const swatch = coverSwatch(binder?.binder_color)
  const exportRows = useMemo(() => itemsToExportRows(items.map((i) => i.item)), [items])
  const totalValue = items.reduce(
    (sum, { item }) => sum + (item.price_snapshot ?? 0) * Math.max(1, item.quantity ?? 1),
    0,
  )
  const storageLabel = binder?.binder_type ? BINDER_TYPE_LABELS[binder.binder_type] : null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content
          className={detailDialogContentClass('lg:max-h-[92vh] lg:w-[min(1120px,96vw)]')}
        >
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <div className="flex min-w-0 items-center gap-2">
              {binder?.binder_color ? (
                <span
                  className={`h-4 w-4 shrink-0 rounded-sm ${swatch.className}`}
                  style={swatch.style}
                  aria-hidden
                />
              ) : (
                <BookOpen size={18} className="shrink-0 text-coconut-600 dark:text-sand-200" />
              )}
              <InlineRenameTitle
                name={name}
                fallback="Binder"
                noun="binder"
                onRename={handleRename}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {exportRows.length > 0 && (
                <ExportBar rows={exportRows} title={name} showSetIdCards={false} />
              )}
              <Dialog.Close asChild>
                <button
                  aria-label="Close"
                  className="rounded p-1 text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
          </header>
          <Dialog.Description className="sr-only">
            Physical binder pages showing the owned cards filed into this binder.
          </Dialog.Description>

          <div className="flex-1 overflow-y-auto px-4 py-4 lg:overflow-hidden lg:px-5">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
                <Loader2 size={14} className="animate-spin" />
                Loading binder...
              </div>
            ) : error ? (
              <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">
                {error}
              </div>
            ) : slots.length === 0 ? (
              <div className="rounded-md border border-dashed border-sand-300 px-4 py-8 text-center dark:border-husk-100">
                <p className="text-sm text-coconut-600 dark:text-sand-200">No owned cards yet.</p>
                <p className="mt-1 text-xs text-coconut-400 dark:text-sand-300">
                  File a collection into this binder to fill its pages.
                </p>
              </div>
            ) : (
              <div className="flex min-h-full flex-col gap-3 lg:h-full lg:min-h-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-coconut-500 dark:text-sand-300">
                    <span className="rounded bg-sand-200 px-1.5 py-0.5 font-medium text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
                      {formatLabel}
                    </span>
                    {storageLabel && binder?.binder_type !== 'regular' && (
                      <span className="rounded bg-sand-200 px-1.5 py-0.5 font-medium text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
                        {storageLabel}
                      </span>
                    )}
                    <span className="tabular-nums">
                      {slots.length}
                      {binder?.capacity ? (
                        <span className="text-coconut-400 dark:text-sand-400">
                          {' '}
                          / {binder.capacity}
                        </span>
                      ) : null}{' '}
                      slots
                    </span>
                    {totalValue > 0 && (
                      <span className="text-palm-600 dark:text-palm-200">
                        {formatMoney(totalValue, 'USD')}
                      </span>
                    )}
                  </div>
                  <div className="inline-flex items-center rounded border border-sand-300 p-0.5 dark:border-husk-100">
                    <button
                      type="button"
                      onClick={() => setSpread((s) => Math.max(0, s - 1))}
                      disabled={safeSpread === 0}
                      aria-label="Previous pages"
                      title="Previous pages"
                      className="flex h-7 w-7 items-center justify-center rounded text-coconut-500 hover:bg-sand-200 disabled:opacity-40 disabled:hover:bg-transparent dark:text-sand-300 dark:hover:bg-husk-100"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span className="min-w-[5.5rem] px-2 text-center text-[11px] tabular-nums text-coconut-600 dark:text-sand-200">
                      {pages.length === 1
                        ? `Page ${pages[0] + 1}`
                        : `Pages ${pages[0] + 1}-${pages[1] + 1}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSpread((s) => Math.min(maxSpread, s + 1))}
                      disabled={safeSpread >= maxSpread}
                      aria-label="Next pages"
                      title="Next pages"
                      className="flex h-7 w-7 items-center justify-center rounded text-coconut-500 hover:bg-sand-200 disabled:opacity-40 disabled:hover:bg-transparent dark:text-sand-300 dark:hover:bg-husk-100"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>

                <div
                  className={`grid min-h-0 flex-1 gap-3 ${
                    pages.length === 1
                      ? 'lg:grid-cols-[minmax(0,640px)] lg:justify-center'
                      : 'lg:grid-cols-2'
                  }`}
                >
                  {pages.map((page) => (
                    <BinderPage
                      key={page}
                      page={page}
                      layout={layout}
                      slots={slots}
                      perPage={perPage}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function BinderPage({
  page,
  layout,
  slots,
  perPage,
}: {
  page: number
  layout: BinderLayout
  slots: BinderSlot[]
  perPage: number
}) {
  const start = page * perPage
  const pageSlots = Array.from({ length: perPage }, (_, index) => ({
    number: start + index + 1,
    slot: slots[start + index],
  }))
  return (
    <section
      aria-label={`Page ${page + 1}`}
      className="flex min-h-0 flex-col rounded-lg border border-sand-300 bg-sand-100 p-3 shadow-inner dark:border-husk-50 dark:bg-husk-300"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-coconut-700 dark:text-sand-50">
          Page {page + 1}
        </h3>
        <span className="text-[10px] tabular-nums text-coconut-400 dark:text-sand-400">
          {start + 1}-{start + perPage}
        </span>
      </div>
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        }}
      >
        {pageSlots.map(({ number, slot }) => (
          <BinderPocket key={number} slotNumber={number} slot={slot} />
        ))}
      </div>
    </section>
  )
}

function BinderPocket({ slotNumber, slot }: { slotNumber: number; slot?: BinderSlot }) {
  const [broken, setBroken] = useState(false)
  if (!slot) {
    return (
      <div
        aria-label={`Slot ${slotNumber}: empty`}
        className="flex min-h-[5.5rem] flex-col items-center justify-center rounded-md border border-dashed border-sand-300 bg-sand-50/60 text-[10px] tabular-nums text-coconut-300 dark:border-husk-100 dark:bg-husk-200/60 dark:text-sand-500"
      >
        {slotNumber}
      </div>
    )
  }

  const label = cardLabel(slot.item)
  const img = cardImage(slot.item)
  const ref = cardRef(slot.item)
  return (
    <article
      aria-label={`Slot ${slotNumber}: ${label}`}
      title={`${label}${ref ? ` (${ref})` : ''} - ${slot.collectionName}`}
      className="flex min-h-[5.5rem] flex-col rounded-md border border-sand-300 bg-sand-50 p-1 dark:border-husk-100 dark:bg-husk-200"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded bg-sand-200 dark:bg-husk-100">
        {img && !broken ? (
          <img
            src={img}
            alt={label}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageOff size={16} className="text-coconut-400 dark:text-sand-300" />
        )}
      </div>
      <div className="mt-1 min-w-0">
        <p className="truncate text-[10px] font-medium text-coconut-700 dark:text-sand-50">
          {label}
        </p>
        <p className="truncate text-[9px] tabular-nums text-coconut-400 dark:text-sand-300">
          #{slotNumber}
          {ref ? ` - ${ref}` : ''}
          {slot.item.quantity && slot.item.quantity > 1 ? ` (${slot.copy}/${slot.item.quantity})` : ''}
        </p>
      </div>
    </article>
  )
}
