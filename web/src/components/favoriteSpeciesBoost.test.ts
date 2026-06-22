import { describe, it, expect } from 'vitest'
import { favoriteSpeciesBoost } from './favoriteSpeciesBoost'

describe('favoriteSpeciesBoost (#742)', () => {
  const isFavorite = (n: number) => n === 6 // Charizard favorited

  it('boosts a card that prints a favorite species', () => {
    expect(favoriteSpeciesBoost({ dexNumbers: [6] }, isFavorite)).toBeGreaterThan(0)
  })

  it('boosts a multi-species card when any of its numbers is favorited', () => {
    expect(favoriteSpeciesBoost({ dexNumbers: [25, 6] }, isFavorite)).toBeGreaterThan(0)
  })

  it('gives no boost to a non-favorite species', () => {
    expect(favoriteSpeciesBoost({ dexNumbers: [25] }, isFavorite)).toBe(0)
  })

  it('gives no boost when the card carries no dex numbers', () => {
    expect(favoriteSpeciesBoost({ dexNumbers: [] }, isFavorite)).toBe(0)
  })

  it('a favorited card outscores an identical non-favorite via the boost', () => {
    const favorited = favoriteSpeciesBoost({ dexNumbers: [6] }, isFavorite)
    const plain = favoriteSpeciesBoost({ dexNumbers: [1] }, isFavorite)
    expect(favorited).toBeGreaterThan(plain)
  })
})
