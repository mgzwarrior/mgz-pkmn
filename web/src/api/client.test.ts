import { describe, it, expect } from 'vitest'
import { dedupeRows } from './client'
import type { Row } from '../types'

function makeRow(over: Partial<Row> = {}): Row {
  return {
    query: { raw: '', name: '' } as Row['query'],
    card: null,
    pricing: { market: null, currency: 'USD', variant: null, source: null, url: null },
    tag: '',
    matched: true,
    reason: '',
    ...over,
  }
}

describe('dedupeRows', () => {
  it('removes matched rows sharing a card id, keeping the first occurrence', () => {
    const rows: Row[] = [
      makeRow({ card: { id: 'a', name: 'Charizard' } }),
      makeRow({ card: { id: 'b', name: 'Pikachu' } }),
      makeRow({ card: { id: 'a', name: 'Charizard' } }),
    ]
    const deduped = dedupeRows(rows)
    expect(deduped).toHaveLength(2)
    expect((deduped[0].card as { id: string }).id).toBe('a')
    expect((deduped[1].card as { id: string }).id).toBe('b')
  })

  it('preserves unmatched rows and rows missing a card id', () => {
    const rows: Row[] = [
      makeRow({ matched: false, card: null }),
      makeRow({ matched: false, card: null }),
      makeRow({ card: { name: 'Mystery' } }),
      makeRow({ card: { name: 'Mystery' } }),
    ]
    expect(dedupeRows(rows)).toHaveLength(4)
  })

  it('returns the same row count when there are no duplicates', () => {
    const rows: Row[] = [
      makeRow({ card: { id: 'a' } }),
      makeRow({ card: { id: 'b' } }),
      makeRow({ card: { id: 'c' } }),
    ]
    expect(dedupeRows(rows)).toHaveLength(3)
  })
})
