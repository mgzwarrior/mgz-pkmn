import { describe, it, expect } from 'vitest'
import {
  RARITY_WEIGHTS,
  DEFAULT_WEIGHT,
  rarityWeight,
  weightedSample,
} from './useSwipeCandidates'

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
