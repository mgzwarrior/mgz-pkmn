/**
 * CollectionInsights — the aggregate "your collection at a glance"
 * dashboard (#575). Opens from the header of
 * [LibraryBindersTab](./LibraryBindersTab.tsx).
 *
 * Reads one rollup from `GET /collections/insights`: headline totals, the
 * top types / rarities / sets as bars, the most valuable cards plus value
 * broken down by set and by binder (#741), a vendor-facing duplicates view
 * (multiples + cards spanning more than one binder), and a quiet cleanup
 * nudge for want-list cards you already own. Value-over-time is deliberately
 * out — that chart needs the `collection_snapshots` writer (#508), which
 * hasn't landed.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { BarChart3, Copy, Gem, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  fetchCollectionInsights,
  type CollectionInsights as Insights,
  type LabeledCount,
  type LabeledValue,
} from '../api/client'
import { formatMoney } from '../utils/format'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function cardRef(setId: string | null, number: string | null): string {
  return `${setId ?? ''}${number ? `-${number}` : ''}`
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-sand-200 bg-sand-50 px-3 py-2 dark:border-husk-100 dark:bg-husk-100">
      <div className="text-xl font-semibold tabular-nums text-coconut-700 dark:text-sand-50">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-coconut-400 dark:text-sand-300">
        {label}
      </div>
    </div>
  )
}

/** A top-N breakdown as horizontal bars, widths relative to the group max. */
function BarList({ title, items }: { title: string; items: LabeledCount[] }) {
  if (items.length === 0) return null
  const max = Math.max(...items.map((i) => i.count))
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
        {title}
      </h3>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li
            key={i.label}
            className="grid grid-cols-[5.5rem_1fr_1.75rem] items-center gap-2 text-xs"
          >
            <span className="truncate text-coconut-600 dark:text-sand-200" title={i.label}>
              {i.label}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-sand-200 dark:bg-husk-200">
              <div
                className="h-full rounded-full bg-palm-500"
                style={{ width: `${Math.max((i.count / max) * 100, 4)}%` }}
              />
            </div>
            <span className="text-right tabular-nums text-coconut-400 dark:text-sand-300">
              {i.count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A top-N value breakdown as horizontal bars, widths relative to the group
 * max. Mirrors {@link BarList} but the trailing figure is money, not a count. */
function ValueBarList({ title, items }: { title: string; items: LabeledValue[] }) {
  if (items.length === 0) return null
  const max = Math.max(...items.map((i) => i.value))
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
        {title}
      </h3>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li
            key={i.label}
            className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2 text-xs"
          >
            <span className="truncate text-coconut-600 dark:text-sand-200" title={i.label}>
              {i.label}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-sand-200 dark:bg-husk-200">
              <div
                className="h-full rounded-full bg-sun-500"
                style={{ width: `${Math.max((i.value / max) * 100, 4)}%` }}
              />
            </div>
            <span className="text-right tabular-nums text-coconut-400 dark:text-sand-300">
              {formatMoney(i.value)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The collection's "crown jewels" — owned cards ranked by per-copy price. */
function TopValueCards({ data }: { data: Insights }) {
  const cards = data.top_value_cards
  if (cards.length === 0) return null
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
        <Gem size={12} /> Most valuable cards
      </h3>
      <ul className="mt-2 divide-y divide-sand-200 dark:divide-husk-100">
        {cards.map((c, idx) => (
          <li
            key={`${c.card_set_id}-${c.card_number}-${idx}`}
            className="flex items-center justify-between gap-2 py-1.5 text-xs"
          >
            <span className="min-w-0 truncate text-coconut-700 dark:text-sand-50">
              {c.card_name ?? cardRef(c.card_set_id, c.card_number)}
            </span>
            <span className="shrink-0 tabular-nums font-medium text-coconut-600 dark:text-sand-200">
              {formatMoney(c.price)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DuplicatesSection({ data }: { data: Insights }) {
  const { duplicate_multiples: multiples, cross_collection: cross } = data
  if (multiples.length === 0 && cross.length === 0) return null
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
        <Copy size={12} /> Duplicates
      </h3>
      {multiples.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-coconut-500 dark:text-sand-300">
            More than one copy
          </div>
          <ul className="divide-y divide-sand-200 dark:divide-husk-100">
            {multiples.map((d, idx) => (
              <li
                key={`${d.card_set_id}-${d.card_number}-${d.collection_name}-${idx}`}
                className="flex items-center justify-between gap-2 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate text-coconut-700 dark:text-sand-50">
                  {d.card_name ?? cardRef(d.card_set_id, d.card_number)}
                  <span className="ml-1.5 text-[11px] text-coconut-400 dark:text-sand-300">
                    {d.collection_name}
                  </span>
                </span>
                <span className="shrink-0 rounded bg-sand-200 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-coconut-600 dark:bg-husk-100 dark:text-sand-200">
                  {d.quantity}x
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cross.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-coconut-500 dark:text-sand-300">
            In more than one binder
          </div>
          <ul className="divide-y divide-sand-200 dark:divide-husk-100">
            {cross.map((d, idx) => (
              <li
                key={`${d.card_set_id}-${d.card_number}-${idx}`}
                className="flex items-center justify-between gap-2 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate text-coconut-700 dark:text-sand-50">
                  {d.card_name ?? cardRef(d.card_set_id, d.card_number)}
                </span>
                <span className="shrink-0 truncate text-[11px] text-coconut-400 dark:text-sand-300">
                  {d.collections.join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function AlreadyOwnedSection({ data }: { data: Insights }) {
  const nudges = data.already_owned_chasing
  if (nudges.length === 0) return null
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-coconut-400 dark:text-sand-300">
        <Sparkles size={12} /> Already in a binder
      </h3>
      <p className="mb-2 mt-1 text-[11px] text-coconut-500 dark:text-sand-300">
        These cards are on a wishlist but you already own them — clear them off when you get a
        chance.
      </p>
      <ul className="divide-y divide-sand-200 dark:divide-husk-100">
        {nudges.map((n, idx) => (
          <li
            key={`${n.wishlist_id}-${n.card_set_id}-${n.card_number}-${idx}`}
            className="flex items-center justify-between gap-2 py-1.5 text-xs"
          >
            <span className="min-w-0 truncate text-coconut-700 dark:text-sand-50">
              {n.card_name ?? cardRef(n.card_set_id, n.card_number)}
              <span className="ml-1.5 text-[11px] text-coconut-400 dark:text-sand-300">
                {n.wishlist_name}
              </span>
            </span>
            <span className="shrink-0 truncate text-[11px] text-coconut-400 dark:text-sand-300">
              {n.collections.join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CollectionInsights({ open, onOpenChange }: Props) {
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setData(null)
      setError(null)
      setLoading(true)
      try {
        const resolved = await fetchCollectionInsights()
        if (!cancelled) setData(resolved)
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
  }, [open])

  const empty = data !== null && data.totals.unique_cards === 0

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <div className="flex min-w-0 items-center gap-2">
              <BarChart3 size={18} className="shrink-0 text-coconut-600 dark:text-sand-200" />
              <Dialog.Title className="truncate text-lg font-semibold text-coconut-700 dark:text-sand-50">
                Collection insights
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
            Headline totals, top types, rarities and sets, your most valuable cards, value by set
            and binder, duplicates, and wishlist cards you already own, across all your
            collections.
          </Dialog.Description>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-coconut-400 dark:text-sand-300">
                <Loader2 size={14} className="animate-spin" />
                Crunching your collections…
              </div>
            ) : error ? (
              <div role="alert" className="text-xs text-sun-600 dark:text-sun-300">
                {error}
              </div>
            ) : empty ? (
              <p className="text-xs text-coconut-500 dark:text-sand-300">
                No collection data yet. Add cards to a collection — click the book icon on a
                matched row — and your stats will show up here.
              </p>
            ) : data ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Collections" value={String(data.totals.collections)} />
                  <StatTile label="Unique cards" value={String(data.totals.unique_cards)} />
                  <StatTile label="Total copies" value={String(data.totals.total_quantity)} />
                  <StatTile label="Est. value" value={formatMoney(data.totals.estimated_value)} />
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <BarList title="Top types" items={data.top_types} />
                  <BarList title="Top rarities" items={data.top_rarities} />
                  <BarList title="Top sets" items={data.top_sets} />
                </div>

                <TopValueCards data={data} />

                <div className="grid gap-5 sm:grid-cols-2">
                  <ValueBarList title="Value by set" items={data.value_by_set} />
                  <ValueBarList title="Value by binder" items={data.value_by_collection} />
                </div>

                <DuplicatesSection data={data} />
                <AlreadyOwnedSection data={data} />
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
