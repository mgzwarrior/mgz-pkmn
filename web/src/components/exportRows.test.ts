import { describe, it, expect } from 'vitest'
import { itemsToExportRows } from './exportRows'

describe('itemsToExportRows', () => {
  it('maps an item to a matched row carrying its payload + price', () => {
    const rows = itemsToExportRows([
      {
        card: { id: 'base1-4', name: 'Charizard' },
        card_name: 'Charizard',
        card_number: '4',
        card_set_id: 'base1',
        price_snapshot: 250,
        quantity: 1,
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].matched).toBe(true)
    expect(rows[0].card).toEqual({ id: 'base1-4', name: 'Charizard' })
    expect(rows[0].pricing.market).toBe(250)
    expect(rows[0].query.number).toBe('4')
  })

  it('expands a collection item into one row per owned copy (#773 review)', () => {
    const rows = itemsToExportRows([
      { card: { id: 'base1-4', name: 'Charizard' }, card_name: 'Charizard', quantity: 3 },
    ])
    // Three copies → three rows, so exports and price totals match the count.
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => (r.card as { id: string }).id === 'base1-4')).toBe(true)
  })

  it('treats a missing quantity as a single copy (want-list items)', () => {
    const rows = itemsToExportRows([{ card: { id: 'base1-2', name: 'Blastoise' } }])
    expect(rows).toHaveLength(1)
  })
})
