import { describe, expect, it } from 'vitest'
import type { Row, Settings } from '../types'
import {
  conditionPricingForRow,
  DEFAULT_CONDITION_MULTIPLIERS,
  rowConditionKey,
  rowsWithConditionPricing,
} from './conditionPricing'

function row(overrides: Partial<Row> = {}): Row {
  return {
    query: {
      raw: 'Charizard | Base Set | 4',
      name: 'Charizard',
      set_hint: 'Base Set',
      number: '4',
      variant_hint: null,
      url_hint: null,
      bulk_top: null,
      bulk_all: false,
      price_min: null,
      price_max: null,
    },
    card: { id: 'base1-4', name: 'Charizard' },
    pricing: { market: 100, currency: 'USD', variant: null, source: null, url: null },
    tag: '',
    matched: true,
    reason: 'matched',
    ...overrides,
  }
}

const settings: Settings = {
  apiKey: '',
  maxPrice: null,
  noImages: false,
  tag: '',
  dedupe: false,
  sort: 'number',
  showTimer: false,
  showEbay: false,
  hideOwned: false,
  hidePricing: false,
  swipeRarityFloor: 'chase',
  swipeExcludeOwned: false,
  swipeExcludeChasing: false,
  density: 'comfortable',
  condition: 'LP',
  conditionMultipliers: DEFAULT_CONDITION_MULTIPLIERS,
  exportFields: { xlsx: {}, pdf: {}, 'condensed-pdf': {}, checklist: {} },
  leadWithIdCard: false,
  darkPdfExports: false,
}

describe('condition pricing', () => {
  it('recalculates market prices from the default condition multiplier', () => {
    expect(conditionPricingForRow(row(), settings, {})).toMatchObject({
      condition: 'LP',
      multiplier: 0.85,
      adjustedMarket: 85,
      hasAdjustment: true,
    })
  })

  it('uses per-row overrides ahead of the default condition', () => {
    const r = row()
    expect(
      conditionPricingForRow(r, settings, { [rowConditionKey(r)]: 'HP' }),
    ).toMatchObject({
      condition: 'HP',
      multiplier: 0.45,
      adjustedMarket: 45,
    })
  })

  it('keeps raw market and carries adjusted pricing for export rows', () => {
    const [prepared] = rowsWithConditionPricing([row()], settings, {})
    expect(prepared.pricing.market).toBe(100)
    expect(prepared.pricing.condition).toBe('LP')
    expect(prepared.pricing.condition_multiplier).toBe(0.85)
    expect(prepared.pricing.adjusted_market).toBe(85)
  })
})
