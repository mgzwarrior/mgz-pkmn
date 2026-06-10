import { describe, it, expect } from 'vitest'
import { hasEbayData, soldPriceSeries } from './ebayComps'
import type { EbaySoldComp } from '../types'

function comp(over: Partial<EbaySoldComp> = {}): EbaySoldComp {
  return { price: 10, date: null, condition: null, url: null, ...over }
}

describe('soldPriceSeries', () => {
  it('returns [] for null / empty', () => {
    expect(soldPriceSeries(null)).toEqual([])
    expect(soldPriceSeries(undefined)).toEqual([])
    expect(soldPriceSeries([])).toEqual([])
  })

  it('sorts oldest → newest when every comp is dated', () => {
    const comps = [
      comp({ price: 30, date: '2026-03-01' }),
      comp({ price: 10, date: '2026-01-01' }),
      comp({ price: 20, date: '2026-02-01' }),
    ]
    expect(soldPriceSeries(comps)).toEqual([10, 20, 30])
  })

  it('reverses source order (newest-first → oldest-first) when dates are missing', () => {
    // No dates → comps are newest-first as given; reverse so newest is last.
    const comps = [comp({ price: 3 }), comp({ price: 2 }), comp({ price: 1 })]
    expect(soldPriceSeries(comps)).toEqual([1, 2, 3])
  })

  it('falls back to reversal when only some comps are dated', () => {
    const comps = [comp({ price: 3, date: '2026-03-01' }), comp({ price: 1 })]
    expect(soldPriceSeries(comps)).toEqual([1, 3])
  })
})

describe('hasEbayData', () => {
  it('is false when every signal is absent', () => {
    expect(hasEbayData({})).toBe(false)
    expect(
      hasEbayData({ ebay_sold_median: null, ebay_active_floor: null, ebay_sold_comps: [] }),
    ).toBe(false)
  })

  it('is true when any signal is present', () => {
    expect(hasEbayData({ ebay_sold_median: 12 })).toBe(true)
    expect(hasEbayData({ ebay_active_floor: 9 })).toBe(true)
    expect(hasEbayData({ ebay_sold_comps: [comp()] })).toBe(true)
  })
})
