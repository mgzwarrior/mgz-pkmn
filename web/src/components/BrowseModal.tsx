/**
 * BrowseModal — explore Pokémon TCG cards by set without typing a list.
 *
 * Two-view dialog:
 *
 *   1. **Set list** — every set grouped by series (newest-first), each
 *      row shows the cached logo + name + release year + card count.
 *      Picking a set transitions to view 2.
 *   2. **Set detail** — a responsive grid of every card in the chosen
 *      set, with thumb / name / number / rarity / market price. The user
 *      can search within the set, sort, filter by rarity bucket, and
 *      either click an individual card to push it into the InputEditor
 *      or bulk-add holos / rares / everything.
 *
 * The card list comes from `GET /api/v1/sets/{id}/cards` which returns
 * a trimmed payload (see `api/routes/sets.py:_trim_card`) and ships a
 * 1-day `Cache-Control` so re-opens within a prep session never hit
 * the upstream API. Combined with the per-set on-disk cache one level
 * down, the second open of any set is effectively instant.
 *
 * "Add to list" pushes lines into Zustand via `appendInputLines`,
 * which dedupes against existing input — clicking the same card twice
 * doesn't double-stamp it. We keep the modal open after adding so the
 * user can continue grazing the same set; the InputEditor reflects
 * updates immediately because it reads from the same store.
 */
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowLeft,
  ImageOff,
  Library,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchSetCards, fetchSets, setLogoUrl } from '../api/client'
import { useAppStore } from '../store'
import type { SetCard, SetInfo } from '../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SeriesGroup {
  series: string
  sets: SetInfo[]
}

// Mirrors SetPickerModal — the catalog comes back oldest → newest from
// `/api/v1/sets`, and the UX bias is newest-first because prep flows
// almost always start with the current block. Walking in reverse means
// both group order and per-group order land newest-first in one pass.
const OTHER_SERIES = 'Other'

function seriesKey(set: SetInfo): string {
  return set.series || OTHER_SERIES
}

function groupBySeries(sets: SetInfo[]): SeriesGroup[] {
  const order: string[] = []
  const buckets = new Map<string, SetInfo[]>()
  for (let i = sets.length - 1; i >= 0; i--) {
    const s = sets[i]
    const key = seriesKey(s)
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(s)
  }
  return order.map((series) => ({ series, sets: buckets.get(series)! }))
}

function releaseYear(date: string): string | null {
  const match = /^(\d{4})/.exec(date || '')
  return match ? match[1] : null
}

// ---------------------------------------------------------------------------
// Rarity bucketing for the in-set filter chips.
//
// pokemontcg.io's `rarity` field is a free-form string with dozens of
// values across eras ("Rare Holo", "Rare Ultra", "Amazing Rare",
// "Radiant Rare", "Trainer Gallery Rare Holo", ...). Rather than
// enumerate every spelling, we bucket by substring match — case
// insensitive — which captures the eras the user actually cares about
// when scanning a set ("show me only the chase cards").
// ---------------------------------------------------------------------------

type RarityBucket = 'all' | 'holo' | 'rare' | 'ultra'

function inBucket(card: SetCard, bucket: RarityBucket): boolean {
  if (bucket === 'all') return true
  const rarity = (card.rarity || '').toLowerCase()
  if (bucket === 'holo') return rarity.includes('holo')
  if (bucket === 'ultra') {
    return (
      rarity.includes('ultra') ||
      rarity.includes('secret') ||
      rarity.includes('rainbow') ||
      rarity.includes('hyper') ||
      rarity.includes('illustration')
    )
  }
  if (bucket === 'rare') return rarity.includes('rare')
  return true
}

// ---------------------------------------------------------------------------
// Sort options. Default is "Number" so cards land in collector order — the
// canonical way a binder is read. Price-desc is the chase view.
// ---------------------------------------------------------------------------

type CardSort = 'number' | 'name' | 'price-desc'

