/**
 * useBrowseController — state + effects for the Browse discovery-mode
 * tab. Owns the set catalog (seeded from BAKED_SETS, then revalidated
 * against `/api/v1/sets`), the currently-active set, the trimmed card
 * payload for that set (cached per-id for the lifetime of the React
 * tree), and the search / rarity / sort controls.
 *
 * `active` should reflect whether the tab is visible — when it flips
 * true the controller resets transient view state so the user always
 * lands on the set list, not whatever they were browsing last time.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchClassCards, fetchPokedexCards, fetchSetCards, fetchSets } from '../api/client'
import type { CardClassEntry } from '../data/cardClasses'
import { BAKED_POKEDEX, POKEDEX_GENERATIONS } from '../data/pokedex'
import { BAKED_SETS } from '../data/sets'
import { useAppStore } from '../store'
import type { PokedexCard, PokedexEntry, SetCard, SetInfo } from '../types'
import { inCategory, type CardCategory } from './cardCategories'

/** Browse's category filter value — a single archetype, or 'all'. */
export type CategoryFilter = CardCategory | 'all'

export interface SeriesGroup {
  series: string
  sets: SetInfo[]
}

/** One generation section of the national dex species index. */
export interface PokedexGroup {
  label: string
  species: PokedexEntry[]
}

/** One distinct name in a class's name index (#916) — e.g. "Marnie" across
 *  every set she's printed in. `sample` seeds the index tile's thumbnail. */
export interface ClassNameEntry {
  name: string
  count: number
  sample: PokedexCard
}

/**
 * Which organisation Browse is showing: `set` walks series → set → cards;
 * `pokedex` walks national dex # → every printing of that species across
 * every set (issue #577); `class` walks card class → every Supporter /
 * Item / Special Energy / … across every set (issue #911).
 */
export type BrowseViewMode = 'set' | 'pokedex' | 'class'

/** Order of the top-level groups in either browse list (#914). */
export type GroupOrder = 'newest' | 'oldest'

const OTHER_SERIES = 'Other'

function seriesKey(set: SetInfo): string {
  return set.series || OTHER_SERIES
}

/** The catalog arrives oldest-first; `newest` walks it in reverse so both
 *  the series order and the sets within each series flip together. */
function groupBySeries(sets: SetInfo[], groupOrder: GroupOrder): SeriesGroup[] {
  const order: string[] = []
  const buckets = new Map<string, SetInfo[]>()
  const source = groupOrder === 'newest' ? [...sets].reverse() : sets
  for (const s of source) {
    const key = seriesKey(s)
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(s)
  }
  return order.map((series) => ({ series, sets: buckets.get(series)! }))
}

function groupByGeneration(species: PokedexEntry[], order: GroupOrder): PokedexGroup[] {
  const groups = POKEDEX_GENERATIONS.map((gen) => ({
    label: gen.label,
    species: species.filter((s) => s.number >= gen.start && s.number <= gen.end),
  })).filter((group) => group.species.length > 0)
  return order === 'newest' ? groups.reverse() : groups
}

export type RarityBucket = 'all' | 'holo' | 'rare' | 'ultra'

