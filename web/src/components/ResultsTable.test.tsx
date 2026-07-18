import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ResultsTable } from './ResultsTable'
import { applyFilters, applySort } from './resultsTableFilter'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { exportFile, fetchCardOwnership, ownCard, updateRunRowCondition } from '../api/client'
import { _resetCardOwnershipForTests } from './useCardOwnership'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import type { Row } from '../types'

const { fetchMeMock } = vi.hoisted(() => ({ fetchMeMock: vi.fn() }))

vi.mock('../api/client', () => ({
  addOverride: vi.fn(),
  // ResultsTable now reads useAuth to gate the row-level save buttons.
  // The default mock returns the auth-on signed-in shape so existing
  // tests still exercise the save-action surface; the dedicated
  // signed-out test below overrides via mockResolvedValueOnce.
  fetchMe: fetchMeMock,
  logout: vi.fn(),
  // The matched rows trigger a cross-collection ownership lookup (#576);
  // default to "nothing owned" so no badge renders in existing tests.
  fetchCardOwnership: vi.fn(async () => ({})),
  // #707 — real predicate (not a stub) so the "hide owned" / quick-action
  // owned tests exercise the same personal-purpose rule as production.
  hasPersonalOwnership: (
    ownership: { collections: { purpose: string }[] } | null | undefined,
  ): boolean => !!ownership && ownership.collections.some((c) => c.purpose === 'personal'),
  // The bulk action bar (#268) mounts on selection and reads the binder
  // lists; default to empty so the pickers render their no-binders state.
  fetchCollections: vi.fn(async () => []),
  fetchWishlists: vi.fn(async () => []),
  createCollection: vi.fn(),
  createWishlist: vi.fn(),
  addCardToCollection: vi.fn(),
  addCardToWishlist: vi.fn(),
  bulkAddToCollection: vi.fn(async () => ({ added: 0, items: [] })),
  bulkAddToWishlist: vi.fn(async () => ({ added: 0, items: [] })),
  // The bulk bar's want / own toggles (#781) write each selected card to the
  // user's default wishlist / collection via the per-card quick actions.
  wantCard: vi.fn(async () => ({})),
  ownCard: vi.fn(async () => ({})),
  exportFile: vi.fn(async () => undefined),
  updateRunRowCondition: vi.fn(async () => undefined),
}))

beforeEach(() => {
  fetchMeMock.mockReset()
  fetchMeMock.mockResolvedValue({
    user: { id: 1, email: 'u@e.com', display_name: 'U' },
    authEnabled: true,
  })
  _resetAuthStoreForTests()
})

