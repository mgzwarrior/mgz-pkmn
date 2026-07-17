/**
 * BrowsePanel — the inline "browse cards" view rendered by the Browse
 * discovery-mode tab in App.tsx. A view-mode toggle flips the whole panel
 * between three organisations: **set view** (series → set → cards in that
 * set), **pokedex view** (#577: national dex # → every printing of one
 * Pokémon across every set), and **class view** (#911, #916: card class →
 * a name index of every Supporter / Item / Special Energy / … in it,
 * pokedex-style → every printing of one name across every set). State +
 * effects live in [useBrowseController](./useBrowseController.ts).
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GalleryHorizontalEnd,
  ImageOff,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Star,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { pokemonSpriteUrl, setLogoUrl, trainerSpriteUrl } from '../api/client'
import { CARD_CLASS_GROUPS, type CardClassEntry } from '../data/cardClasses'
import { BAKED_POKEDEX } from '../data/pokedex'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import { useFavoritePokemon } from './useFavoritePokemon'
import type { CardData, PokedexCard, PokedexEntry, Row, SetCard, SetInfo } from '../types'
import { BinderModal } from './BinderModal'
import { browseCardToPayload, browseCardToRow, type BrowseSetContext } from './browseCard'
import { BrowseSelectionBar } from './BrowseSelectionBar'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './cardCategories'
import { CardDetailModal } from './CardDetailModal'
import { CollectionCreateDialog } from './CollectionCreateDialog'
import { WishlistCreateDialog } from './WishlistCreateDialog'
import { useBrowseSelection, type BrowseSelection } from './useBrowseSelection'
import { useCardOwnership } from './useCardOwnership'
import { OwnershipBadge } from './OwnershipBadge'
import { SaveCardActions } from './SaveCardActions'
import { SetIdCardsButton } from './SetIdCardsButton'
import type { CardOwnership } from '../api/client'
import type {
  BrowseController,
  BrowseViewMode,
  CardSort,
  CategoryFilter,
  ClassNameEntry,
  GroupOrder,
  PokedexGroup,
  RarityBucket,
  SeriesGroup,
} from './useBrowseController'

function releaseYear(date: string): string | null {
  const match = /^(\d{4})/.exec(date || '')
  return match ? match[1] : null
}

/** dex number → species, resolved once so favorited numbers (#742) render as
 *  the same tiles as the generation groups. */
const DEX_BY_NUMBER = new Map(BAKED_POKEDEX.map((e) => [e.number, e]))

interface BrowsePanelProps {
  controller: BrowseController
}

/** The three modern create kinds the Browse New ▾ menu offers (#737),
 *  matching the Library's owned / chasing / smart model. */
type CreateKind = 'collection' | 'wishlist' | 'smart'

/** What a create dialog is seeded with, derived from the active set/species. */
interface PendingSeed {
  name: string
  /** The set's cards / species' printings to pre-populate a collection or
   *  want-list. A smart collection ignores these — its rule is its membership. */
  seedCards: CardData[]
  ruleField: 'set_id' | 'name'
  ruleValue: string
}