export function inBucket(card: SetCard, bucket: RarityBucket): boolean {
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

export type CardSort = 'number' | 'name' | 'price-desc'

function compareCards(a: SetCard, b: SetCard, sort: CardSort): number {
  if (sort === 'name') return (a.name || '').localeCompare(b.name || '')
  if (sort === 'price-desc') {
    const am = a.market ?? -Infinity
    const bm = b.market ?? -Infinity
    return bm - am
  }
  const an = parseInt((a.number || '').split('/')[0], 10)
  const bn = parseInt((b.number || '').split('/')[0], 10)
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
  return (a.number || '').localeCompare(b.number || '')
}

function toInputLine(card: SetCard, setName: string): string {
  return `${card.name} | ${setName} | ${card.number}`
}

export interface BrowseController {
  viewMode: BrowseViewMode
  setViewMode: (m: BrowseViewMode) => void
  groups: SeriesGroup[]
  activeSet: SetInfo | null
  setActiveSet: (s: SetInfo | null) => void
  cards: SetCard[] | null
  filteredCards: SetCard[]
  cardsLoading: boolean
  cardsError: string | null
  search: string
  setSearch: (v: string) => void
  bucket: RarityBucket
  setBucket: (b: RarityBucket) => void
  category: CategoryFilter
  setCategory: (c: CategoryFilter) => void
  sort: CardSort
  setSort: (s: CardSort) => void
  // Group order + collapse for both top-level lists (#914).
  seriesOrder: GroupOrder
  setSeriesOrder: (o: GroupOrder) => void
  generationOrder: GroupOrder
  setGenerationOrder: (o: GroupOrder) => void
  collapsedGroups: ReadonlySet<string>
  toggleGroupCollapsed: (label: string) => void
  addedCount: number | null
  addCards: (toAdd: SetCard[]) => void
  addAll: () => void
  addHolos: () => void
  addRares: () => void
  // Pokedex view (#577) — national dex # → every printing across all sets.
  pokedexGroups: PokedexGroup[]
  pokedexFilter: string
  setPokedexFilter: (v: string) => void
  activePokemon: PokedexEntry | null
  setActivePokemon: (p: PokedexEntry | null) => void
  pokedexCards: PokedexCard[] | null
  pokedexCardsLoading: boolean
  pokedexCardsError: string | null
  addPokedexCards: (toAdd: PokedexCard[]) => void
  addAllPrintings: () => void
  // Class view (#911, #916) — card class → the class's name index (every
  // distinct trainer/object/character, pokedex-style) → every printing of
  // one name across all sets.
  activeClass: CardClassEntry | null
  setActiveClass: (c: CardClassEntry | null) => void
  classCards: PokedexCard[] | null
  classNameGroups: ClassNameEntry[]
  classCardsLoading: boolean
  classCardsError: string | null
  classSearch: string
  setClassSearch: (v: string) => void
  activeClassCardName: string | null
  setActiveClassCardName: (n: string | null) => void
  activeClassCards: PokedexCard[]
  addAllClassCards: () => void
}

export function useBrowseController(active: boolean): BrowseController {
  const { settings, appendInputLines } = useAppStore()

  const [sets, setSets] = useState<SetInfo[]>(BAKED_SETS)
  const [revalidatedSets, setRevalidatedSets] = useState(false)
  const [activeSet, setActiveSet] = useState<SetInfo | null>(null)
  const [cards, setCards] = useState<SetCard[] | null>(null)
  const [cardsError, setCardsError] = useState<string | null>(null)
  const [cardsLoading, setCardsLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [bucket, setBucket] = useState<RarityBucket>('all')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [sort, setSort] = useState<CardSort>('number')
  // Group order + collapse (#914). Set view defaults newest-first (matching
  // the pre-existing order); the dex reads naturally Gen I → Gen IX.
  const [seriesOrder, setSeriesOrder] = useState<GroupOrder>('newest')
  const [generationOrder, setGenerationOrder] = useState<GroupOrder>('oldest')
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const [addedCount, setAddedCount] = useState<number | null>(null)

  const [viewMode, setViewModeState] = useState<BrowseViewMode>('set')
  const [pokedexFilter, setPokedexFilter] = useState('')
  const [activePokemon, setActivePokemon] = useState<PokedexEntry | null>(null)
  const [pokedexCards, setPokedexCards] = useState<PokedexCard[] | null>(null)
  const [pokedexCardsError, setPokedexCardsError] = useState<string | null>(null)
  const [pokedexCardsLoading, setPokedexCardsLoading] = useState(false)

  const [activeClass, setActiveClass] = useState<CardClassEntry | null>(null)
  const [classCards, setClassCards] = useState<PokedexCard[] | null>(null)
  const [classCardsError, setClassCardsError] = useState<string | null>(null)
  const [classCardsLoading, setClassCardsLoading] = useState(false)
  const [classSearch, setClassSearch] = useState('')
  const [activeClassCardName, setActiveClassCardName] = useState<string | null>(null)

  const cardCacheRef = useRef<Map<string, SetCard[]>>(new Map())
  const pokedexCacheRef = useRef<Map<number, PokedexCard[]>>(new Map())
  const classCacheRef = useRef<Map<string, PokedexCard[]>>(new Map())

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!active) return
    setViewModeState('set')
    setActiveSet(null)
    setCards(null)
    setCardsError(null)
    setSearch('')
    setBucket('all')
    setCategory('all')
    setSort('number')
    setSeriesOrder('newest')
    setGenerationOrder('oldest')
    setCollapsedGroups(new Set())
    setAddedCount(null)
    setActivePokemon(null)
    setPokedexCards(null)
    setPokedexCardsError(null)
    setPokedexFilter('')
    setActiveClass(null)
    setClassCards(null)
    setClassCardsError(null)
    setClassSearch('')
    setActiveClassCardName(null)
  }, [active])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Switching organisation always lands on that view's top-level list:
  // set view → the set grid, pokedex view → the species index, class view →
  // the class picker. Clears the drill-in state on every side and the shared
  // "added N lines" status so the toggle is a clean reset, not a
  // half-remembered prior position.
  function setViewMode(mode: BrowseViewMode) {
    setViewModeState(mode)
    setActiveSet(null)
    setActivePokemon(null)
    setActiveClass(null)
    setActiveClassCardName(null)
    setAddedCount(null)
  }

  useEffect(() => {
    if (!active || revalidatedSets) return
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchSets(settings.apiKey || undefined)
        if (!cancelled) setSets(data)
      } catch {
        // Swallow — baked catalog is on screen.
      } finally {
        if (!cancelled) setRevalidatedSets(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, revalidatedSets, settings.apiKey])

  useEffect(() => {
    if (!activeSet) return
    let cancelled = false
    const load = async () => {
      setAddedCount(null)
      setCardsError(null)

      const cached = cardCacheRef.current.get(activeSet.id)
      if (cached) {
        setCards(cached)
        setCardsLoading(false)
        return
      }

      setCardsLoading(true)
      setCards(null)
      try {
        const data = await fetchSetCards(activeSet.id, settings.apiKey || undefined)
        if (!cancelled) {
          cardCacheRef.current.set(activeSet.id, data)
          setCards(data)
        }
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

  useEffect(() => {
    if (!activePokemon) return
    let cancelled = false
    const load = async () => {
      setAddedCount(null)
      setPokedexCardsError(null)

      const cached = pokedexCacheRef.current.get(activePokemon.number)
      if (cached) {
        setPokedexCards(cached)
        setPokedexCardsLoading(false)
        return
      }

      setPokedexCardsLoading(true)
      setPokedexCards(null)
      try {
        const data = await fetchPokedexCards(activePokemon.number, settings.apiKey || undefined)
        if (!cancelled) {
          pokedexCacheRef.current.set(activePokemon.number, data)
          setPokedexCards(data)
        }
      } catch (err) {
        if (!cancelled) setPokedexCardsError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setPokedexCardsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activePokemon, settings.apiKey])

  useEffect(() => {
    if (!activeClass) return
    let cancelled = false
    const load = async () => {
      setAddedCount(null)
      setClassCardsError(null)
      setClassSearch('')
      setActiveClassCardName(null)

      const cached = classCacheRef.current.get(activeClass.id)
      if (cached) {
        setClassCards(cached)
        setClassCardsLoading(false)
        return
      }

      setClassCardsLoading(true)
      setClassCards(null)
      try {
        const data = await fetchClassCards(activeClass.id, settings.apiKey || undefined)
        if (!cancelled) {
          classCacheRef.current.set(activeClass.id, data)
          setClassCards(data)
        }
      } catch (err) {
        if (!cancelled) setClassCardsError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setClassCardsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activeClass, settings.apiKey])

  const groups = useMemo(() => groupBySeries(sets, seriesOrder), [sets, seriesOrder])

  const pokedexGroups = useMemo(() => {
    const term = pokedexFilter.trim().toLowerCase()
    const species = term
      ? BAKED_POKEDEX.filter(
          (s) => s.name.toLowerCase().includes(term) || String(s.number) === term,
        )
      : BAKED_POKEDEX
    return groupByGeneration(species, generationOrder)
  }, [pokedexFilter, generationOrder])

  function toggleGroupCollapsed(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const filteredCards = useMemo(() => {
    if (!cards) return []
    const term = search.trim().toLowerCase()
    const out = cards.filter((c) => {
      if (!inBucket(c, bucket)) return false
      if (category !== 'all' && !inCategory(c, category)) return false
      if (!term) return true
      return (
        (c.name || '').toLowerCase().includes(term) ||
        (c.number || '').toLowerCase().includes(term) ||
        (c.rarity || '').toLowerCase().includes(term)
      )
    })
    out.sort((a, b) => compareCards(a, b, sort))
    return out
  }, [cards, search, bucket, category, sort])

  function addCards(toAdd: SetCard[]) {
    if (!activeSet || toAdd.length === 0) return
    const added = appendInputLines(toAdd.map((c) => toInputLine(c, activeSet.name)))
    setAddedCount(added)
  }

  function addAll() {
    addCards(filteredCards)
  }

  function addHolos() {
    addCards((cards ?? []).filter((c) => inBucket(c, 'holo')))
  }

  function addRares() {
    addCards((cards ?? []).filter((c) => inBucket(c, 'rare')))
  }

  function addPokedexCards(toAdd: PokedexCard[]) {
    if (toAdd.length === 0) return
    const added = appendInputLines(toAdd.map((c) => toInputLine(c, c.setName)))
    setAddedCount(added)
  }

  function addAllPrintings() {
    addPokedexCards(pokedexCards ?? [])
  }

  // Class view (#911, #916). Classes run big (Supporter is 1000+ cards), so
  // Browse walks them the same way it walks the Pokédex: a name index first
  // (the API already groups printings by name), then every printing of one
  // name — that's the "walk Marnie" path, now a tap instead of a search.
  const classNameGroups = useMemo<ClassNameEntry[]>(() => {
    if (!classCards) return []
    const groups: ClassNameEntry[] = []
    for (const card of classCards) {
      const name = card.name || 'Unnamed card'
      const last = groups.at(-1)
      if (last?.name === name) last.count += 1
      else groups.push({ name, count: 1, sample: card })
    }
    return groups
  }, [classCards])

  const filteredClassNameGroups = useMemo(() => {
    const term = classSearch.trim().toLowerCase()
    if (!term) return classNameGroups
    return classNameGroups.filter((g) => g.name.toLowerCase().includes(term))
  }, [classNameGroups, classSearch])

  const activeClassCards = useMemo(
    () => (classCards ?? []).filter((c) => c.name === activeClassCardName),
    [classCards, activeClassCardName],
  )

  function addAllClassCards() {
    addPokedexCards(activeClassCards)
  }

  return {
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
    addCards,
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
    addPokedexCards,
    addAllPrintings,
    activeClass,
    setActiveClass,
    classCards,
    classNameGroups: filteredClassNameGroups,
    classCardsLoading,
    classCardsError,
    classSearch,
    setClassSearch,
    activeClassCardName,
    setActiveClassCardName,
    activeClassCards,
    addAllClassCards,
  }
}