beforeEach(() => {
  // ResultsTable now reads sort + filter state from the store; reset
  // between tests so a previous case's toggled filter or active sort
  // doesn't bleed in (which surfaces a stray "Clear sort & filters"
  // button that breaks `getByRole({ name: /filter/i })`).
  useAppStore.setState({
    viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
    currentRunId: null,
  })
  _resetCardOwnershipForTests()
  _resetCollectionsCacheForTests()
  _resetWishlistsCacheForTests()
  vi.mocked(fetchCardOwnership).mockReset()
  vi.mocked(fetchCardOwnership).mockResolvedValue({})
  vi.mocked(exportFile).mockClear()
  vi.mocked(updateRunRowCondition).mockClear()
  vi.mocked(updateRunRowCondition).mockResolvedValue(undefined)
})

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

  it('renders the cross-collection ownership badge on a matched row (#576)', async () => {
    vi.mocked(fetchCardOwnership).mockResolvedValue({
      'base1::4': {
        collections: [{ id: 1, name: 'Show Binder', quantity: 2, purpose: 'personal' }],
        wishlists: [],
      },
    })
    useAppStore.setState({
      rows: [
        makeRow({
          card: {
            id: 'base1-4',
            name: 'Charizard',
            number: '4',
            rarity: 'Rare Holo',
            set: { id: 'base1', name: 'Base Set' },
          },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    // The lookup is keyed on (set_id, number); the badge appears once it resolves.
    expect(await screen.findByText('owned ×2')).toBeInTheDocument()
    expect(vi.mocked(fetchCardOwnership)).toHaveBeenCalledWith([
      { set_id: 'base1', number: '4' },
    ])
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

  it('renders eBay + TCGPlayer affiliate Buy links on a matched row (#657)', () => {
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
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    const ebay = screen.getByTitle('Find on eBay')
    const tcg = screen.getByTitle('Find on TCGPlayer')
    expect(ebay).toHaveAttribute('href', expect.stringContaining('ebay.com/sch'))
    expect(ebay).toHaveAttribute('rel', 'sponsored noopener')
    expect(within(ebay).getByAltText('eBay')).toHaveAttribute('src', expect.stringContaining('svg'))
    // Routed through the TCGPlayer Impact tracking redirect (#696).
    expect(tcg).toHaveAttribute('href', expect.stringContaining('partner.tcgplayer.com/c/'))
    expect(tcg).toHaveAttribute('rel', 'sponsored noopener')
    expect(within(tcg).getByAltText('TCGplayer')).toHaveAttribute('src', expect.stringContaining('svg'))
    useAppStore.setState({ rows: [] })
  })

  it('omits affiliate Buy links on an unmatched row with no card', () => {
    useAppStore.setState({
      rows: [makeRow({ matched: false, card: null, query: { raw: 'whatever', name: 'whatever' } as Row['query'] })],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    expect(screen.queryByTitle('Find on eBay')).toBeNull()
    expect(screen.queryByTitle('Find on TCGPlayer')).toBeNull()
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

  it('renders the row-level quick-action buttons in a cell to the left of the Name column (#540, #761)', async () => {
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
    const { container } = render(<ResultsTable />)
    // useAuth resolves async — wait for the row-level quick actions to mount.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^want$/i })).toBeInTheDocument()
    })
    const bodyRow = container.querySelector('tbody tr')!
    const cells = bodyRow.querySelectorAll(':scope > td')
    // The selection checkbox (#268) is pinned leftmost, so the quick-actions
    // cell is the one holding the buttons — find it rather than assume index.
    const actionsCell = Array.from(cells).find((td) =>
      td.querySelector('button[title="Want"]'),
    )!
    expect(actionsCell).toBeTruthy()
    expect(actionsCell.querySelector('button[title="Own"]')).not.toBeNull()
    const nameCell = Array.from(cells).find((td) =>
      td.textContent?.includes('Charizard'),
    )
    expect(nameCell).toBeTruthy()
    expect(
      actionsCell.compareDocumentPosition(nameCell!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    useAppStore.setState({ rows: [] })
  })

  it('hides the row-level save buttons for an anonymous (auth-on) user', async () => {
    // Anonymous on a hosted deploy → the collections / wishlists chips
    // can't fire without a user, so the row buttons hide.
    fetchMeMock.mockReset()
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
    _resetAuthStoreForTests()
    useAppStore.setState({
      rows: [
        makeRow({
          card: {
            id: 'base1-4',
            name: 'Charizard',
            number: '4',
            rarity: 'Holo Rare',
            set: { name: 'Base Set' },
          },
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    // Row renders right away (synchronous), the save buttons appear only
    // after /me resolves — but they never should here. Wait one tick to
    // let the hook settle so a stray render of the buttons would fail.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /save to collection/i })).toBeNull()
    })
    expect(screen.queryByRole('button', { name: /save to wishlist/i })).toBeNull()
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

  it('Clear sort & filters resets both sort and active filters', () => {
    useAppStore.setState({
      rows: [
        makeRow({ card: { name: 'Charizard' } }),
        makeRow({ card: { name: 'Pikachu' } }),
        makeRow({ card: { name: 'Squirtle' } }),
      ],
      isRunning: false,
      progress: null,
    })

    render(<ResultsTable />)

    // Activate sort + a filter so the Clear control appears.
    fireEvent.click(screen.getByRole('button', { name: /sort by name/i }))
    fireEvent.click(screen.getByRole('button', { name: /^filter$/i }))
    fireEvent.change(screen.getByLabelText(/filter by name/i), {
      target: { value: 'char' },
    })
    expect(screen.getByText(/1 matched · 0 unmatched · 1 shown/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear sort & filters/i }))

    // All rows back, counts reflect the full set, qualifier gone.
    expect(screen.getByText(/3 matched · 0 unmatched · 3 shown/)).toBeInTheDocument()
    expect(screen.queryByText(/\(of 3\)/)).toBeNull()
    expect(screen.queryByRole('button', { name: /clear sort & filters/i })).toBeNull()
    // Sort is also off — first body row is back to the original order.
    const bodyRows = screen.getAllByRole('row').filter((tr) => tr.querySelector('td'))
    expect(bodyRows[0].textContent).toContain('Charizard')

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

  it('filter panel lives in its own region, not the table header, with chips and an empty state', () => {
    useAppStore.setState({
      rows: [
        makeRow({ card: { name: 'Charizard' } }),
        makeRow({ card: { name: 'Pikachu' } }),
      ],
      isRunning: false,
      progress: null,
    })

    render(<ResultsTable />)
    fireEvent.click(screen.getByRole('button', { name: /^filter$/i }))

    const panel = screen.getByRole('region', { name: /result filters/i })
    // The panel sits outside the table entirely (#541) — not a header row.
    expect(panel.closest('table')).toBeNull()
    expect(within(panel).getByText(/no filters applied/i)).toBeInTheDocument()

    fireEvent.change(within(panel).getByLabelText(/filter by name/i), {
      target: { value: 'char' },
    })

    const chip = within(panel).getByRole('button', { name: /name: char/i })
    expect(chip).toBeInTheDocument()
    expect(within(panel).queryByText(/no filters applied/i)).toBeNull()

    fireEvent.click(chip)
    expect(within(panel).queryByRole('button', { name: /name: char/i })).toBeNull()
    expect(within(panel).getByText(/no filters applied/i)).toBeInTheDocument()

    useAppStore.setState({ rows: [] })
  })

  it('a market filter set before hiding pricing stops narrowing rows and never leaks its numbers', () => {
    useAppStore.getState().updateSettings({ hidePricing: true })
    useAppStore.setState({
      rows: [
        makeRow({ card: { name: 'Charizard' }, pricing: { market: 250, currency: 'USD', variant: null, source: null, url: null } }),
        makeRow({ card: { name: 'Pikachu' }, pricing: { market: 5, currency: 'USD', variant: null, source: null, url: null } }),
      ],
      isRunning: false,
      progress: null,
      viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters, marketMin: '100' } },
    })

    render(<ResultsTable />)

    // Both rows still show — the pre-existing market filter isn't silently
    // applied once its column (and chip) are hidden by "hide pricing".
    const bodyRows = screen.getAllByRole('row').filter((tr) => tr.querySelector('td'))
    expect(bodyRows).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /^filter$/i }))
    const panel = screen.getByRole('region', { name: /result filters/i })
    expect(within(panel).getByText(/market filter \(hidden while pricing is off\)/i)).toBeInTheDocument()
    expect(within(panel).queryByText(/\$100/)).toBeNull()

    useAppStore.setState({ rows: [] })
    useAppStore.getState().updateSettings({ hidePricing: false })
  })

  it('shows the eBay column with median + sparkline when the setting is on', () => {
    useAppStore.getState().updateSettings({ showEbay: true })
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'x', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: {
            market: 250,
            currency: 'USD',
            variant: null,
            source: 'TCGPlayer',
            url: null,
            ebay_sold_median: 230,
            ebay_active_floor: 199.99,
            ebay_sold_comps: [
              { price: 220, date: '2026-01-01', condition: 'Used', url: null },
              { price: 240, date: '2026-02-01', condition: 'Used', url: null },
            ],
          },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    expect(screen.getByText('eBay sold')).toBeInTheDocument()
    expect(screen.getByText('$230.00')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /recent ebay sold prices/i }),
    ).toBeInTheDocument()
    useAppStore.getState().updateSettings({ showEbay: false })
    useAppStore.setState({ rows: [] })
  })

  it('hides the eBay column when the setting is off', () => {
    useAppStore.getState().updateSettings({ showEbay: false })
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'x', name: 'Charizard', set: { name: 'Base Set' } },
          pricing: {
            market: 250,
            currency: 'USD',
            variant: null,
            source: 'TCGPlayer',
            url: null,
            ebay_sold_median: 230,
          },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    expect(screen.queryByText('eBay sold')).toBeNull()
    useAppStore.setState({ rows: [] })
  })
})

describe('ResultsTable: hide pricing (#764)', () => {
  function pricedRow(): Row {
    return makeRow({
      card: { id: 'x', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
      pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
    })
  }

  it('shows the Market column and comp tiers by default', () => {
    useAppStore.setState({ rows: [pricedRow()], isRunning: false, progress: null })
    render(<ResultsTable />)
    expect(screen.getByText('Adj. market')).toBeInTheDocument()
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    useAppStore.setState({ rows: [] })
  })

  it('recalculates adjusted pricing and comps from a per-row condition override', () => {
    useAppStore.getState().updateSettings({ condition: 'LP' })
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: { market: 100, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
      currentRunId: 77,
    })
    render(<ResultsTable />)

    expect(screen.getByText('$85.00')).toBeInTheDocument()
    expect(screen.getAllByText('NM $100.00')).toHaveLength(1)
    expect(screen.getByText('$68.00')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/condition for charizard/i), {
      target: { value: 'HP' },
    })

    expect(screen.getByText('$45.00')).toBeInTheDocument()
    expect(useAppStore.getState().rowConditionOverrides).toEqual({ 'card:base1-4': 'HP' })
    expect(updateRunRowCondition).toHaveBeenCalledWith(77, 0, {
      condition: 'HP',
      condition_multiplier: 0.45,
    })
    useAppStore.getState().resetSettings()
    useAppStore.getState().clearRowConditionOverrides()
    useAppStore.setState({ rows: [], currentRunId: null })
  })

  it('clears a per-row condition override back to the default', () => {
    useAppStore.getState().updateSettings({ condition: 'LP' })
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: { market: 100, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
      currentRunId: 77,
      rowConditionOverrides: { 'card:base1-4': 'HP' },
    })
    render(<ResultsTable />)

    expect(screen.getByText('$45.00')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/condition for charizard/i), {
      target: { value: '' },
    })

    expect(screen.getByText('$85.00')).toBeInTheDocument()
    expect(useAppStore.getState().rowConditionOverrides).toEqual({})
    expect(updateRunRowCondition).toHaveBeenCalledWith(77, 0, {
      condition: null,
      condition_multiplier: null,
    })
    useAppStore.getState().resetSettings()
    useAppStore.getState().clearRowConditionOverrides()
    useAppStore.setState({ rows: [], currentRunId: null })
  })

  it('tells a signed-out visitor to sign in when the condition save 401s', async () => {
    vi.mocked(updateRunRowCondition).mockRejectedValueOnce(new Error('sign-in required'))
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: { market: 100, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
      currentRunId: 77,
    })
    render(<ResultsTable />)

    fireEvent.change(screen.getByLabelText(/condition for charizard/i), {
      target: { value: 'HP' },
    })

    expect(
      await screen.findByText('Sign in to keep condition overrides across visits.'),
    ).toBeInTheDocument()
    useAppStore.getState().clearRowConditionOverrides()
    useAppStore.setState({ rows: [], currentRunId: null })
  })

  it('shows a generic message when the condition save fails for a non-auth reason', async () => {
    vi.mocked(updateRunRowCondition).mockRejectedValueOnce(new Error('condition update failed: 500'))
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: { market: 100, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
      currentRunId: 77,
    })
    render(<ResultsTable />)

    fireEvent.change(screen.getByLabelText(/condition for charizard/i), {
      target: { value: 'HP' },
    })

    expect(await screen.findByText('Condition override was not saved.')).toBeInTheDocument()
    useAppStore.getState().clearRowConditionOverrides()
    useAppStore.setState({ rows: [], currentRunId: null })
  })

  it('hides the Market column, comp tiers, and price values when the setting is on', () => {
    useAppStore.getState().updateSettings({ hidePricing: true })
    useAppStore.setState({ rows: [pricedRow()], isRunning: false, progress: null })
    render(<ResultsTable />)
    expect(screen.queryByText('Adj. market')).toBeNull()
    expect(screen.queryByText('$250.00')).toBeNull()
    expect(screen.queryByText('80%')).toBeNull()
    expect(screen.getByText('Charizard')).toBeInTheDocument()
    useAppStore.getState().updateSettings({ hidePricing: false })
    useAppStore.setState({ rows: [] })
  })

  // Review feedback on #878: the eBay column has its own `showEbay` opt-in,
  // but it renders a sold price + sparkline — leaving it up with pricing
  // hidden defeats the point of a clean, price-free view.
  it('hides the eBay column when both showEbay and hidePricing are on', () => {
    useAppStore.getState().updateSettings({ showEbay: true, hidePricing: true })
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'x', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: {
            market: 250,
            currency: 'USD',
            variant: null,
            source: 'TCGPlayer',
            url: null,
            ebay_sold_median: 230,
          },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    expect(screen.queryByText('eBay sold')).toBeNull()
    expect(screen.queryByText('$230.00')).toBeNull()
    useAppStore.getState().updateSettings({ showEbay: false, hidePricing: false })
    useAppStore.setState({ rows: [] })
  })
})

describe('ResultsTable: configurable comp tiers (#542)', () => {
  function pricedRow(): Row {
    return makeRow({
      card: { id: 'x', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
      pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
    })
  }

  // Radix DropdownMenu opens on `pointerdown`, not `click` — jsdom doesn't
  // fire it via the plain `fireEvent.click` shorthand (see ExportBar.test.tsx).
  // Focus + Enter is the keyboard-user path and works in jsdom.
  function openColumnsMenu() {
    const trigger = screen.getByRole('button', { name: /configure comp tier columns/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
  }

  afterEach(() => {
    useAppStore.setState({ rows: [] })
  })

  it('hiding a tier from the Columns menu removes its column but keeps its configured percentage', () => {
    useAppStore.setState({ rows: [pricedRow()], isRunning: false, progress: null })
    render(<ResultsTable />)
    expect(screen.getByText('80%')).toBeInTheDocument()

    openColumnsMenu()
    fireEvent.click(screen.getByLabelText('Show 80% column'))

    expect(screen.queryByText('80%')).toBeNull()
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(useAppStore.getState().viewState.compTiers[0]).toEqual({ percent: 80, visible: false })
  })

  it('editing a tier percentage re-renders the column header and cell values', () => {
    useAppStore.setState({ rows: [pricedRow()], isRunning: false, progress: null })
    render(<ResultsTable />)

    openColumnsMenu()
    fireEvent.change(screen.getByLabelText('Percentage for comp tier 1'), {
      target: { value: '70' },
    })

    expect(screen.queryByText('80%')).toBeNull()
    expect(screen.getByText('70%')).toBeInTheDocument()
    expect(screen.getByText('$175.00')).toBeInTheDocument() // 70% of $250
  })

  it('adds a new tier at 100% and can remove it again', () => {
    useAppStore.setState({ rows: [pricedRow()], isRunning: false, progress: null })
    render(<ResultsTable />)

    openColumnsMenu()
    fireEvent.click(screen.getByRole('button', { name: /add tier/i }))

    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(useAppStore.getState().viewState.compTiers).toHaveLength(5)

    fireEvent.click(screen.getByLabelText('Remove 100% column'))
    expect(screen.queryByText('100%')).toBeNull()
    expect(useAppStore.getState().viewState.compTiers).toHaveLength(4)
  })

  it('resets a customized ladder back to 80/85/90/95', () => {
    useAppStore.setState({ rows: [pricedRow()], isRunning: false, progress: null })
    render(<ResultsTable />)

    openColumnsMenu()
    fireEvent.click(screen.getByLabelText('Show 80% column'))
    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }))

    expect(useAppStore.getState().viewState.compTiers).toEqual([
      { percent: 80, visible: true },
      { percent: 85, visible: true },
      { percent: 90, visible: true },
      { percent: 95, visible: true },
    ])
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('hides the Columns button when pricing is hidden', () => {
    useAppStore.getState().updateSettings({ hidePricing: true })
    useAppStore.setState({ rows: [pricedRow()], isRunning: false, progress: null })
    render(<ResultsTable />)
    expect(screen.queryByRole('button', { name: /configure comp tier columns/i })).toBeNull()
    useAppStore.getState().updateSettings({ hidePricing: false })
  })
})

describe('ResultsTable: hide owned (#339)', () => {
  function ownedRow(name: string, number: string): Row {
    return makeRow({
      card: { id: `base1-${number}`, name, number, set: { id: 'base1', name: 'Base Set' } },
      pricing: { market: 100, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
    })
  }

  it('drops owned rows and surfaces an "owned hidden" count when the setting is on', async () => {
    vi.mocked(fetchCardOwnership).mockResolvedValue({
      'base1::4': { collections: [{ id: 1, name: 'Show Binder', quantity: 2, purpose: 'personal' }], wishlists: [] },
    })
    useAppStore.getState().updateSettings({ hideOwned: true })
    useAppStore.setState({
      rows: [ownedRow('Charizard', '4'), ownedRow('Pikachu', '58')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    // Pikachu (unowned) stays; Charizard drops once its occupancy resolves.
    expect(await screen.findByText('Pikachu')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Charizard')).toBeNull())
    expect(screen.getByText(/1 owned hidden/)).toBeInTheDocument()
    expect(screen.getByText(/1 matched · 0 unmatched · 1 shown/)).toBeInTheDocument()

    useAppStore.getState().updateSettings({ hideOwned: false })
    useAppStore.setState({ rows: [] })
  })

  it('keeps wishlist-only ("chasing") rows — those are what you still want', async () => {
    vi.mocked(fetchCardOwnership).mockResolvedValue({
      'base1::4': { collections: [], wishlists: [{ id: 9, name: 'Grails' }] },
    })
    useAppStore.getState().updateSettings({ hideOwned: true })
    useAppStore.setState({
      rows: [ownedRow('Charizard', '4')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    expect(await screen.findByText('chasing')).toBeInTheDocument()
    expect(screen.getByText('Charizard')).toBeInTheDocument()
    expect(screen.queryByText(/owned hidden/)).toBeNull()

    useAppStore.getState().updateSettings({ hideOwned: false })
    useAppStore.setState({ rows: [] })
  })

  it('keeps owned rows when the setting is off', async () => {
    vi.mocked(fetchCardOwnership).mockResolvedValue({
      'base1::4': { collections: [{ id: 1, name: 'Show Binder', quantity: 2, purpose: 'personal' }], wishlists: [] },
    })
    useAppStore.getState().updateSettings({ hideOwned: false })
    useAppStore.setState({
      rows: [ownedRow('Charizard', '4')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    // The owned badge still resolves, but the row stays put.
    expect(await screen.findByText('owned ×2')).toBeInTheDocument()
    expect(screen.getByText('Charizard')).toBeInTheDocument()
    expect(screen.queryByText(/owned hidden/)).toBeNull()

    useAppStore.setState({ rows: [] })
  })
})

describe('ResultsTable: bulk row actions (#268)', () => {
  function matched(name: string, number: string, market = 100): Row {
    return makeRow({
      card: { id: `base1-${number}`, name, number, set: { id: 'base1', name: 'Base Set' } },
      pricing: { market, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
    })
  }

  // Sign out so the binder pickers (which need a library) stay hidden — the
  // view actions under test (select / delete / retag / export) don't need a
  // user, and this keeps the bar free of async collection fetches.
  function signOut() {
    fetchMeMock.mockReset()
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
    _resetAuthStoreForTests()
  }

  function bar() {
    return screen.getByRole('region', { name: /bulk actions/i })
  }

  it('shows the action bar with a count once a row is selected', () => {
    signOut()
    useAppStore.setState({
      rows: [matched('Charizard', '4'), matched('Pikachu', '58')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    expect(screen.queryByRole('region', { name: /bulk actions/i })).toBeNull()
    fireEvent.click(screen.getByLabelText('Select Charizard'))
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument()

    useAppStore.setState({ rows: [] })
  })

  it('select-all selects every visible row, then clears them', () => {
    signOut()
    useAppStore.setState({
      rows: [matched('Charizard', '4'), matched('Pikachu', '58'), matched('Squirtle', '63')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    fireEvent.click(screen.getByLabelText('Select all rows'))
    expect(within(bar()).getByText('3 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select all rows'))
    expect(screen.queryByRole('region', { name: /bulk actions/i })).toBeNull()

    useAppStore.setState({ rows: [] })
  })

  it('shift-click selects the contiguous range from the anchor', () => {
    signOut()
    useAppStore.setState({
      rows: [matched('A', '1'), matched('B', '2'), matched('C', '3'), matched('D', '4')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    fireEvent.click(screen.getByLabelText('Select A')) // anchor
    fireEvent.click(screen.getByLabelText('Select C'), { shiftKey: true })
    // A, B, C are now selected; D is not.
    expect(within(bar()).getByText('3 selected')).toBeInTheDocument()

    useAppStore.setState({ rows: [] })
  })

  it('Delete drops the selected rows and Undo restores them', () => {
    signOut()
    useAppStore.setState({
      rows: [matched('Charizard', '4'), matched('Pikachu', '58')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    fireEvent.click(screen.getByLabelText('Select Charizard'))
    fireEvent.click(within(bar()).getByRole('button', { name: /delete/i }))

    expect(useAppStore.getState().rows.map((r) => r.card?.name)).toEqual(['Pikachu'])
    // The bar stays up in its "Rows removed" state so Undo is reachable.
    expect(within(bar()).getByText(/rows removed/i)).toBeInTheDocument()

    fireEvent.click(within(bar()).getByRole('button', { name: /undo/i }))
    expect(useAppStore.getState().rows.map((r) => r.card?.name)).toEqual([
      'Charizard',
      'Pikachu',
    ])

    useAppStore.setState({ rows: [] })
  })

  it('Retag applies the tag to only the selected rows', () => {
    signOut()
    useAppStore.setState({
      rows: [matched('Charizard', '4'), matched('Pikachu', '58')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    fireEvent.click(screen.getByLabelText('Select Charizard'))
    fireEvent.click(within(bar()).getByRole('button', { name: /retag/i }))
    fireEvent.change(screen.getByLabelText(/new tag for selected rows/i), {
      target: { value: 'show-a' },
    })
    fireEvent.click(within(bar()).getByRole('button', { name: /^set$/i }))

    const rows = useAppStore.getState().rows
    expect(rows.find((r) => r.card?.name === 'Charizard')?.tag).toBe('show-a')
    expect(rows.find((r) => r.card?.name === 'Pikachu')?.tag).toBe('')

    useAppStore.setState({ rows: [] })
  })

  it('Export selected sends only the selected rows to exportFile', async () => {
    signOut()
    useAppStore.setState({
      rows: [matched('Charizard', '4'), matched('Pikachu', '58')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    fireEvent.click(screen.getByLabelText('Select Pikachu'))
    // Radix DropdownMenu opens on the keyboard activation path under jsdom.
    const trigger = within(bar()).getByRole('button', { name: /export/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
    fireEvent.click(await screen.findByText('Download .xlsx'))

    await waitFor(() => expect(vi.mocked(exportFile)).toHaveBeenCalled())
    const [rowsArg, format] = vi.mocked(exportFile).mock.calls[0]
    expect(format).toBe('xlsx')
    expect(rowsArg.map((r) => r.card?.name)).toEqual(['Pikachu'])

    useAppStore.setState({ rows: [] })
  })

  it('clears the selection on sort by default, keeps it when "preserve" is on', () => {
    signOut()
    useAppStore.setState({
      rows: [matched('Charizard', '4'), matched('Abra', '1')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    // Select, then sort — selection clears because preserve is off.
    fireEvent.click(screen.getByLabelText('Select Charizard'))
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /sort by name/i }))
    expect(screen.queryByRole('region', { name: /bulk actions/i })).toBeNull()

    // Re-select, flip preserve on, then sort again — selection survives.
    fireEvent.click(screen.getByLabelText('Select Charizard'))
    fireEvent.click(screen.getByLabelText(/keep selection across sort/i))
    fireEvent.click(screen.getByRole('button', { name: /sort by name/i }))
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument()

    useAppStore.setState({ rows: [] })
  })

  it('hides the want / own save toggles for a signed-out user', () => {
    signOut()
    useAppStore.setState({
      rows: [matched('Charizard', '4')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    fireEvent.click(screen.getByLabelText('Select Charizard'))
    // View actions are present; the save toggles are not.
    expect(within(bar()).getByRole('button', { name: /retag/i })).toBeInTheDocument()
    expect(within(bar()).queryByRole('button', { name: /own selected cards/i })).toBeNull()
    expect(within(bar()).queryByRole('button', { name: /want selected cards/i })).toBeNull()

    useAppStore.setState({ rows: [] })
  })

  it('owns the selected matched cards via the bulk quick action (#781)', async () => {
    // Signed-in default mock → the want / own save toggles render.
    vi.mocked(ownCard).mockResolvedValue({} as never)
    useAppStore.setState({
      rows: [matched('Charizard', '4'), matched('Pikachu', '58')],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    fireEvent.click(screen.getByLabelText('Select all rows'))
    fireEvent.click(await within(bar()).findByRole('button', { name: /own selected cards/i }))

    // One default-targeting write per selected matched card, no picker.
    await waitFor(() => expect(vi.mocked(ownCard)).toHaveBeenCalledTimes(2))

    useAppStore.setState({ rows: [] })
  })
})