type PendingCreate = PendingSeed & { kind: CreateKind }

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
    category,
    setCategory,
    sort,
    setSort,
    seriesOrder,
    setSeriesOrder,
    generationOrder,
    setGenerationOrder,
    collapsedGroups,
    toggleGroupCollapsed,
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
    activeClass,
    setActiveClass,
    classCards,
    classNameGroups,
    classCardsLoading,
    classCardsError,
    classSearch,
    setClassSearch,
    activeClassCardName,
    setActiveClassCardName,
    activeClassCards,
    addAllClassCards,
  } = controller

  // Hoist the auth read here (not per tile) so the grid fires one `/me`
  // request, then pass the boolean down — tiles only care about "should I
  // render save buttons", matching ResultsTable's row pattern.
  const { user } = useAuth()
  const showSavedActions = user !== null

  // Multi-select mode (#913) — tap cards in any grid to build a selection,
  // then bulk-mark it owned/chasing via BrowseSelectionBar. Local/transient
  // (not server-synced), so it resets whenever the drilled-in target changes
  // rather than following stale identities across sets/species/classes.
  const selection = useBrowseSelection()
  const drillKey = `${viewMode}:${activeSet?.id ?? ''}:${activePokemon?.number ?? ''}:${activeClassCardName ?? ''}`
  useEffect(() => {
    selection.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillKey])

  // Favorite Pokémon (#742) — the inline star toggle on the pokedex tiles and
  // the pinned "Your favorites" group. Signed-in only; a signed-out visitor
  // reads an empty list without hitting the per-user endpoint.
  const { favorites, pin, unpin, isFavorite } = useFavoritePokemon({
    enabled: showSavedActions,
  })
  const favoriteEntries = useMemo<PokedexEntry[]>(
    () =>
      favorites
        .map((f) => DEX_BY_NUMBER.get(f.dex_number))
        .filter((e): e is PokedexEntry => e !== undefined),
    [favorites],
  )
  const toggleFavorite = (number: number) =>
    isFavorite(number) ? void unpin(number) : void pin(number)

  // Create-from-Browse flow (#737): the New ▾ menu opens one of the three
  // canonical create dialogs (owned Collection / chasing Want-list / Smart
  // binder), seeded from the active set or species. Non-null mounts a dialog;
  // closing clears it. The collection/want-list create dialogs own their seeding
  // (via the shared bulkAdd) so the ownership cache (#576) refreshes the badges.
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null)

  // Collection / want-list creates snapshot the loaded cards as their seed, so
  // they're only offered once the drill-in's cards have landed — otherwise we'd
  // seed an empty list. A smart collection needs no cards, so it's always available.
  const seedLoading =
    viewMode === 'set'
      ? cardsLoading
      : viewMode === 'pokedex'
        ? pokedexCardsLoading
        : classCardsLoading

  // Build the seed for the current drill-in: the list name, the cards to
  // pre-populate (the whole set / all printings), and the rule a smart collection
  // would use. Returns null when there's nothing to seed from yet.
  function buildSeed(): PendingSeed | null {
    if (viewMode === 'set' && activeSet) {
      const setCtx: BrowseSetContext = {
        id: activeSet.id,
        name: activeSet.name,
        series: activeSet.series,
        releaseDate: activeSet.releaseDate,
      }
      return {
        name: activeSet.name,
        seedCards: (cards ?? []).map((c) => browseCardToPayload(c, setCtx)),
        ruleField: 'set_id',
        ruleValue: activeSet.id,
      }
    }
    if (viewMode === 'pokedex' && activePokemon) {
      return {
        name: activePokemon.name,
        seedCards: (pokedexCards ?? []).map((c) => browseCardToPayload(c)),
        ruleField: 'name',
        ruleValue: activePokemon.name,
      }
    }
    if (viewMode === 'class' && activeClassCardName) {
      return {
        name: activeClassCardName,
        seedCards: activeClassCards.map((c) => browseCardToPayload(c)),
        ruleField: 'name',
        ruleValue: activeClassCardName,
      }
    }
    return null
  }

  function openCreate(kind: CreateKind) {
    // Guard the seeded kinds against an in-flight load (the menu also disables
    // them, this is the belt-and-braces against a stale click).
    if ((kind === 'collection' || kind === 'wishlist') && seedLoading) return
    const seed = buildSeed()
    if (seed) setPendingCreate({ kind, ...seed })
  }

  const drilledIn =
    viewMode === 'set' ? !!activeSet : viewMode === 'pokedex' ? !!activePokemon : !!activeClass
  const onBack = () => {
    if (viewMode === 'set') setActiveSet(null)
    else if (viewMode === 'pokedex') setActivePokemon(null)
    // Class view is a level deeper than the others (#916): class → name
    // index → one name's printings. Back walks up one level at a time.
    else if (activeClassCardName) setActiveClassCardName(null)
    else setActiveClass(null)
  }
  // The New ▾ create-from-Browse menu needs a smart-collection rule to
  // offer, and collection rules speak set_id / name — a class only has a
  // name to key off once you've drilled into one (#916).
  const showCreateMenu =
    drilledIn && showSavedActions && (viewMode !== 'class' || !!activeClassCardName)
  const backLabel =
    viewMode === 'set'
      ? 'Back to set list'
      : viewMode === 'pokedex'
        ? 'Back to Pokédex list'
        : activeClassCardName
          ? `Back to ${activeClass?.label ?? 'class'} list`
          : 'Back to class list'

  let headerTitle: string
  let description: string
  if (viewMode === 'set') {
    headerTitle = activeSet ? activeSet.name : 'Browse sets'
    description = activeSet
      ? 'Click a card for its details and comps, or use the bulk actions below to build your list.'
      : 'Pick a set to see every card with its market price, sortable and filterable.'
  } else if (viewMode === 'pokedex') {
    headerTitle = activePokemon
      ? `#${activePokemon.number} ${activePokemon.name}`
      : 'Browse by Pokédex #'
    description = activePokemon
      ? 'Every printing we found, newest first. Click a card for its details and comps.'
      : 'Pick a Pokémon to see every printing across every set, newest first.'
  } else if (activeClassCardName) {
    headerTitle = activeClassCardName
    description = 'Every printing we found, newest first. Click a card for its details and comps.'
  } else {
    headerTitle = activeClass ? activeClass.label : 'Browse by class'
    description = activeClass
      ? 'Pick a name to see every printing across every set, newest first.'
      : 'Pick a card class — Supporters, Items, Special Energy, and more — to walk it across every set.'
  }

  return (
    <div
      data-tour="browse"
      className="flex flex-col overflow-hidden rounded-lg border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-200 shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sand-200 dark:border-husk-100 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          {drilledIn && (
            <button
              type="button"
              onClick={onBack}
              aria-label={backLabel}
              className="rounded p-1 text-coconut-400 dark:text-sand-300 hover:bg-sand-200 dark:hover:bg-husk-100 hover:text-coconut-700 dark:hover:text-sand-50"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <GalleryHorizontalEnd size={18} className="text-coconut-600 dark:text-sand-200" />
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {viewMode === 'pokedex' && activePokemon && showSavedActions && (
            <FavoriteToggle
              favorited={isFavorite(activePokemon.number)}
              name={activePokemon.name}
              onToggle={() => toggleFavorite(activePokemon.number)}
              withLabel
            />
          )}
          {showCreateMenu && (
            <BrowseCreateMenu
              kind={viewMode}
              seedLoading={seedLoading}
              onCreate={openCreate}
            />
          )}
          <SetIdCardsButton />
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
            category={category}
            onCategory={setCategory}
            sort={sort}
            onSort={setSort}
            addedCount={addedCount}
            onAddAll={addAll}
            onAddHolos={addHolos}
            onAddRares={addRares}
            selection={showSavedActions ? selection : null}
          />
        ) : (
          <SetListView
            groups={groups}
            onPick={(s) => setActiveSet(s)}
            order={seriesOrder}
            onOrder={setSeriesOrder}
            collapsedGroups={collapsedGroups}
            onToggleCollapsed={toggleGroupCollapsed}
          />
        )
      ) : viewMode === 'pokedex' ? (
        activePokemon ? (
          <PokedexDetailView
            showSavedActions={showSavedActions}
            cards={pokedexCards}
            loading={pokedexCardsLoading}
            error={pokedexCardsError}
            addedCount={addedCount}
            onAddAll={addAllPrintings}
            selection={showSavedActions ? selection : null}
          />
        ) : (
          <PokedexListView
            groups={pokedexGroups}
            filter={pokedexFilter}
            onFilter={setPokedexFilter}
            onPick={(p) => setActivePokemon(p)}
            favoriteEntries={favoriteEntries}
            showFavoriteControls={showSavedActions}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            order={generationOrder}
            onOrder={setGenerationOrder}
            collapsedGroups={collapsedGroups}
            onToggleCollapsed={toggleGroupCollapsed}
          />
        )
      ) : activeClass ? (
        activeClassCardName ? (
          <PokedexDetailView
            showSavedActions={showSavedActions}
            cards={activeClassCards}
            loading={classCardsLoading}
            error={classCardsError}
            addedCount={addedCount}
            onAddAll={addAllClassCards}
            selection={showSavedActions ? selection : null}
          />
        ) : (
          <ClassNameIndexView
            groups={classNameGroups}
            total={classCards?.length ?? 0}
            loading={classCardsLoading}
            error={classCardsError}
            search={classSearch}
            onSearch={setClassSearch}
            // Trainer sprites read as people — only Supporters are (#916).
            useTrainerSprites={activeClass?.id === 'supporter'}
            onPick={(name) => setActiveClassCardName(name)}
          />
        )
      ) : (
        <ClassListView onPick={(c) => setActiveClass(c)} />
      )}

      {/* Create-from-Browse dialogs (#737), seeded from the active set/species.
          Mounted only while a create is pending so each re-seeds cleanly. */}
      {pendingCreate?.kind === 'collection' && (
        <CollectionCreateDialog
          open
          onOpenChange={(o) => {
            if (!o) setPendingCreate(null)
          }}
          prefillName={pendingCreate.name}
          seedCards={pendingCreate.seedCards}
        />
      )}
      {pendingCreate?.kind === 'wishlist' && (
        <WishlistCreateDialog
          open
          onOpenChange={(o) => {
            if (!o) setPendingCreate(null)
          }}
          prefillName={pendingCreate.name}
          seedCards={pendingCreate.seedCards}
        />
      )}
      {pendingCreate?.kind === 'smart' && (
        <BinderModal
          open
          smartOnly
          onOpenChange={(o) => {
            if (!o) setPendingCreate(null)
          }}
          prefill={{
            name: pendingCreate.name,
            ruleField: pendingCreate.ruleField,
            ruleValue: pendingCreate.ruleValue,
          }}
        />
      )}
    </div>
  )
}

