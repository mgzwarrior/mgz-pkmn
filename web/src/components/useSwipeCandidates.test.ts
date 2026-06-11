import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  RARITY_WEIGHTS,
  DEFAULT_WEIGHT,
  rarityWeight,
  weightedSample,
  STACK_SIZE,
  useSwipeCandidates,
} from './useSwipeCandidates'
import { fetchSets, fetchSetCards } from '../api/client'
import type { SetCard } from '../types'

describe('rarityWeight', () => {
  it('returns the default for null / unknown rarities', () => {
    expect(rarityWeight(null)).toBe(DEFAULT_WEIGHT)
    expect(rarityWeight('not-a-rarity')).toBe(DEFAULT_WEIGHT)
  })

  it('is case-insensitive against the rarity table', () => {
    expect(rarityWeight('Common')).toBe(RARITY_WEIGHTS.common)
    expect(rarityWeight('COMMON')).toBe(RARITY_WEIGHTS.common)
    expect(rarityWeight('Ultra Rare')).toBe(RARITY_WEIGHTS['ultra rare'])
    expect(rarityWeight('Special Illustration Rare')).toBe(
      RARITY_WEIGHTS['special illustration rare'],
    )
  })

  it('rare tiers carry strictly higher weights than common / uncommon', () => {
    expect(rarityWeight('Common')).toBeLessThan(rarityWeight('Uncommon'))
    expect(rarityWeight('Uncommon')).toBeLessThan(rarityWeight('Rare'))
    expect(rarityWeight('Rare')).toBeLessThan(rarityWeight('Ultra Rare'))
    expect(rarityWeight('Ultra Rare')).toBeLessThan(
      rarityWeight('Special Illustration Rare'),
    )
  })
})

describe('weightedSample', () => {
  it('rng=0 picks the first item with non-zero weight', () => {
    expect(weightedSample([1, 5, 10], () => 0)).toBe(0)
  })

  it('rng→1 picks the last item', () => {
    // 0.9999 lands inside the final bucket regardless of weight skew.
    expect(weightedSample([1, 5, 10], () => 0.9999)).toBe(2)
  })

  it('picks proportionally to weight over many trials', () => {
    // Weights [1, 9] should put ~90% of samples in index 1. A loose
    // tolerance of ±5pp keeps the test stable across RNG seeds.
    const weights = [1, 9]
    const counts = [0, 0]
    const N = 5000
    let seed = 1
    const rng = () => {
      // Mulberry32 — deterministic + fast, no deps.
      seed = (seed + 0x6d2b79f5) >>> 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < N; i++) {
      counts[weightedSample(weights, rng)]++
    }
    const p1 = counts[1] / N
    expect(p1).toBeGreaterThan(0.85)
    expect(p1).toBeLessThan(0.95)
  })

  it('falls back to uniform sampling when all weights are zero', () => {
    // With total=0 the sampler defers to `Math.floor(rng * n)`; rng=0
    // picks index 0, rng→1 picks the last index.
    expect(weightedSample([0, 0, 0], () => 0)).toBe(0)
    expect(weightedSample([0, 0, 0], () => 0.99)).toBe(2)
  })
})

vi.mock('../api/client', () => ({
  fetchSets: vi.fn(),
  fetchSetCards: vi.fn(),
}))
// Empty baked catalog so the live `fetchSets` mock is the sole source of
// truth — keeps the queue deterministic under the injected rng.
vi.mock('../data/sets', () => ({ BAKED_SETS: [] }))

const mockFetchSets = vi.mocked(fetchSets)
const mockFetchSetCards = vi.mocked(fetchSetCards)

function card(id: string, rarity: string | null = 'Common'): SetCard {
  return {
    id,
    name: id.toUpperCase(),
    number: id,
    rarity,
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    thumb: null,
    market: 1,
  }
}

const ONE_SET = [
  { id: 'sv1', name: 'Scarlet & Violet', series: 'SV', total: 4, releaseDate: '2023/03/31' },
]

describe('useSwipeCandidates — prefetched stack', () => {
  beforeEach(() => {
    mockFetchSets.mockReset()
    mockFetchSetCards.mockReset()
    mockFetchSets.mockResolvedValue(ONE_SET)
    // rng pinned to 0 means the weighted sampler always takes the first
    // *eligible* card, so the queue fills in array order minus exclusions.
    mockFetchSetCards.mockResolvedValue([
      card('a'),
      card('b'),
      card('c'),
      card('d'),
    ])
  })

  it('prefetches a full, de-duplicated stack', async () => {
    const seenSet = new Set<string>()
    const { result } = renderHook(() =>
      useSwipeCandidates({ active: true, seenSet, rng: () => 0 }),
    )

    await waitFor(() =>
      expect(result.current.upcoming.length).toBe(STACK_SIZE - 1),
    )
    const ids = [
      result.current.current!.card.id,
      ...result.current.upcoming.map((c) => c.card.id),
    ]
    // Top + peeks are all distinct — no card appears twice in the stack.
    expect(new Set(ids).size).toBe(STACK_SIZE)
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('advance() promotes the next card with no extra fetch', async () => {
    const seenSet = new Set<string>()
    const { result } = renderHook(() =>
      useSwipeCandidates({ active: true, seenSet, rng: () => 0 }),
    )

    await waitFor(() =>
      expect(result.current.upcoming.length).toBe(STACK_SIZE - 1),
    )
    // The whole stack came from a single set fetch.
    expect(mockFetchSetCards).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.advance()
    })

    // The former peek is the new top immediately — no loader, and the
    // background top-up reuses the cached card list (still one fetch).
    await waitFor(() => expect(result.current.current!.card.id).toBe('b'))
    expect(result.current.upcoming.map((c) => c.card.id)).toEqual(['c', 'd'])
    expect(mockFetchSetCards).toHaveBeenCalledTimes(1)
  })

  it('never stacks a card the user has already seen', async () => {
    const seenSet = new Set<string>(['a'])
    const { result } = renderHook(() =>
      useSwipeCandidates({ active: true, seenSet, rng: () => 0 }),
    )

    await waitFor(() =>
      expect(result.current.upcoming.length).toBe(STACK_SIZE - 1),
    )
    const ids = [
      result.current.current!.card.id,
      ...result.current.upcoming.map((c) => c.card.id),
    ]
    expect(ids).not.toContain('a')
    expect(ids).toEqual(['b', 'c', 'd'])
  })

  it('surfaces the exhausted state once the catalog is walked', async () => {
    mockFetchSetCards.mockReset()
    mockFetchSetCards.mockResolvedValue([card('a'), card('b')])

    const seenSet = new Set<string>()
    const { result } = renderHook(() =>
      useSwipeCandidates({ active: true, seenSet, rng: () => 0 }),
    )

    // Two cards, stack of three → the stack holds both, then exhausts.
    await waitFor(() => expect(result.current.upcoming.length).toBe(1))
    act(() => result.current.advance())
    act(() => result.current.advance())
    await waitFor(() => expect(result.current.exhausted).toBe(true))
    expect(result.current.current).toBeNull()
  })
})
