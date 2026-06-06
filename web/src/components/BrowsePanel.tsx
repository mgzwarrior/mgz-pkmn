/**
 * BrowsePanel — the inline "browse cards by set" view, shared between
 * the dedicated browse tab in App.tsx and the BrowseModal overlay.
 * State + effects live in [useBrowseController](./useBrowseController.ts)
 * so both surfaces stay in sync without lifting state into App.
 */
import { ArrowLeft, ImageOff, Library, Loader2, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { setLogoUrl } from '../api/client'
import type { SetCard, SetInfo } from '../types'
import type {
  BrowseController,
  CardSort,
  RarityBucket,
  SeriesGroup,
} from './useBrowseController'

function releaseYear(date: string): string | null {
  const match = /^(\d{4})/.exec(date || '')
  return match ? match[1] : null
}

interface BrowsePanelProps {
  controller: BrowseController
  // When true, render chrome that fits inside a Dialog (no outer card
  // frame). Use the `titleSlot` / `closeSlot` hooks to inject the
  // Radix-required Dialog.Title and a close affordance.
  inDialog?: boolean
  titleSlot?: ReactNode
  closeSlot?: ReactNode
  descriptionId?: string
}

export function BrowsePanel({
  controller,
  inDialog = false,
  titleSlot,
  closeSlot,
  descriptionId,
}: BrowsePanelProps) {
  const {
    groups,
    activeSet,
    setActiveSet,
    cards,
    filteredCards,
    cardsLoading,
    cardsError,
    search,
    setSearch,
    bucket,
    setBucket,
    sort,
    setSort,
    addedCount,
    addCards,
    addAll,
    addHolos,
    addRares,
  } = controller

  const headerTitle = activeSet ? activeSet.name : 'Browse sets'
  const description = activeSet
    ? 'Click a card to add it to your input list, or use the bulk actions below.'
    : 'Pick a set to see every card with its market price, sortable and filterable.'

  const wrapperClass = inDialog
    ? 'flex flex-1 flex-col overflow-hidden'
    : 'flex flex-col overflow-hidden rounded-lg border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 shadow-sm'

  return (
    <div className={wrapperClass}>
      <header className="flex items-center justify-between gap-3 border-b border-sand-200 dark:border-husk-100 px-5 py-4">
        <div className="flex items-center gap-2">
          {activeSet && (
            <button
              type="button"
              onClick={() => setActiveSet(null)}
              aria-label="Back to set list"
              className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-700 dark:hover:text-sand-50"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <Library size={18} className="text-coconut-600 dark:text-sand-200" />
          {titleSlot ?? (
            <h2 className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
              {headerTitle}
            </h2>
          )}
          {activeSet && (
            <span className="text-xs text-coconut-400 dark:text-sand-400">
              {activeSet.series}
              {releaseYear(activeSet.releaseDate)
                ? ` · ${releaseYear(activeSet.releaseDate)}`
                : ''}
            </span>
          )}
        </div>
        {closeSlot}
      </header>

      <p
        id={descriptionId}
        className="px-5 pt-3 text-sm text-coconut-400 dark:text-sand-300"
      >
        {description}
      </p>

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
          onAddAll={addAll}
          onAddHolos={addHolos}
          onAddRares={addRares}
        />
      ) : (
        <SetListView groups={groups} onPick={(s) => setActiveSet(s)} />
      )}
    </div>
  )
}

interface SetListProps {
  groups: SeriesGroup[]
  onPick: (set: SetInfo) => void
}

function SetListView({ groups, onPick }: SetListProps) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-3">
      <ul className="space-y-4">
        {groups.map((group) => (
          <li key={group.series}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-coconut-600 dark:text-sand-200">
              {group.series}
              <span className="ml-1 font-normal normal-case tracking-normal text-coconut-400 dark:text-sand-400">
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
        className="flex w-full items-center gap-3 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400/40 px-3 py-2 text-left hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-50 dark:hover:bg-husk-200 focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
      >
        <div className="flex h-10 w-14 flex-none items-center justify-center rounded bg-sand-50 dark:bg-husk-400">
          {logoFailed ? (
            <ImageOff size={16} className="text-coconut-300 dark:text-sand-500" aria-hidden />
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
          <div className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50">
            {set.name}
          </div>
          <div className="truncate text-xs text-coconut-400 dark:text-sand-400">
            {year || '—'} · {set.total ? `${set.total} cards` : 'count unknown'}
          </div>
        </div>
      </button>
    </li>
  )
}

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
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 dark:border-husk-100 px-5 py-3">
        <label className="relative flex-1 min-w-[180px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-coconut-400 dark:text-sand-400"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search this set…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 py-1.5 pl-8 pr-2 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:placeholder:text-sand-400 focus:border-sand-400 dark:focus:border-coconut-400 focus:outline-none"
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
        <label className="flex items-center gap-1 text-xs text-coconut-400 dark:text-sand-300">
          Sort
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as CardSort)}
            className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 px-2 py-1 text-sm text-coconut-700 dark:text-sand-50 focus:border-sand-400 dark:focus:border-coconut-400 focus:outline-none"
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

      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 dark:border-husk-100 px-5 py-2 text-xs text-coconut-400 dark:text-sand-300">
        <span>
          {cards.length} of {total} card{total === 1 ? '' : 's'}
        </span>
        <span className="text-coconut-300 dark:text-sand-500">·</span>
        <BulkButton onClick={onAddAll}>Add all visible</BulkButton>
        <BulkButton onClick={onAddHolos}>Add holos</BulkButton>
        <BulkButton onClick={onAddRares}>Add rares</BulkButton>
        {addedCount != null && (
          <span className="ml-auto text-palm-500 dark:text-palm-200" role="status">
            Added {addedCount} line{addedCount === 1 ? '' : 's'} to your list
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {error && (
          <p className="rounded border border-ember-500/40 dark:border-ember-500/50 bg-ember-500/10 dark:bg-ember-500/30 px-3 py-2 text-sm text-ember-400 dark:text-ember-300">
            Couldn’t load cards: {error}
          </p>
        )}
        {loading && !error && (
          <p className="flex items-center gap-2 text-sm text-coconut-400 dark:text-sand-300">
            <Loader2 size={14} className="animate-spin" />
            Loading cards…
          </p>
        )}
        {!loading && !error && cards.length === 0 && (
          <p className="text-sm text-coconut-400 dark:text-sand-400">No cards match your filters.</p>
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
    <li className="group flex flex-col rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400/40 p-2 text-left hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-50 dark:hover:bg-husk-200">
      <div className="relative aspect-[245/342] w-full overflow-hidden rounded bg-sand-50 dark:bg-husk-400">
        {card.thumb && !thumbFailed ? (
          <img
            src={card.thumb}
            alt={card.name}
            className="h-full w-full object-contain"
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-coconut-700 dark:text-sand-200">
            <ImageOff size={28} aria-hidden />
          </div>
        )}
      </div>
      <div className="mt-2 min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50" title={card.name}>
          {card.name}
        </div>
        <div className="flex items-center justify-between text-xs text-coconut-400 dark:text-sand-400">
          <span>#{card.number}</span>
          {card.market != null && (
            <span className="text-palm-500 dark:text-palm-200">${card.market.toFixed(2)}</span>
          )}
        </div>
        {card.rarity && (
          <div className="truncate text-[11px] text-coconut-400 dark:text-sand-400">{card.rarity}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 flex items-center justify-center gap-1 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2 py-1 text-xs text-coconut-600 dark:text-sand-200 hover:border-palm-400 dark:hover:border-palm-500 hover:bg-palm-100 dark:hover:bg-palm-500/30 hover:text-palm-400 dark:hover:text-palm-100"
        aria-label={`Add ${card.name} to list`}
      >
        <Plus size={12} />
        Add to list
      </button>
    </li>
  )
}

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
          ? 'border-palm-400 dark:border-sun-400 bg-sun-400/15 dark:bg-sun-400/40 text-palm-700 dark:text-sun-100'
          : 'border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 text-coconut-600 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100'
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
      className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2 py-1 text-xs text-coconut-600 dark:text-sand-200 hover:bg-sand-200 dark:hover:bg-husk-100"
    >
      {children}
    </button>
  )
}
