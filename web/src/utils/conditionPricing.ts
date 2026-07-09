import type { CardCondition, ConditionMultipliers, Row, Settings } from '../types'

export const DEFAULT_CONDITION: CardCondition = 'NM'

export const CONDITION_OPTIONS: { value: CardCondition; label: string }[] = [
  { value: 'NM', label: 'Near Mint (NM)' },
  { value: 'LP', label: 'Lightly Played (LP)' },
  { value: 'MP', label: 'Moderately Played (MP)' },
  { value: 'HP', label: 'Heavily Played (HP)' },
]

export const CONDITION_LABELS: Record<CardCondition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
}

export function isCardCondition(value: unknown): value is CardCondition {
  return (
    typeof value === 'string' &&
    CONDITION_OPTIONS.some((option) => option.value === value)
  )
}

export const DEFAULT_CONDITION_MULTIPLIERS: ConditionMultipliers = {
  NM: 1,
  LP: 0.85,
  MP: 0.65,
  HP: 0.45,
}

export interface ConditionPricing {
  condition: CardCondition
  multiplier: number
  adjustedMarket: number | null
  hasAdjustment: boolean
}

export function rowConditionKey(row: Row): string {
  const cardId = row.card?.id as string | undefined
  if (cardId) return `card:${cardId}`
  return `query:${row.query.raw.trim().toLowerCase()}`
}

export function defaultCondition(settings: Settings): CardCondition {
  return settings.condition ?? DEFAULT_CONDITION
}

export function conditionForRow(
  row: Row,
  settings: Settings,
  rowConditionOverrides?: Record<string, CardCondition>,
): CardCondition {
  return rowConditionOverrides?.[rowConditionKey(row)] ?? defaultCondition(settings)
}

export function multiplierFor(
  condition: CardCondition,
  multipliers?: Partial<ConditionMultipliers>,
): number {
  const configured = multipliers?.[condition]
  if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0) {
    return configured
  }
  return DEFAULT_CONDITION_MULTIPLIERS[condition]
}

export function adjustedMarketFor(
  market: number | null,
  condition: CardCondition,
  multipliers?: Partial<ConditionMultipliers>,
): number | null {
  if (market == null) return null
  return roundMoney(market * multiplierFor(condition, multipliers))
}

export function conditionPricingForRow(
  row: Row,
  settings: Settings,
  rowConditionOverrides: Record<string, CardCondition>,
): ConditionPricing {
  const condition = conditionForRow(row, settings, rowConditionOverrides)
  const multiplier = multiplierFor(condition, settings.conditionMultipliers)
  const adjustedMarket = row.pricing.market == null ? null : roundMoney(row.pricing.market * multiplier)
  return {
    condition,
    multiplier,
    adjustedMarket,
    hasAdjustment: adjustedMarket != null && adjustedMarket !== row.pricing.market,
  }
}

export function effectiveMarket(row: Row): number | null {
  return row.pricing.adjusted_market ?? row.pricing.market
}

export function withConditionPricing(
  row: Row,
  settings: Settings,
  rowConditionOverrides: Record<string, CardCondition>,
): Row {
  const pricing = conditionPricingForRow(row, settings, rowConditionOverrides)
  return {
    ...row,
    pricing: {
      ...row.pricing,
      condition: pricing.condition,
      condition_multiplier: pricing.multiplier,
      adjusted_market: pricing.adjustedMarket,
    },
  }
}

export function rowsWithConditionPricing(
  rows: Row[],
  settings: Settings,
  rowConditionOverrides: Record<string, CardCondition>,
): Row[] {
  return rows.map((row) => withConditionPricing(row, settings, rowConditionOverrides))
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
