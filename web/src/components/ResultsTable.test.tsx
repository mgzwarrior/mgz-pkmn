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

  it('clicking a matched row opens the card detail modal', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: {
            id: 'base1-4',
            name: 'Charizard',
            number: '4',
            rarity: 'Rare Holo',
            set: { name: 'Base Set' },
          },
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    // Find the table row via the aria-label we add for matched rows.
    const row = screen.getByLabelText(/View details for Charizard/)
    fireEvent.click(row)
    // The detail modal renders into a portal — dialog role appears once open.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // The 1/N counter confirms we landed on the right row.
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    useAppStore.setState({ rows: [] })
  })

  it('clicking an inner link inside a row does not open the modal', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: {
            id: 'base1-4',
            name: 'Charizard',
            number: '4',
            rarity: 'Rare Holo',
            set: { name: 'Base Set' },
          },
          pricing: {
            market: 250,
            currency: 'USD',
            variant: null,
            source: 'TCGPlayer',
            // A real URL triggers the inline external-link icon in the row.
            url: 'https://example.com/listing',
          },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    // The external-link anchor has title="Open listing" — click that, not the row.
    const link = screen.getByTitle('Open listing')
    fireEvent.click(link)
    expect(screen.queryByRole('dialog')).toBeNull()
    useAppStore.setState({ rows: [] })
  })

  it('unmatched rows are not clickable and do not get the aria-label', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: null,
          matched: false,
          query: { raw: 'GhostMon', name: 'GhostMon' } as Row['query'],
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    // No aria-labelled clickable row exists when the lookup didn't match.
    expect(screen.queryByLabelText(/View details for/)).toBeNull()
    useAppStore.setState({ rows: [] })
  })

  it('pressing Enter on a focused row opens the modal', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: {
            id: 'base1-4',
            name: 'Charizard',
            number: '4',
            rarity: 'Rare Holo',
            set: { name: 'Base Set' },
          },
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    const row = screen.getByLabelText(/View details for Charizard/)
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    useAppStore.setState({ rows: [] })
  })

  it('pressing Space on a focused row opens the modal', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: {
            id: 'base1-4',
            name: 'Charizard',
            number: '4',
            rarity: 'Rare Holo',
            set: { name: 'Base Set' },
          },
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    const row = screen.getByLabelText(/View details for Charizard/)
    fireEvent.keyDown(row, { key: ' ' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    useAppStore.setState({ rows: [] })
  })

  it('Enter on an inner control does not open the modal', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: {
            id: 'base1-4',
            name: 'Charizard',
            number: '4',
            rarity: 'Rare Holo',
            set: { name: 'Base Set' },
          },
          pricing: {
            market: 250,
            currency: 'USD',
            variant: null,
            source: 'TCGPlayer',
            url: 'https://example.com/listing',
          },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    const link = screen.getByTitle('Open listing')
    // The keydown bubbles up to the row's handler, but `closest('a, button, input')`
    // on the target keeps the modal closed.
    fireEvent.keyDown(link, { key: 'Enter', bubbles: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    useAppStore.setState({ rows: [] })
  })

  it('other keys on a row do not open the modal', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: {
            id: 'base1-4',
            name: 'Charizard',
            number: '4',
            rarity: 'Rare Holo',
            set: { name: 'Base Set' },
          },
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    const row = screen.getByLabelText(/View details for Charizard/)
    fireEvent.keyDown(row, { key: 'a' })
    fireEvent.keyDown(row, { key: 'Tab' })
    expect(screen.queryByRole('dialog')).toBeNull()
    useAppStore.setState({ rows: [] })
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

  it('keeps null values at the end in both directions', () => {
    const withNulls: Row[] = [
      makeRow({
        pricing: { market: null, currency: 'USD', variant: null, source: null, url: null },
      }),
      makeRow({
        pricing: { market: 10, currency: 'USD', variant: null, source: null, url: null },
      }),
      makeRow({
        pricing: { market: null, currency: 'USD', variant: null, source: null, url: null },
      }),
      makeRow({
        pricing: { market: 5, currency: 'USD', variant: null, source: null, url: null },
      }),
    ]
    expect(applySort(withNulls, 'market', 'asc').map((r) => r.pricing.market)).toEqual([
      5, 10, null, null,
    ])
    expect(applySort(withNulls, 'market', 'desc').map((r) => r.pricing.market)).toEqual([
      10, 5, null, null,
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

  it('renders the matched/unmatched/shown counts above the table', () => {
    useAppStore.setState({
      rows: [
        makeRow({ card: { name: 'Charizard' }, matched: true }),
        makeRow({ card: { name: 'Pikachu' }, matched: true }),
        makeRow({ card: null, matched: false, query: { raw: 'asdf', name: 'asdf' } as Row['query'] }),
      ],
      isRunning: false,
      progress: null,
    })

    const { container } = render(<ResultsTable />)
    const counts = screen.getByText(/2 matched · 1 unmatched · 3 shown/)
    const table = container.querySelector('table')!

    // The fix for #358: counts must appear before the table in DOM order
    // so they're visible without scrolling on long result sets.
    expect(
      counts.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    useAppStore.setState({ rows: [] })
  })

  it('shows "(of N)" qualifier when a filter hides some rows', () => {
    useAppStore.setState({
      rows: [
        makeRow({ card: { name: 'Charizard' }, matched: true }),
        makeRow({ card: { name: 'Pikachu' }, matched: true }),
        makeRow({ card: { name: 'Squirtle' }, matched: true }),
      ],
      isRunning: false,
      progress: null,
    })

    render(<ResultsTable />)
    expect(screen.getByText(/3 matched · 0 unmatched · 3 shown/)).toBeInTheDocument()
    expect(screen.queryByText(/\(of 3\)/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /filter/i }))
    fireEvent.change(screen.getByLabelText(/filter by name/i), {
      target: { value: 'char' },
    })

    expect(screen.getByText(/1 matched · 0 unmatched · 1 shown/)).toBeInTheDocument()
    expect(screen.getByText(/\(of 3\)/)).toBeInTheDocument()

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
