import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResultsTable } from './ResultsTable'
import { applyFilters, applySort } from './resultsTableFilter'
import { useAppStore } from '../store'
import type { Row } from '../types'

vi.mock('../api/client', () => ({
  addOverride: vi.fn(),
}))

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

describe('ResultsTable', () => {
  it('shows empty-state message when there are no rows', () => {
    useAppStore.setState({ rows: [], isRunning: false, progress: null })
    render(<ResultsTable />)
    expect(screen.getByText(/results will appear here/i)).toBeInTheDocument()
  })
})

describe('applyFilters', () => {
  const rows: Row[] = [
    makeRow({
      card: { name: 'Charizard', rarity: 'Holo Rare', set: { name: 'Base Set' } },
      pricing: { market: 100, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
    }),
    makeRow({
      card: { name: 'Pikachu', rarity: 'Common', set: { name: 'Jungle' } },
      pricing: { market: 5, currency: 'USD', variant: null, source: 'Cardmarket', url: null },
    }),
    makeRow({
      card: { name: 'Mew ex', rarity: 'Double Rare', set: { name: 'Scarlet & Violet' } },
      pricing: { market: 25, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
    }),
  ]

  it('substring text match is case-insensitive', () => {
    expect(
      applyFilters(rows, {
        name: 'char',
        set: '',
        rarity: '',
        marketMin: '',
        marketMax: '',
        source: '',
      }),
    ).toHaveLength(1)
  })

  it('min/max market range excludes prices outside the band', () => {
    const filtered = applyFilters(rows, {
      name: '',
      set: '',
      rarity: '',
      marketMin: '10',
      marketMax: '50',
      source: '',
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].card?.name as string | undefined).toBe('Mew ex')
  })

  it('combines multiple column filters as AND', () => {
    const filtered = applyFilters(rows, {
      name: 'a',
      set: '',
      rarity: 'rare',
      marketMin: '',
      marketMax: '',
      source: 'tcg',
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].card?.name as string | undefined).toBe('Charizard')
  })
})

describe('applySort', () => {
  const rows: Row[] = [
    makeRow({
      card: { name: 'Charizard' },
      pricing: { market: 100, currency: 'USD', variant: null, source: null, url: null },
    }),
    makeRow({
      card: { name: 'Abra' },
      pricing: { market: 50, currency: 'USD', variant: null, source: null, url: null },
    }),
    makeRow({
      card: { name: 'Zubat' },
      pricing: { market: 1, currency: 'USD', variant: null, source: null, url: null },
    }),
  ]

  it('returns input unchanged when sort is off', () => {
    expect(applySort(rows, null, null).map((r) => r.card?.name)).toEqual([
      'Charizard',
      'Abra',
      'Zubat',
    ])
  })

  it('sorts strings ascending', () => {
    expect(applySort(rows, 'name', 'asc').map((r) => r.card?.name)).toEqual([
      'Abra',
      'Charizard',
      'Zubat',
    ])
  })

  it('sorts numbers descending', () => {
    expect(applySort(rows, 'market', 'desc').map((r) => r.pricing.market)).toEqual([
      100, 50, 1,
    ])
  })
})

describe('ResultsTable: header sort cycle', () => {
  it('clicking the Name header cycles asc → desc → off', () => {
    useAppStore.setState({
      rows: [
        makeRow({ card: { name: 'Charizard' } }),
        makeRow({ card: { name: 'Abra' } }),
        makeRow({ card: { name: 'Zubat' } }),
      ],
      isRunning: false,
      progress: null,
    })

    render(<ResultsTable />)
    const header = screen.getByRole('button', { name: /sort by name/i })

    function firstBodyRow(): string {
      // First non-header row contains the first card name.
      const rows = screen.getAllByRole('row')
      return rows[rows.length === 1 ? 0 : 1].textContent ?? ''
    }

    fireEvent.click(header) // asc
    expect(firstBodyRow()).toContain('Abra')

    fireEvent.click(header) // desc
    expect(firstBodyRow()).toContain('Zubat')

    fireEvent.click(header) // off → original order
    expect(firstBodyRow()).toContain('Charizard')

    useAppStore.setState({ rows: [] })
  })

  it('toggling Filter reveals filter inputs and narrows displayed rows', () => {
    useAppStore.setState({
      rows: [
        makeRow({ card: { name: 'Charizard' } }),
        makeRow({ card: { name: 'Pikachu' } }),
      ],
      isRunning: false,
      progress: null,
    })

    render(<ResultsTable />)
    fireEvent.click(screen.getByRole('button', { name: /filter/i }))
    const nameFilter = screen.getByLabelText(/filter by name/i)
    fireEvent.change(nameFilter, { target: { value: 'char' } })

    const bodyRows = screen.getAllByRole('row').filter((tr) => tr.querySelector('td'))
    expect(bodyRows).toHaveLength(1)
    expect(bodyRows[0].textContent).toContain('Charizard')

    useAppStore.setState({ rows: [] })
  })
})
