import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useSwipeProfile,
  _resetSwipeProfileForTests,
} from './useSwipeProfile'
import type { SetCard } from '../types'

function card(overrides: Partial<SetCard> = {}): SetCard {
  return {
    id: 'sv1-1',
    name: 'Pikachu',
    number: '1',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    thumb: null,
    market: 5,
    ...overrides,
  }
}

describe('useSwipeProfile', () => {
  beforeEach(() => {
    _resetSwipeProfileForTests()
  })

  it('starts with empty counters and an empty saved list', () => {
    const { result } = renderHook(() => useSwipeProfile())
    expect(result.current.profile.saved).toEqual([])
    expect(result.current.profile.seen).toEqual([])
    expect(result.current.seenSet.size).toBe(0)
  })

  it('records a pass as -1 weight and adds the card to seen but not saved', () => {
    const { result } = renderHook(() => useSwipeProfile())
    const c = card()
    act(() => {
      result.current.act(c, 'sv1', 'pass')
    })
    expect(result.current.profile.rarity['Rare Holo']).toBe(-1)
    expect(result.current.profile.set['sv1']).toBe(-1)
    expect(result.current.profile.tag['super:Pokémon']).toBe(-1)
    expect(result.current.profile.tag['sub:Basic']).toBe(-1)
    expect(result.current.profile.seen).toEqual(['sv1-1'])
    expect(result.current.profile.saved).toEqual([])
  })

  it('records a save as +1 and a love as +2, both adding to saved', () => {
    const { result } = renderHook(() => useSwipeProfile())
    const a = card({ id: 'sv1-1', name: 'A' })
    const b = card({ id: 'sv1-2', name: 'B' })
    act(() => {
      result.current.act(a, 'sv1', 'save')
      result.current.act(b, 'sv1', 'love')
    })
    expect(result.current.profile.set['sv1']).toBe(3)
    expect(result.current.profile.saved.map((s) => s.id)).toEqual([
      'sv1-1',
      'sv1-2',
    ])
  })

  it('scoreCard reflects the cumulative weights', () => {
    const { result } = renderHook(() => useSwipeProfile())
    act(() => {
      result.current.act(card(), 'sv1', 'save') // +1 each: rarity / set / supertype / subtype
    })
    const score = result.current.scoreCard(card({ id: 'sv1-2' }), 'sv1')
    // rarity(+1) + set(+1) + supertype(+1) + subtype(+1) = 4
    expect(score).toBe(4)
  })

  it('clearSaved leaves counters intact but empties saved', () => {
    const { result } = renderHook(() => useSwipeProfile())
    act(() => {
      result.current.act(card(), 'sv1', 'save')
    })
    expect(result.current.profile.saved.length).toBe(1)
    act(() => {
      result.current.clearSaved()
    })
    expect(result.current.profile.saved).toEqual([])
    expect(result.current.profile.set['sv1']).toBe(1)
  })

  it('adjustWeight nudges an entry and drops it when it lands on 0', () => {
    const { result } = renderHook(() => useSwipeProfile())
    act(() => {
      result.current.act(card(), 'sv1', 'save') // set sv1 = +1
    })
    act(() => {
      result.current.adjustWeight('set', 'sv1', 1) // +1 → +2
    })
    expect(result.current.profile.set['sv1']).toBe(2)
    act(() => {
      result.current.adjustWeight('set', 'sv1', -2) // +2 → 0 → dropped
    })
    expect('sv1' in result.current.profile.set).toBe(false)
  })

  it('clearWeight removes a single entry without touching others', () => {
    const { result } = renderHook(() => useSwipeProfile())
    act(() => {
      result.current.act(card({ rarity: 'Rare Holo' }), 'sv1', 'love')
    })
    expect(result.current.profile.rarity['Rare Holo']).toBe(2)
    expect(result.current.profile.set['sv1']).toBe(2)
    act(() => {
      result.current.clearWeight('rarity', 'Rare Holo')
    })
    expect('Rare Holo' in result.current.profile.rarity).toBe(false)
    expect(result.current.profile.set['sv1']).toBe(2) // untouched
  })

  it('reset clears everything', () => {
    const { result } = renderHook(() => useSwipeProfile())
    act(() => {
      result.current.act(card(), 'sv1', 'love')
    })
    act(() => {
      result.current.reset()
    })
    expect(result.current.profile).toEqual({
      rarity: {},
      set: {},
      tag: {},
      seen: [],
      saved: [],
    })
  })
})