/** The New ▾ menu in the Browse header (set-detail + pokedex-detail). Mirrors
 *  the Library's owned / chasing / smart create model (#737). */
function BrowseCreateMenu({
  kind,
  seedLoading,
  onCreate,
}: {
  kind: BrowseViewMode
  seedLoading: boolean
  onCreate: (kind: CreateKind) => void
}) {
  const noun = kind === 'set' ? 'set' : kind === 'class' ? 'card' : 'Pokémon'
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2.5 py-1 text-xs text-coconut-600 dark:text-sand-200 hover:bg-sand-50 dark:hover:bg-husk-200"
        >
          <Plus size={13} />
          New
          <ChevronDown size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[200px] rounded-md border border-sand-300 bg-sand-50 p-1 shadow-xl dark:border-husk-50 dark:bg-husk-200"
        >
          <BrowseCreateItem
            icon={<FolderPlus size={13} />}
            label="Collection"
            blurb={seedLoading ? 'Loading cards…' : `The ${noun}'s cards you own.`}
            disabled={seedLoading}
            onSelect={() => onCreate('collection')}
          />
          <BrowseCreateItem
            icon={<Star size={13} />}
            label="Wishlist"
            blurb={seedLoading ? 'Loading cards…' : `The ${noun}'s cards you're chasing.`}
            disabled={seedLoading}
            onSelect={() => onCreate('wishlist')}
          />
          <BrowseCreateItem
            icon={<Sparkles size={13} />}
            label="Smart collection"
            blurb={`A saved rule for this ${noun}.`}
            onSelect={() => onCreate('smart')}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function BrowseCreateItem({
  icon,
  label,
  blurb,
  disabled,
  onSelect,
}: {
  icon: ReactNode
  label: string
  blurb: string
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className="flex cursor-pointer flex-col gap-0.5 rounded px-2.5 py-1.5 text-left outline-none data-[highlighted]:bg-sand-200 data-[disabled]:cursor-default data-[disabled]:opacity-50 dark:data-[highlighted]:bg-husk-100"
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-coconut-700 dark:text-sand-50">
        {icon}
        {label}
      </span>
      <span className="pl-[18px] text-[10px] text-coconut-400 dark:text-sand-300">{blurb}</span>
    </DropdownMenu.Item>
  )
}

const VIEW_MODES: { value: BrowseViewMode; label: string }[] = [
  { value: 'set', label: 'By set' },
  { value: 'pokedex', label: 'By Pokédex #' },
  { value: 'class', label: 'By class' },
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

/** The newest-/oldest-first toggle for group order in either browse list (#914). */
function GroupOrderToggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: GroupOrder
  onChange: (o: GroupOrder) => void
  ariaLabel: string
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={ariaLabel}>
      <Chip active={value === 'newest'} onClick={() => onChange('newest')}>
        Newest first
      </Chip>
      <Chip active={value === 'oldest'} onClick={() => onChange('oldest')}>
        Oldest first
      </Chip>
    </div>
  )
}