function compareCards(a: SetCard, b: SetCard, sort: CardSort): number {
  if (sort === 'name') return (a.name || '').localeCompare(b.name || '')
  if (sort === 'price-desc') {
    const am = a.market ?? -Infinity
    const bm = b.market ?? -Infinity
    return bm - am
  }
  // number: split off any "/total" suffix and compare numerically when
  // both sides parse, otherwise fall back to string compare so sets
  // with alpha-suffixed numbers (e.g. "TG01", "SV01") still sort sanely.
  const an = parseInt((a.number || '').split('/')[0], 10)
  const bn = parseInt((b.number || '').split('/')[0], 10)
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
  return (a.number || '').localeCompare(b.number || '')
}

// ---------------------------------------------------------------------------
// Add-to-list line format mirrors the parser's canonical
// `Name | Set Name | Number` shape (see src/mgz_pkmn/parser.py:228).
// ---------------------------------------------------------------------------

function toInputLine(card: SetCard, set: SetInfo): string {
  return `${card.name} | ${set.name} | ${card.number}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BrowseModal({ open, onOpenChange }: Props) {
  const { settings, appendInputLines } = useAppStore()

  const [sets, setSets] = useState<SetInfo[] | null>(null)
  const [setsError, setSetsError] = useState<string | null>(null)
  const [activeSet, setActiveSet] = useState<SetInfo | null>(null)
  const [cards, setCards] = useState<SetCard[] | null>(null)
  const [cardsError, setCardsError] = useState<string | null>(null)
  const [cardsLoading, setCardsLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [bucket, setBucket] = useState<RarityBucket>('all')
  const [sort, setSort] = useState<CardSort>('number')
  const [addedCount, setAddedCount] = useState<number | null>(null)

  // Reset transient view state whenever the modal becomes visible. We
  // deliberately keep `sets` mounted across open/close so a re-open is
  // free — the catalog won't have moved between opens. The
  // set-state-in-effect disable is documented as the right tool for
  // reacting to a prop transition.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return
    setActiveSet(null)
    setCards(null)
    setCardsError(null)
    setSearch('')
    setBucket('all')
    setSort('number')
    setAddedCount(null)
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Lazy-load the set catalog on first open.
  useEffect(() => {
    if (!open || sets !== null) return
    let cancelled = false
    void (async () => {
      setSetsError(null)
      try {
        const data = await fetchSets(settings.apiKey || undefined)
        if (!cancelled) setSets(data)
      } catch (err) {
        if (!cancelled) setSetsError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, sets, settings.apiKey])

  // Load the in-set card list whenever the user picks a set. The
  // backend caches the response for a day in the browser, so flipping
  // back and forth between two sets repeatedly is free after the first
  // visit to each. The loading/error/cards resets live inside the async
  // `load` callback rather than directly in the effect body so we don't
  // trip `react-hooks/set-state-in-effect` — the async function still
  // runs synchronously up to the first await, so the observable order
  // is identical.
  useEffect(() => {
    if (!activeSet) return
    let cancelled = false
    const load = async () => {
      setCardsLoading(true)
      setCardsError(null)
      setCards(null)
      try {
        const data = await fetchSetCards(activeSet.id, settings.apiKey || undefined)
        if (!cancelled) setCards(data)
      } catch (err) {
        if (!cancelled) setCardsError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setCardsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activeSet, settings.apiKey])

  const groups = useMemo(() => (sets ? groupBySeries(sets) : []), [sets])

  const filteredCards = useMemo(() => {
    if (!cards) return []
    const term = search.trim().toLowerCase()
    const out = cards.filter((c) => {
      if (!inBucket(c, bucket)) return false
      if (!term) return true
      return (
        (c.name || '').toLowerCase().includes(term) ||
        (c.number || '').toLowerCase().includes(term) ||
        (c.rarity || '').toLowerCase().includes(term)
      )
    })
    out.sort((a, b) => compareCards(a, b, sort))
    return out
  }, [cards, search, bucket, sort])

  function addCards(toAdd: SetCard[]) {
    if (!activeSet || toAdd.length === 0) return
    appendInputLines(toAdd.map((c) => toInputLine(c, activeSet)))
    setAddedCount(toAdd.length)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby="browse-description"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(1100px,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
            <div className="flex items-center gap-2">
              {activeSet && (
                <button
                  type="button"
                  onClick={() => setActiveSet(null)}
                  aria-label="Back to set list"
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <Library size={18} className="text-zinc-300" />
              <Dialog.Title className="text-lg font-semibold text-zinc-100">
                {activeSet ? activeSet.name : 'Browse sets'}
              </Dialog.Title>
              {activeSet && (
                <span className="text-xs text-zinc-500">
                  {activeSet.series}
                  {releaseYear(activeSet.releaseDate)
                    ? ` · ${releaseYear(activeSet.releaseDate)}`
                    : ''}
                </span>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>

          <Dialog.Description
            id="browse-description"
            className="px-5 pt-3 text-sm text-zinc-400"
          >
            {activeSet
              ? 'Click a card to add it to your input list, or use the bulk actions below.'
              : 'Pick a set to see every card with its market price, sortable and filterable.'}
          </Dialog.Description>

          {activeSet ? (
            <SetDetailView
              cards={filteredCards}
              total={cards?.length ?? 0}
              loading={cardsLoading}
              error={cardsError}
              search={search}
              onSearch={setSearch}
              bucket={bucket}
              onBucket={setBucket}
              sort={sort}
              onSort={setSort}
              addedCount={addedCount}
              onAddCards={addCards}
              onAddAll={() => addCards(filteredCards)}
              onAddHolos={() =>
                addCards(filteredCards.filter((c) => inBucket(c, 'holo')))
              }
              onAddRares={() =>
                addCards(filteredCards.filter((c) => inBucket(c, 'rare')))
              }
            />
          ) : (
            <SetListView
              sets={sets}
              groups={groups}
              error={setsError}
              onPick={(s) => setActiveSet(s)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------------------------------------------------------------------------
// Set-list view
// ---------------------------------------------------------------------------

interface SetListProps {
  sets: SetInfo[] | null
  groups: SeriesGroup[]
  error: string | null
  onPick: (set: SetInfo) => void
}

function SetListView({ sets, groups, error, onPick }: SetListProps) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-3">
      {error && (
        <p className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          Couldn’t load sets: {error}
        </p>
      )}
      {!sets && !error && (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 size={14} className="animate-spin" />
          Loading set catalog…
        </p>
      )}
      {sets && (
        <ul className="space-y-4">
          {groups.map((group) => (
            <li key={group.series}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                {group.series}
                <span className="ml-1 font-normal normal-case tracking-normal text-zinc-500">
                  ({group.sets.length})
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {group.sets.map((s) => (
                  <SetTile key={s.id} set={s} onPick={() => onPick(s)} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SetTile({ set, onPick }: { set: SetInfo; onPick: () => void }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const year = releaseYear(set.releaseDate)
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-left hover:border-zinc-700 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-700"
      >
        <div className="flex h-10 w-14 flex-none items-center justify-center rounded bg-zinc-950">
          {logoFailed ? (
            <ImageOff size={16} className="text-zinc-600" aria-hidden />
          ) : (
            <img
              src={setLogoUrl(set.id)}
              alt=""
              className="max-h-9 max-w-12 object-contain"
              loading="lazy"
              onError={() => setLogoFailed(true)}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">
            {set.name}
          </div>
          <div className="truncate text-xs text-zinc-500">
            {year || '—'} · {set.total ? `${set.total} cards` : 'count unknown'}
          </div>
        </div>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Set-detail view
// ---------------------------------------------------------------------------

interface SetDetailProps {
  cards: SetCard[]
  total: number
  loading: boolean
  error: string | null
  search: string
  onSearch: (v: string) => void
  bucket: RarityBucket
  onBucket: (b: RarityBucket) => void
  sort: CardSort
  onSort: (s: CardSort) => void
  addedCount: number | null
  onAddCards: (cards: SetCard[]) => void
  onAddAll: () => void
  onAddHolos: () => void
  onAddRares: () => void
}

const BUCKETS: { value: RarityBucket; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'rare', label: 'Rares' },
  { value: 'holo', label: 'Holos' },
  { value: 'ultra', label: 'Ultra+' },
]

const SORT_OPTIONS: { value: CardSort; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'name', label: 'Name' },
  { value: 'price-desc', label: 'Price ↓' },
]

function SetDetailView({
  cards,
  total,
  loading,
  error,
  search,
  onSearch,
  bucket,
  onBucket,
  sort,
  onSort,
  addedCount,
  onAddCards,
  onAddAll,
  onAddHolos,
  onAddRares,
}: SetDetailProps) {
  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-5 py-3">
        <label className="relative flex-1 min-w-[180px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search this set…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 py-1.5 pl-8 pr-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
            aria-label="Search cards in this set"
          />
        </label>
        <div className="flex items-center gap-1" role="group" aria-label="Rarity filter">
          {BUCKETS.map((b) => (
            <Chip key={b.value} active={bucket === b.value} onClick={() => onBucket(b.value)}>
              {b.label}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          Sort
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as CardSort)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            aria-label="Sort cards"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Bulk-action toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-5 py-2 text-xs text-zinc-400">
        <span>
          {cards.length} of {total} card{total === 1 ? '' : 's'}
        </span>
        <span className="text-zinc-600">·</span>
        <BulkButton onClick={onAddAll}>Add all visible</BulkButton>
        <BulkButton onClick={onAddHolos}>Add holos</BulkButton>
        <BulkButton onClick={onAddRares}>Add rares</BulkButton>
        {addedCount != null && (
          <span className="ml-auto text-emerald-400" role="status">
            Added {addedCount} line{addedCount === 1 ? '' : 's'} to your list
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {error && (
          <p className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            Couldn’t load cards: {error}
          </p>
        )}
        {loading && !error && (
          <p className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 size={14} className="animate-spin" />
            Loading cards…
          </p>
        )}
        {!loading && !error && cards.length === 0 && (
          <p className="text-sm text-zinc-500">No cards match your filters.</p>
        )}
        {!loading && !error && cards.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {cards.map((c) => (
              <CardTile key={c.id} card={c} onAdd={() => onAddCards([c])} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function CardTile({ card, onAdd }: { card: SetCard; onAdd: () => void }) {
  const [thumbFailed, setThumbFailed] = useState(false)
  return (
    <li className="group flex flex-col rounded-md border border-zinc-800 bg-zinc-950/40 p-2 text-left hover:border-zinc-700 hover:bg-zinc-900">
      <div className="relative aspect-[245/342] w-full overflow-hidden rounded bg-zinc-950">
        {card.thumb && !thumbFailed ? (
          <img
            src={card.thumb}
            alt={card.name}
            className="h-full w-full object-contain"
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-700">
            <ImageOff size={28} aria-hidden />
          </div>
        )}
      </div>
      <div className="mt-2 min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-100" title={card.name}>
          {card.name}
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>#{card.number}</span>
          {card.market != null && (
            <span className="text-emerald-400">${card.market.toFixed(2)}</span>
          )}
        </div>
        {card.rarity && (
          <div className="truncate text-[11px] text-zinc-500">{card.rarity}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 flex items-center justify-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:border-emerald-700 hover:bg-emerald-900/30 hover:text-emerald-300"
        aria-label={`Add ${card.name} to list`}
      >
        <Plus size={12} />
        Add to list
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Shared small bits
// ---------------------------------------------------------------------------

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
        active
          ? 'border-blue-700 bg-blue-900/40 text-blue-200'
          : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
      }`}
    >
      {children}
    </button>
  )
}

function BulkButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
    >
      {children}
    </button>
  )
}
