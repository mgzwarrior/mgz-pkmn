/**
 * Pure helpers for filtering and sorting result rows in the table view.
 *
 * View-only — exports continue to apply the sort mode chosen in Settings,
 * not the column sort selected here.
 */
import type { Row } from '../types'

export type SortColumn = 'name' | 'set' | 'rarity' | 'market' | 'source'
export type SortDir = 'asc' | 'desc'

export interface Filters {
  name: string
  set: string
  rarity: string
  marketMin: string
  marketMax: string
  source: string
}

export const EMPTY_FILTERS: Filters = {
  name: '',
  set: '',
  rarity: '',
  marketMin: '',
  marketMax: '',
  source: '',
}

export function hasActiveFilters(f: Filters): boolean {
  return Object.values(f).some((v) => v !== '')
}

export function applyFilters(rows: Row[], filters: Filters): Row[] {
  const min = filters.marketMin === '' ? null : Number(filters.marketMin)
  const max = filters.marketMax === '' ? null : Number(filters.marketMax)
  return rows.filter((row) => {
    if (filters.name && !text(getName(row)).includes(filters.name.toLowerCase())) return false
    if (filters.set && !text(getSet(row)).includes(filters.set.toLowerCase())) return false
    if (filters.rarity && !text(getRarity(row)).includes(filters.rarity.toLowerCase())) return false
    if (filters.source && !text(row.pricing.source).includes(filters.source.toLowerCase())) {
      return false
    }
    if (min != null || max != null) {
      const m = row.pricing.market
      if (m == null) return false
      if (min != null && m < min) return false
      if (max != null && m > max) return false
    }
    return true
  })
}

export function applySort(rows: Row[], column: SortColumn | null, dir: SortDir | null): Row[] {
  if (!column || !dir) return rows
  const mul = dir === 'asc' ? 1 : -1
  const get = SORT_ACCESSORS[column]
  const indexed = rows.map((row, i) => ({ row, i }))
  indexed.sort((a, b) => {
    const cmp = compareValues(get(a.row), get(b.row))
    return cmp !== 0 ? cmp * mul : a.i - b.i
  })
  return indexed.map((x) => x.row)
}

const SORT_ACCESSORS: Record<SortColumn, (row: Row) => string | number | null> = {
  name: (row) => getName(row),
  set: (row) => getSet(row),
  rarity: (row) => getRarity(row),
  market: (row) => row.pricing.market,
  source: (row) => row.pricing.source,
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase() : ''
}

function getName(row: Row): string | null {
  return (row.card?.name as string | undefined) ?? row.query.name ?? null
}

function getSet(row: Row): string | null {
  const setObj = row.card?.set as { name?: string } | undefined
  return setObj?.name ?? null
}

function getRarity(row: Row): string | null {
  return (row.card?.rarity as string | undefined) ?? null
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}
