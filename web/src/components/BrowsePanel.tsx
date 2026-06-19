/**
 * BrowsePanel — the inline "browse cards" view rendered by the Browse
 * discovery-mode tab in App.tsx. A view-mode toggle flips the whole panel
 * between two organisations (#577): **set view** (series → set → cards in
 * that set) and **pokedex view** (national dex # → every printing of one
 * Pokémon across every set). State + effects live in
 * [useBrowseController](./useBrowseController.ts).
 */
import { ArrowLeft, ImageOff, Library, Loader2, Search, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { pokemonSpriteUrl, setLogoUrl } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { PokedexCard, PokedexEntry, Row, SetCard, SetInfo } from '../types'
import { BinderModal, type BinderPrefill } from './BinderModal'
import { browseCardToPayload, browseCardToRow, type BrowseSetContext } from './browseCard'
import { CardDetailModal } from './CardDetailModal'
import { useCardOwnership } from './useCardOwnership'
import { OwnershipBadge } from './OwnershipBadge'
import { SaveCardActions } from './SaveCardActions'
import type { CardOwnership } from '../api/client'
import type {
  BrowseController,
  BrowseViewMode,
  CardSort,
  PokedexGroup,
  RarityBucket,
  SeriesGroup,
} from './useBrowseController'

function releaseYear(date: string): string | null {
  const match = /^(\d{4})/.exec(date || '')
  return match ? match[1] : null
}

interface BrowsePanelProps {
  controller: BrowseController
}

export function BrowsePanel({ controller }: BrowsePanelProps) {
  const {
    viewMode,
    setViewMode,
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
    addAll,
    addHolos,
    addRares,
    pokedexGroups,
    pokedexFilter,
    setPokedexFilter,
    activePokemon,
    setActivePokemon,
    pokedexCards,
    pokedexCardsLoading,
    pokedexCardsError,
    addAllPrintings,
  } = controller

  // Hoist the auth read here (not per tile) so the grid fires one `/me`
  // request, then pass the boolean down — tiles only care about "should I
  // render save buttons", matching ResultsTable's row pattern.
  const { user } = useAuth()
  const showSavedActions = user !== null

  // A fresh binder pre-anchored to the set you're walking (#682). Non-null
  // mounts the modal; closing clears it so the next open re-seeds cleanly.
  const [binderPrefill, setBinderPrefill] = useState<BinderPrefill | null>(null)

  const drilledIn = viewMode === 'set' ? !!activeSet : !!activePokemon
  const onBack = () =>
    viewMode === 'set' ? setActiveSet(null) : setActivePokemon(null)

  let headerTitle: string
  let description: string
  if (viewMode === 'set') {
    headerTitle = activeSet ? activeSet.name : 'Browse sets'
    description = activeSet
      ? 'Click a card for its details and comps, or use the bulk actions below to build your list.'
      : 'Pick a set to see every card with its market price, sortable and filterable.'
  } else {
    headerTitle = activePokemon
      ? `#${activePokemon.number} ${activePokemon.name}`
      : 'Browse by Pokédex #'
    description = activePokemon
      ? 'Every printing we found, newest first. Click a card for its details and comps.'
      : 'Pick a Pokémon to see every printing across every set, newest first.'
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-sand-200 dark:border-husk-100 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          {drilledIn && (
            <button
              type="button"
              onClick={onBack}
              aria-label={viewMode === 'set' ? 'Back to set list' : 'Back to Pokédex list'}
              className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-700 dark:hover:text-sand-50"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <Library size={18} className="text-coconut-600 dark:text-sand-200" />
          <h2 className="truncate text-lg font-semibold text-coconut-700 dark:text-sand-50">
            {headerTitle}
          </h2>
          {viewMode === 'set' && activeSet && (
            <span className="text-xs text-coconut-400 dark:text-sand-400">
              {activeSet.series}
              {releaseYear(activeSet.releaseDate)
                ? ` · ${releaseYear(activeSet.releaseDate)}`
                : ''}
            </span>
          )}
        </div>
        <div className="flex flex-none items-center gap-2">
          {viewMode === 'set' && activeSet && showSavedActions && (
            <button
              type="button"
              onClick={() =>
                setBinderPrefill({ name: activeSet.name, sourceSetId: activeSet.id })
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2.5 py-1 text-xs text-coconut-600 dark:text-sand-200 hover:bg-sand-50 dark:hover:bg-husk-200"
            >
              <Wallet size={14} />
              Create binder
            </button>
          )}
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
      </header>

      <p className="px-5 pt-3 text-sm text-coconut-400 dark:text-sand-300">
        {description}
      </p>

      {viewMode === 'set' ? (
        activeSet ? (
          <SetDetailView
            setInfo={activeSet}
            showSavedActions={showSavedActions}
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
            onAddAll={addAll}
            onAddHolos={addHolos}
            onAddRares={addRares}
          />
        ) : (
          <SetListView groups={groups} onPick={(s) => setActiveSet(s)} />
        )
      ) : activePokemon ? (
        <PokedexDetailView
          showSavedActions={showSavedActions}
          cards={pokedexCards}
          loading={pokedexCardsLoading}
          error={pokedexCardsError}
          addedCount={addedCount}
          onAddAll={addAllPrintings}
        />
      ) : (
        <PokedexListView
          groups={pokedexGroups}
          filter={pokedexFilter}
          onFilter={setPokedexFilter}
          onPick={(p) => setActivePokemon(p)}
        />
      )}

      {/* Mounted only while a prefill is set, so each open re-seeds the form
          from the current set via the modal's lazy initializers (#682). */}
      {binderPrefill && (
        <BinderModal
          open
          onOpenChange={(o) => {
            if (!o) setBinderPrefill(null)
          }}
          prefill={binderPrefill}
        />
      )}
    </div>
  )
}

const VIEW_MODES: { value: BrowseViewMode; label: string }[] = [
  { value: 'set', label: 'By set' },
  { value: 'pokedex', label: 'By Pokédex #' },
]

function ViewModeToggle({
  value,
  onChange,
}: {
  value: BrowseViewMode
  onChange: (m: BrowseViewMode) => void
}) {
  return (
    <div
      className="flex flex-none items-center gap-1 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 p-0.5"
      role="group"
      aria-label="Browse organisation"
    >
      {VIEW_MODES.map((m) => {
        const active = value === m.value
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange(m.value)}
            aria-pressed={active}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              active
                ? 'bg-sand-50 dark:bg-husk-400 text-coconut-700 dark:text-sand-50 shadow-sm'
                : 'text-coconut-600 dark:text-sand-300 hover:text-coconut-700 dark:hover:text-sand-50'
            }`}
          >
            {m.label}
          </button>
        )
      })}
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
  setInfo: SetInfo
  showSavedActions: boolean
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
  setInfo,
  showSavedActions,
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
  onAddAll,
  onAddHolos,
  onAddRares,
}: SetDetailProps) {
  // Index into the displayed `cards` for the open detail modal; `null`
  // keeps it closed. Tracking the index (not the card) keeps ←/→ modal
  // navigation synced with the live filter + sort.
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const setCtx: BrowseSetContext = {
    id: setInfo.id,
    name: setInfo.name,
    series: setInfo.series,
    releaseDate: setInfo.releaseDate,
  }
  const rows = useMemo<Row[]>(
    () => cards.map((c) => browseCardToRow(c, setCtx)),
    // setCtx is derived from setInfo; depend on the stable id, not the
    // freshly-built object literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, setInfo.id],
  )
  // Cross-collection ownership badges (#576), signed-in only.
  const ownershipIds = useMemo(
    () =>
      showSavedActions
        ? cards.map((c) => ({ setId: setInfo.id, number: c.number }))
        : [],
    [showSavedActions, cards, setInfo.id],
  )
  const { lookup: lookupOwnership } = useCardOwnership(ownershipIds)
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
            {cards.map((c, i) => (
              <CardTile
                key={c.id}
                card={c}
                setCtx={setCtx}
                showSavedActions={showSavedActions}
                ownership={lookupOwnership(setInfo.id, c.number)}
                onOpenDetail={() => setDetailIndex(i)}
              />
            ))}
          </ul>
        )}
      </div>

      <CardDetailModal rows={rows} index={detailIndex} onChangeIndex={setDetailIndex} />
    </>
  )
}

interface PokedexListProps {
  groups: PokedexGroup[]
  filter: string
  onFilter: (v: string) => void
  onPick: (species: PokedexEntry) => void
}

function PokedexListView({ groups, filter, onFilter, onPick }: PokedexListProps) {
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
            placeholder="Find a Pokémon by name or dex #…"
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            className="w-full rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 py-1.5 pl-8 pr-2 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:placeholder:text-sand-400 focus:border-sand-400 dark:focus:border-coconut-400 focus:outline-none"
            aria-label="Find a Pokémon"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {groups.length === 0 ? (
          <p className="text-sm text-coconut-400 dark:text-sand-400">
            No Pokémon match “{filter}”.
          </p>
        ) : (
          <ul className="space-y-4">
            {groups.map((group) => (
              <li key={group.label}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-coconut-600 dark:text-sand-200">
                  {group.label}
                  <span className="ml-1 font-normal normal-case tracking-normal text-coconut-400 dark:text-sand-400">
                    ({group.species.length})
                  </span>
                </div>
                <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
                  {group.species.map((s) => (
                    <SpeciesTile key={s.number} species={s} onPick={() => onPick(s)} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function SpeciesTile({
  species,
  onPick,
}: {
  species: PokedexEntry
  onPick: () => void
}) {
  const [spriteFailed, setSpriteFailed] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400/40 px-3 py-2 text-left hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-50 dark:hover:bg-husk-200 focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
      >
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded bg-sand-50 dark:bg-husk-400">
          {spriteFailed ? (
            <ImageOff size={14} className="text-coconut-300 dark:text-sand-500" aria-hidden />
          ) : (
            <img
              src={pokemonSpriteUrl(species.number)}
              alt=""
              className="h-9 w-9 object-contain"
              loading="lazy"
              onError={() => setSpriteFailed(true)}
            />
          )}
        </span>
        <span className="w-9 flex-none font-mono text-xs text-coconut-400 dark:text-sand-400">
          #{species.number}
        </span>
        <span className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50">
          {species.name}
        </span>
      </button>
    </li>
  )
}

interface PokedexDetailProps {
  showSavedActions: boolean
  cards: PokedexCard[] | null
  loading: boolean
  error: string | null
  addedCount: number | null
  onAddAll: () => void
}

function PokedexDetailView({
  showSavedActions,
  cards,
  loading,
  error,
  addedCount,
  onAddAll,
}: PokedexDetailProps) {
  const count = cards?.length ?? 0
  // PokedexCard carries its own set context, so the rows need no external
  // ctx. Index into the displayed printings for the open detail modal.
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const rows = useMemo<Row[]>(
    () => (cards ?? []).map((c) => browseCardToRow(c)),
    [cards],
  )
  // Cross-collection ownership badges (#576), signed-in only. PokedexCard
  // carries its own set id per printing.
  const ownershipIds = useMemo(
    () =>
      showSavedActions
        ? (cards ?? []).map((c) => ({ setId: c.setId, number: c.number }))
        : [],
    [showSavedActions, cards],
  )
  const { lookup: lookupOwnership } = useCardOwnership(ownershipIds)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 dark:border-husk-100 px-5 py-2 text-xs text-coconut-400 dark:text-sand-300">
        <span>
          {count} printing{count === 1 ? '' : 's'}
        </span>
        {count > 0 && (
          <>
            <span className="text-coconut-300 dark:text-sand-500">·</span>
            <BulkButton onClick={onAddAll}>Add all printings</BulkButton>
          </>
        )}
        {addedCount != null && (
          <span className="ml-auto text-palm-500 dark:text-palm-200" role="status">
            Added {addedCount} line{addedCount === 1 ? '' : 's'} to your list
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {error && (
          <p className="rounded border border-ember-500/40 dark:border-ember-500/50 bg-ember-500/10 dark:bg-ember-500/30 px-3 py-2 text-sm text-ember-400 dark:text-ember-300">
            Couldn’t load printings: {error}
          </p>
        )}
        {loading && !error && (
          <p className="flex items-center gap-2 text-sm text-coconut-400 dark:text-sand-300">
            <Loader2 size={14} className="animate-spin" />
            Loading printings…
          </p>
        )}
        {!loading && !error && count === 0 && (
          <p className="text-sm text-coconut-400 dark:text-sand-400">No printings found.</p>
        )}
        {!loading && !error && cards && count > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {cards.map((c, i) => (
              <PokedexCardTile
                key={c.id}
                card={c}
                showSavedActions={showSavedActions}
                ownership={lookupOwnership(c.setId, c.number)}
                onOpenDetail={() => setDetailIndex(i)}
              />
            ))}
          </ul>
        )}
      </div>

      <CardDetailModal rows={rows} index={detailIndex} onChangeIndex={setDetailIndex} />
    </>
  )
}

function CardTile({
  card,
  setCtx,
  showSavedActions,
  ownership,
  onOpenDetail,
}: {
  card: SetCard
  setCtx: BrowseSetContext
  showSavedActions: boolean
  ownership: CardOwnership | null | undefined
  onOpenDetail: () => void
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  return (
    <li className="group flex flex-col rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400/40 p-2 text-left hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-50 dark:hover:bg-husk-200">
      <button
        type="button"
        onClick={onOpenDetail}
        aria-label={`View details for ${card.name}`}
        className="flex flex-1 flex-col rounded text-left focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
      >
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
      </button>
      <OwnershipBadge ownership={ownership} className="mt-1.5 justify-center" />
      <SaveCardActions
        show={showSavedActions}
        card={browseCardToPayload(card, setCtx)}
        className="mt-2 justify-center"
      />
    </li>
  )
}

function PokedexCardTile({
  card,
  showSavedActions,
  ownership,
  onOpenDetail,
}: {
  card: PokedexCard
  showSavedActions: boolean
  ownership: CardOwnership | null | undefined
  onOpenDetail: () => void
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const year = releaseYear(card.releaseDate)
  return (
    <li className="group flex flex-col rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400/40 p-2 text-left hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-50 dark:hover:bg-husk-200">
      <button
        type="button"
        onClick={onOpenDetail}
        aria-label={`View details for ${card.name} from ${card.setName}`}
        className="flex flex-1 flex-col rounded text-left focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
      >
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
          <div className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50" title={card.setName}>
            {card.setName}
          </div>
          <div className="flex items-center justify-between text-xs text-coconut-400 dark:text-sand-400">
            <span>
              #{card.number}
              {year ? ` · ${year}` : ''}
            </span>
            {card.market != null && (
              <span className="text-palm-500 dark:text-palm-200">${card.market.toFixed(2)}</span>
            )}
          </div>
          {card.rarity && (
            <div className="truncate text-[11px] text-coconut-400 dark:text-sand-400">{card.rarity}</div>
          )}
        </div>
      </button>
      <OwnershipBadge ownership={ownership} className="mt-1.5 justify-center" />
      <SaveCardActions
        show={showSavedActions}
        card={browseCardToPayload(card)}
        className="mt-2 justify-center"
      />
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
