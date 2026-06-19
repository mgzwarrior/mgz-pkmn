import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  RARITY_WEIGHTS,
  DEFAULT_WEIGHT,
  rarityWeight,
  weightedSample,
  rarityTier,
  chaseTierForSet,
  isEligible,
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
    // background top-up reuses the cached card list (still one fetch). The
    // top-up is async, so wait for the stack to refill rather than reading it
    // synchronously — under full-suite contention the fill hasn't always
    // landed by the time `current` flips to 'b' (#387, #653).
    await waitFor(() => expect(result.current.current!.card.id).toBe('b'))
    await waitFor(() =>
      expect(result.current.upcoming.map((c) => c.card.id)).toEqual(['c', 'd']),
    )
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

  it('drops cards matching an exclusion key (set_id, number) from the pool', async () => {
    // `card(id)` sets number === id, so the key for card 'a' in set sv1 is
    // 'sv1::a' — the shape the library-aware exclusion (#581) produces.
    const seenSet = new Set<string>()
    const excludedKeys = new Set<string>(['sv1::a', 'sv1::c'])
    const { result } = renderHook(() =>
      useSwipeCandidates({ active: true, seenSet, excludedKeys, rng: () => 0 }),
    )

    await waitFor(() => expect(result.current.current).not.toBeNull())
    const ids = [
      result.current.current!.card.id,
      ...result.current.upcoming.map((c) => c.card.id),
    ]
    expect(ids).not.toContain('a')
    expect(ids).not.toContain('c')
    expect(ids).toEqual(['b', 'd'])
  })

  it('prunes a now-excluded card from the prefetched stack and tops up', async () => {
    const seenSet = new Set<string>()
    const { result, rerender } = renderHook(
      ({ excludedKeys }) =>
        useSwipeCandidates({ active: true, seenSet, excludedKeys, rng: () => 0 }),
      { initialProps: { excludedKeys: new Set<string>() } },
    )

    await waitFor(() =>
      expect(result.current.upcoming.length).toBe(STACK_SIZE - 1),
    )
    expect(result.current.current!.card.id).toBe('a')

    // The top card becomes excluded (e.g. the user just turned on "hide
    // owned"); it's pruned and 'b' rises to the top, backfilled by 'd'.
    // Wait for the async top-up to settle before asserting the full stack.
    rerender({ excludedKeys: new Set<string>(['sv1::a']) })
    await waitFor(() => {
      const ids = [
        result.current.current?.card.id,
        ...result.current.upcoming.map((c) => c.card.id),
      ]
      expect(ids).toEqual(['b', 'c', 'd'])
    })
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

describe('rarityTier', () => {
  it('collapses rarities into ordered bands', () => {
    expect(rarityTier('Common')).toBe(0)
    expect(rarityTier('Uncommon')).toBe(1)
    expect(rarityTier('Rare')).toBe(2)
    expect(rarityTier('Rare Holo')).toBe(2)
    expect(rarityTier('Trainer Gallery Rare Holo')).toBe(2)
    expect(rarityTier('Rare Holo EX')).toBe(3)
    expect(rarityTier('Rare Holo VMAX')).toBe(3)
    expect(rarityTier('Double Rare')).toBe(3)
    expect(rarityTier('Ultra Rare')).toBe(3)
    expect(rarityTier('Illustration Rare')).toBe(4)
    expect(rarityTier('Special Illustration Rare')).toBe(4)
    expect(rarityTier('Hyper Rare')).toBe(4)
  })

  it('treats null / unknown rarity as a low rare (tier 2)', () => {
    expect(rarityTier(null)).toBe(2)
    expect(rarityTier('Brand New Rarity')).toBe(2)
  })
})

describe('chaseTierForSet', () => {
  it('returns the highest tier present in the set', () => {
    // Modern set — ceiling is Special Illustration Rare.
    expect(
      chaseTierForSet([
        card('a', 'Common'),
        card('b', 'Rare'),
        card('c', 'Special Illustration Rare'),
      ]),
    ).toBe(4)
    // Base-era set — ceiling is only Rare Holo.
    expect(
      chaseTierForSet([card('a', 'Common'), card('b', 'Rare Holo')]),
    ).toBe(2)
  })
})

describe('isEligible', () => {
  it('all keeps every rarity', () => {
    expect(isEligible('Common', 'all', 4)).toBe(true)
  })

  it('rare drops Common + Uncommon (absolute tier ≥ 2)', () => {
    expect(isEligible('Common', 'rare', 4)).toBe(false)
    expect(isEligible('Uncommon', 'rare', 4)).toBe(false)
    expect(isEligible('Rare', 'rare', 4)).toBe(true)
    expect(isEligible('Rare Holo', 'rare', 4)).toBe(true)
  })

  it('chase keeps only the set top tier — age-scaled', () => {
    // Modern set (max tier 4) keeps only secret/illustration cards.
    expect(isEligible('Rare Holo', 'chase', 4)).toBe(false)
    expect(isEligible('Special Illustration Rare', 'chase', 4)).toBe(true)
    // Base-era set (max tier 2) keeps its Rare Holos.
    expect(isEligible('Rare Holo', 'chase', 2)).toBe(true)
    expect(isEligible('Common', 'chase', 2)).toBe(false)
  })
})

describe('useSwipeCandidates — rarity floor', () => {
  beforeEach(() => {
    mockFetchSets.mockReset()
    mockFetchSetCards.mockReset()
    mockFetchSets.mockResolvedValue(ONE_SET)
  })

  it('chase floor surfaces only the set top tier', async () => {
    mockFetchSetCards.mockResolvedValue([
      card('c1', 'Common'),
      card('c2', 'Common'),
      card('chase', 'Special Illustration Rare'),
    ])
    const { result } = renderHook(() =>
      useSwipeCandidates({
        active: true,
        seenSet: new Set(),
        rarityFloor: 'chase',
        rng: () => 0,
      }),
    )

    await waitFor(() => expect(result.current.current).not.toBeNull())
    const ids = [
      result.current.current!.card.id,
      ...result.current.upcoming.map((c) => c.card.id),
    ]
    // Only the SIR clears the chase floor; the Commons are excluded.
    expect(ids).toEqual(['chase'])
  })

  it('rare floor drops Common + Uncommon', async () => {
    mockFetchSetCards.mockResolvedValue([
      card('c', 'Common'),
      card('u', 'Uncommon'),
      card('r', 'Rare'),
      card('h', 'Rare Holo'),
    ])
    const { result } = renderHook(() =>
      useSwipeCandidates({
        active: true,
        seenSet: new Set(),
        rarityFloor: 'rare',
        rng: () => 0,
      }),
    )

    await waitFor(() =>
      expect([
        result.current.current?.card.id,
        ...result.current.upcoming.map((c) => c.card.id),
      ]).toEqual(['r', 'h']),
    )
  })

  it('all floor keeps Commons in the pool', async () => {
    mockFetchSetCards.mockResolvedValue([
      card('c1', 'Common'),
      card('c2', 'Common'),
      card('r', 'Rare'),
    ])
    const { result } = renderHook(() =>
      useSwipeCandidates({
        active: true,
        seenSet: new Set(),
        rarityFloor: 'all',
        rng: () => 0,
      }),
    )

    await waitFor(() =>
      expect(result.current.upcoming.length).toBe(STACK_SIZE - 1),
    )
    const ids = [
      result.current.current!.card.id,
      ...result.current.upcoming.map((c) => c.card.id),
    ]
    expect(ids).toContain('c1')
  })
})