/** Clickable group header — folds/unfolds the grid beneath it (#914). */
function CollapsibleGroupHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="mb-2 flex w-full items-center gap-1 rounded text-left text-xs font-semibold uppercase tracking-wider text-coconut-600 dark:text-sand-200 hover:text-coconut-700 dark:hover:text-sand-50 focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
    >
      <Chevron size={14} className="flex-none text-coconut-400 dark:text-sand-400" aria-hidden />
      {label}
      <span className="ml-1 font-normal normal-case tracking-normal text-coconut-400 dark:text-sand-400">
        ({count})
      </span>
    </button>
  )
}

interface SetListProps {
  groups: SeriesGroup[]
  onPick: (set: SetInfo) => void
  order: GroupOrder
  onOrder: (o: GroupOrder) => void
  collapsedGroups: ReadonlySet<string>
  onToggleCollapsed: (label: string) => void
}

function SetListView({
  groups,
  onPick,
  order,
  onOrder,
  collapsedGroups,
  onToggleCollapsed,
}: SetListProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 dark:border-husk-100 px-5 py-3">
        <span className="text-xs text-coconut-400 dark:text-sand-300">Series order</span>
        <GroupOrderToggle value={order} onChange={onOrder} ariaLabel="Series order" />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-3">
        <ul className="space-y-4">
          {groups.map((group) => {
            const collapsed = collapsedGroups.has(group.series)
            return (
              <li key={group.series}>
                <CollapsibleGroupHeader
                  label={group.series}
                  count={group.sets.length}
                  collapsed={collapsed}
                  onToggle={() => onToggleCollapsed(group.series)}
                />
                {!collapsed && (
                  <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {group.sets.map((s) => (
                      <SetTile key={s.id} set={s} onPick={() => onPick(s)} />
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </>
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
  category: CategoryFilter
  onCategory: (c: CategoryFilter) => void
  sort: CardSort
  onSort: (s: CardSort) => void
  addedCount: number | null
  onAddAll: () => void
  onAddHolos: () => void
  onAddRares: () => void
  /** Multi-select (#913). `null` hides the select toggle entirely — signed
   *  out visitors have no collection/wishlist to write bulk actions to. */
  selection: BrowseSelection | null
}

const BUCKETS: { value: RarityBucket; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'rare', label: 'Rares' },
  { value: 'holo', label: 'Holos' },
  { value: 'ultra', label: 'Ultra+' },
]

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'All categories' },
  ...CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
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
  category,
  onCategory,
  sort,
  onSort,
  addedCount,
  onAddAll,
  onAddHolos,
  onAddRares,
  selection,
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
          Category
          <select
            value={category}
            onChange={(e) => onCategory(e.target.value as CategoryFilter)}
            className="rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 px-2 py-1 text-sm text-coconut-700 dark:text-sand-50 focus:border-sand-400 dark:focus:border-coconut-400 focus:outline-none"
            aria-label="Filter by card category"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
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
        {selection && (
          <Chip active={selection.selectMode} onClick={selection.toggleSelectMode}>
            {selection.selectMode ? 'Done selecting' : 'Select'}
          </Chip>
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
            {cards.map((c, i) => {
              const payload = browseCardToPayload(c, setCtx)
              return (
                <CardTile
                  key={c.id}
                  card={c}
                  setCtx={setCtx}
                  showSavedActions={showSavedActions}
                  ownership={lookupOwnership(setInfo.id, c.number)}
                  onOpenDetail={() => setDetailIndex(i)}
                  selectMode={!!selection?.selectMode}
                  selected={!!selection?.isSelected(payload)}
                  onToggleSelect={() => selection?.toggle(payload)}
                />
              )
            })}
          </ul>
        )}
      </div>
      {selection?.selectMode && (
        <BrowseSelectionBar
          selected={selection.selected}
          lookupOwnership={lookupOwnership}
          onClear={selection.clear}
        />
      )}

      <CardDetailModal rows={rows} index={detailIndex} onChangeIndex={setDetailIndex} />
    </>
  )
}

interface PokedexListProps {
  groups: PokedexGroup[]
  filter: string
  onFilter: (v: string) => void
  onPick: (species: PokedexEntry) => void
  /** Favorited species, newest first — pinned in a "Your favorites" group at
   *  the top while no search filter is active (#742). */
  favoriteEntries: PokedexEntry[]
  /** Whether to render the favorite star toggle (signed-in only). */
  showFavoriteControls: boolean
  isFavorite: (number: number) => boolean
  onToggleFavorite: (number: number) => void
  order: GroupOrder
  onOrder: (o: GroupOrder) => void
  collapsedGroups: ReadonlySet<string>
  onToggleCollapsed: (label: string) => void
}

function PokedexListView({
  groups,
  filter,
  onFilter,
  onPick,
  favoriteEntries,
  showFavoriteControls,
  isFavorite,
  onToggleFavorite,
  order,
  onOrder,
  collapsedGroups,
  onToggleCollapsed,
}: PokedexListProps) {
  // The pinned favorites group only makes sense as a "jump to what I love"
  // shortcut on the unfiltered list — once you're searching, the matching
  // generation groups already surface the species.
  const searching = filter.trim() !== ''
  const showFavorites =
    showFavoriteControls && favoriteEntries.length > 0 && !searching
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
        <span className="text-xs text-coconut-400 dark:text-sand-300">Generation order</span>
        <GroupOrderToggle value={order} onChange={onOrder} ariaLabel="Generation order" />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {groups.length === 0 && !showFavorites ? (
          <p className="text-sm text-coconut-400 dark:text-sand-400">
            No Pokémon match “{filter}”.
          </p>
        ) : (
          <ul className="space-y-4">
            {showFavorites && (
              <PokedexGroupSection
                label="Your favorites"
                species={favoriteEntries}
                onPick={onPick}
                showFavoriteControls={showFavoriteControls}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
                collapsed={collapsedGroups.has('Your favorites')}
                onToggleCollapsed={() => onToggleCollapsed('Your favorites')}
              />
            )}
            {groups.map((group) => (
              <PokedexGroupSection
                key={group.label}
                label={group.label}
                species={group.species}
                onPick={onPick}
                showFavoriteControls={showFavoriteControls}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
                // A match folded away inside a collapsed generation would read
                // as a missing result, so searching ignores collapse state.
                collapsed={!searching && collapsedGroups.has(group.label)}
                onToggleCollapsed={() => onToggleCollapsed(group.label)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function PokedexGroupSection({
  label,
  species,
  onPick,
  showFavoriteControls,
  isFavorite,
  onToggleFavorite,
  collapsed,
  onToggleCollapsed,
}: {
  label: string
  species: PokedexEntry[]
  onPick: (species: PokedexEntry) => void
  showFavoriteControls: boolean
  isFavorite: (number: number) => boolean
  onToggleFavorite: (number: number) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  return (
    <li>
      <CollapsibleGroupHeader
        label={label}
        count={species.length}
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
      />
      {!collapsed && (
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
          {species.map((s) => (
            <SpeciesTile
              key={s.number}
              species={s}
              onPick={() => onPick(s)}
              showFavoriteControl={showFavoriteControls}
              favorited={isFavorite(s.number)}
              onToggleFavorite={() => onToggleFavorite(s.number)}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function SpeciesTile({
  species,
  onPick,
  showFavoriteControl,
  favorited,
  onToggleFavorite,
}: {
  species: PokedexEntry
  onPick: () => void
  showFavoriteControl: boolean
  favorited: boolean
  onToggleFavorite: () => void
}) {
  const [spriteFailed, setSpriteFailed] = useState(false)
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onPick}
        className={`flex w-full items-center gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400/40 py-2 pl-3 text-left hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-50 dark:hover:bg-husk-200 focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50 ${
          showFavoriteControl ? 'pr-9' : 'pr-3'
        }`}
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
      {showFavoriteControl && (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
          <FavoriteToggle
            favorited={favorited}
            name={species.name}
            onToggle={onToggleFavorite}
          />
        </div>
      )}
    </li>
  )
}

/** Star toggle for pinning a favorite Pokémon (#742). `withLabel` renders the
 *  bordered header variant; bare is the icon-only tile overlay. */
function FavoriteToggle({
  favorited,
  name,
  onToggle,
  withLabel = false,
}: {
  favorited: boolean
  name: string
  onToggle: () => void
  withLabel?: boolean
}) {
  const label = favorited ? `Remove ${name} from favorites` : `Add ${name} to favorites`
  const star = (
    <Star
      size={withLabel ? 14 : 16}
      className={
        favorited
          ? 'fill-sun-400 text-sun-500 dark:fill-sun-300 dark:text-sun-300'
          : 'text-coconut-400 dark:text-sand-300'
      }
      aria-hidden
    />
  )
  if (withLabel) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={favorited}
        aria-label={label}
        className="inline-flex items-center gap-1.5 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-200 dark:bg-husk-100 px-2.5 py-1 text-xs text-coconut-600 dark:text-sand-200 hover:bg-sand-50 dark:hover:bg-husk-200"
      >
        {star}
        {favorited ? 'Favorited' : 'Favorite'}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={favorited}
      aria-label={label}
      className="rounded-full p-1 hover:bg-sand-200 dark:hover:bg-husk-100 focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
    >
      {star}
    </button>
  )
}

interface PokedexDetailProps {
  showSavedActions: boolean
  cards: PokedexCard[] | null
  loading: boolean
  error: string | null
  addedCount: number | null
  onAddAll: () => void
  /** Multi-select (#913). `null` hides the select toggle entirely — signed
   *  out visitors have no collection/wishlist to write bulk actions to. */
  selection: BrowseSelection | null
}

function PokedexDetailView({
  showSavedActions,
  cards,
  loading,
  error,
  addedCount,
  onAddAll,
  selection,
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
        {selection && (
          <Chip active={selection.selectMode} onClick={selection.toggleSelectMode}>
            {selection.selectMode ? 'Done selecting' : 'Select'}
          </Chip>
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
            {cards.map((c, i) => {
              const payload = browseCardToPayload(c)
              return (
                <PokedexCardTile
                  key={c.id}
                  card={c}
                  showSavedActions={showSavedActions}
                  ownership={lookupOwnership(c.setId, c.number)}
                  onOpenDetail={() => setDetailIndex(i)}
                  selectMode={!!selection?.selectMode}
                  selected={!!selection?.isSelected(payload)}
                  onToggleSelect={() => selection?.toggle(payload)}
                />
              )
            })}
          </ul>
        )}
      </div>

      <CardDetailModal rows={rows} index={detailIndex} onChangeIndex={setDetailIndex} />
      {selection?.selectMode && (
        <BrowseSelectionBar
          selected={selection.selected}
          lookupOwnership={lookupOwnership}
          onClear={selection.clear}
        />
      )}
    </>
  )
}

/** The class picker (#911) — a dozen fixed tiles, grouped Trainers / Energy /
 *  vintage. No search or collapse: the whole index fits on one screen. */
function ClassListView({ onPick }: { onPick: (entry: CardClassEntry) => void }) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-3">
      <ul className="space-y-4">
        {CARD_CLASS_GROUPS.map((group) => (
          <li key={group.label}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-coconut-600 dark:text-sand-200">
              {group.label}
              <span className="ml-1 font-normal normal-case tracking-normal text-coconut-400 dark:text-sand-400">
                ({group.classes.length})
              </span>
            </h3>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {group.classes.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onPick(entry)}
                    className="flex w-full flex-col gap-0.5 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400/40 px-3 py-2 text-left hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-50 dark:hover:bg-husk-200 focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
                  >
                    <span className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50">
                      {entry.label}
                    </span>
                    <span className="truncate text-xs text-coconut-400 dark:text-sand-400">
                      {entry.blurb}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Class name index (#911, #916) — the same organisation as the Pokédex
 *  species index, one level up: every distinct trainer/object/character in
 *  this class (e.g. every Supporter), searchable by name. Picking one drills
 *  into its printings, mirroring `PokedexDetailView` — that's the "walk
 *  Marnie" path, now a tap instead of an in-page search. */
function ClassNameIndexView({
  groups,
  total,
  loading,
  error,
  search,
  onSearch,
  useTrainerSprites,
  onPick,
}: {
  groups: ClassNameEntry[]
  total: number
  loading: boolean
  error: string | null
  search: string
  onSearch: (v: string) => void
  /** Lead each tile with its Showdown trainer sprite (#916) instead of the
   *  sample printing's thumbnail — only true for character classes
   *  (Supporters); an Item or Stadium name has no trainer to draw. */
  useTrainerSprites: boolean
  onPick: (name: string) => void
}) {
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
            placeholder="Find a name in this class…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 py-1.5 pl-8 pr-2 text-sm text-coconut-700 dark:text-sand-50 placeholder:text-coconut-400 dark:placeholder:text-sand-400 focus:border-sand-400 dark:focus:border-coconut-400 focus:outline-none"
            aria-label="Find a name in this class"
          />
        </label>
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
        {!loading && !error && groups.length === 0 && (
          <p className="text-sm text-coconut-400 dark:text-sand-400">
            {total === 0 ? 'No cards found.' : `No names match “${search}”.`}
          </p>
        )}
        {!loading && !error && groups.length > 0 && (
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
            {groups.map((g) => (
              <ClassNameTile
                key={g.name}
                entry={g}
                useTrainerSprite={useTrainerSprites}
                onPick={() => onPick(g.name)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function ClassNameTile({
  entry,
  useTrainerSprite,
  onPick,
}: {
  entry: ClassNameEntry
  useTrainerSprite: boolean
  onPick: () => void
}) {
  // Two-stage fallback: the Showdown guess is a name slug, not a lookup, so
  // a miss (no sprite for that name, or not a character at all) drops to
  // the sample printing's own thumbnail before the bare icon — one rung
  // softer than SpeciesTile's sprite-or-icon, since we have a real card
  // image to fall back to and the dex tiles don't.
  const [stage, setStage] = useState<'sprite' | 'thumb' | 'none'>(
    useTrainerSprite ? 'sprite' : entry.sample.thumb ? 'thumb' : 'none',
  )
  const src =
    stage === 'sprite' ? trainerSpriteUrl(entry.name) : stage === 'thumb' ? entry.sample.thumb : null
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-2 rounded-md border border-sand-200 dark:border-husk-100 bg-sand-50 dark:bg-husk-400/40 py-2 pl-3 pr-3 text-left hover:border-sand-300 dark:hover:border-husk-50 hover:bg-sand-50 dark:hover:bg-husk-200 focus:outline-none focus:ring-2 focus:ring-sand-300 dark:ring-husk-50"
      >
        <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded bg-sand-50 dark:bg-husk-400">
          {src ? (
            <img
              src={src}
              alt=""
              className="h-full w-full object-contain"
              loading="lazy"
              onError={() =>
                setStage((s) => (s === 'sprite' && entry.sample.thumb ? 'thumb' : 'none'))
              }
            />
          ) : (
            <ImageOff size={14} className="text-coconut-300 dark:text-sand-500" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-coconut-700 dark:text-sand-50">
            {entry.name}
          </span>
          <span className="block text-xs text-coconut-400 dark:text-sand-400">
            {entry.count} printing{entry.count === 1 ? '' : 's'}
          </span>
        </span>
      </button>
    </li>
  )
}

function CardTile({
  card,
  setCtx,
  showSavedActions,
  ownership,
  onOpenDetail,
  selectMode,
  selected,
  onToggleSelect,
}: {
  card: SetCard
  setCtx: BrowseSetContext
  showSavedActions: boolean
  ownership: CardOwnership | null | undefined
  onOpenDetail: () => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const hidePricing = useAppStore((s) => s.settings.hidePricing)
  return (
    <li
      className={`group flex flex-col rounded-md border p-2 text-left hover:bg-sand-50 dark:hover:bg-husk-200 ${
        selectMode && selected
          ? 'border-palm-400 bg-sun-400/10 dark:border-sun-400 dark:bg-sun-400/10'
          : 'border-sand-200 bg-sand-50 hover:border-sand-300 dark:border-husk-100 dark:bg-husk-400/40 dark:hover:border-husk-50'
      }`}
    >
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : onOpenDetail}
        aria-label={
          selectMode
            ? `${selected ? 'Deselect' : 'Select'} ${card.name}`
            : `View details for ${card.name}`
        }
        aria-pressed={selectMode ? selected : undefined}
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
          {selectMode && (
            <span
              aria-hidden
              className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                selected
                  ? 'border-palm-500 bg-palm-500 text-coconut-50 dark:text-husk-300'
                  : 'border-sand-300 bg-sand-50/90 dark:border-husk-50 dark:bg-husk-400/90'
              }`}
            >
              {selected && <Check size={12} />}
            </span>
          )}
        </div>
        <div className="mt-2 min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50" title={card.name}>
            {card.name}
          </div>
          <div className="flex items-center justify-between text-xs text-coconut-400 dark:text-sand-400">
            <span>#{card.number}</span>
            {card.market != null && !hidePricing && (
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
        show={showSavedActions && !selectMode}
        card={browseCardToPayload(card, setCtx)}
        ownership={ownership}
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
  selectMode,
  selected,
  onToggleSelect,
}: {
  card: PokedexCard
  showSavedActions: boolean
  ownership: CardOwnership | null | undefined
  onOpenDetail: () => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const hidePricing = useAppStore((s) => s.settings.hidePricing)
  const year = releaseYear(card.releaseDate)
  const title = card.setName
  const subtitle = card.rarity
  return (
    <li
      className={`group flex flex-col rounded-md border p-2 text-left hover:bg-sand-50 dark:hover:bg-husk-200 ${
        selectMode && selected
          ? 'border-palm-400 bg-sun-400/10 dark:border-sun-400 dark:bg-sun-400/10'
          : 'border-sand-200 bg-sand-50 hover:border-sand-300 dark:border-husk-100 dark:bg-husk-400/40 dark:hover:border-husk-50'
      }`}
    >
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : onOpenDetail}
        aria-label={
          selectMode
            ? `${selected ? 'Deselect' : 'Select'} ${card.name} from ${card.setName}`
            : `View details for ${card.name} from ${card.setName}`
        }
        aria-pressed={selectMode ? selected : undefined}
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
          {selectMode && (
            <span
              aria-hidden
              className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                selected
                  ? 'border-palm-500 bg-palm-500 text-coconut-50 dark:text-husk-300'
                  : 'border-sand-300 bg-sand-50/90 dark:border-husk-50 dark:bg-husk-400/90'
              }`}
            >
              {selected && <Check size={12} />}
            </span>
          )}
        </div>
        <div className="mt-2 min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50" title={title ?? undefined}>
            {title}
          </div>
          <div className="flex items-center justify-between text-xs text-coconut-400 dark:text-sand-400">
            <span>
              #{card.number}
              {year ? ` · ${year}` : ''}
            </span>
            {card.market != null && !hidePricing && (
              <span className="text-palm-500 dark:text-palm-200">${card.market.toFixed(2)}</span>
            )}
          </div>
          {subtitle && (
            <div className="truncate text-[11px] text-coconut-400 dark:text-sand-400">{subtitle}</div>
          )}
        </div>
      </button>
      <OwnershipBadge ownership={ownership} className="mt-1.5 justify-center" />
      <SaveCardActions
        show={showSavedActions && !selectMode}
        card={browseCardToPayload(card)}
        ownership={ownership}
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
