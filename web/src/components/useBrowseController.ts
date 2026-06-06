/**
 * useBrowseController — shared state + effects for BrowsePanel and
 * BrowseModal. Owns the set catalog (seeded from BAKED_SETS, then
 * revalidated against `/api/v1/sets`), the currently-active set, the
 * trimmed card payload for that set (cached per-id for the lifetime
 * of the React tree), and the search / rarity / sort controls.
 *
 * `active` should reflect whether the consuming surface is visible —
 * when it flips true the controller resets transient view state so
 * the user always lands on the set list, not whatever they were
 * browsing last time.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSetCards, fetchSets } from '../api/client'
import { BAKED_SETS } from '../data/sets'
import { useAppStore } from '../store'
import type { SetCard, SetInfo } from '../types'

export interface SeriesGroup {
  series: string
  sets: SetInfo[]
}

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

function toInputLine(card: SetCard, set: SetInfo): string {
  return `${card.name} | ${set.name} | ${card.number}`
}

export interface BrowseController {
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
  sort: CardSort
  setSort: (s: CardSort) => void
  addedCount: number | null
  addCards: (toAdd: SetCard[]) => void
  addAll: () => void
  addHolos: () => void
  addRares: () => void
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
  const [sort, setSort] = useState<CardSort>('number')
  const [addedCount, setAddedCount] = useState<number | null>(null)

  const cardCacheRef = useRef<Map<string, SetCard[]>>(new Map())

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!active) return
    setActiveSet(null)
    setCards(null)
    setCardsError(null)
    setSearch('')
    setBucket('all')
    setSort('number')
    setAddedCount(null)
  }, [active])
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const groups = useMemo(() => groupBySeries(sets), [sets])

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
    const added = appendInputLines(toAdd.map((c) => toInputLine(c, activeSet)))
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

  return {
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
  }
}
