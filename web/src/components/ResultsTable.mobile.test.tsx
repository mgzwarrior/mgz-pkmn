/**
 * ResultsTable's mobile card-list view (#521) — a separate file so the
 * `matchMedia` stub can report a mobile viewport for every test here without
 * disturbing the desktop-default assumptions the rest of ResultsTable.test.tsx
 * relies on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResultsTable } from './ResultsTable'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { fetchCardOwnership } from '../api/client'
import { _resetCardOwnershipForTests } from './useCardOwnership'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import type { Row } from '../types'

const { fetchMeMock } = vi.hoisted(() => ({ fetchMeMock: vi.fn() }))

vi.mock('../api/client', () => ({
  addOverride: vi.fn(),
  fetchMe: fetchMeMock,
  logout: vi.fn(),
  fetchCardOwnership: vi.fn(async () => ({})),
  fetchCollections: vi.fn(async () => []),
  fetchWishlists: vi.fn(async () => []),
  createCollection: vi.fn(),
  createWishlist: vi.fn(),
  addCardToCollection: vi.fn(),
  addCardToWishlist: vi.fn(),
  bulkAddToCollection: vi.fn(async () => ({ added: 0, items: [] })),
  bulkAddToWishlist: vi.fn(async () => ({ added: 0, items: [] })),
  wantCard: vi.fn(async () => ({})),
  unwantCard: vi.fn(async () => ({})),
  ownCard: vi.fn(async () => ({})),
  unownCard: vi.fn(async () => ({})),
  exportFile: vi.fn(async () => undefined),
}))

// Report every media query as matching, so `(max-width: 1023px)` — the same
// breakpoint the mobile app shell (bottom tab bar, sidebar) gates on — comes
// back true and ResultsTable takes the card-list branch.
const realMatchMedia = window.matchMedia
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
  fetchMeMock.mockReset()
  fetchMeMock.mockResolvedValue({
    user: { id: 1, email: 'u@e.com', display_name: 'U' },
    authEnabled: true,
  })
  _resetAuthStoreForTests()
  useAppStore.setState({
    viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
    currentRunId: null,
  })
  _resetCardOwnershipForTests()
  _resetCollectionsCacheForTests()
  _resetWishlistsCacheForTests()
  vi.mocked(fetchCardOwnership).mockReset()
  vi.mocked(fetchCardOwnership).mockResolvedValue({})
})

afterEach(() => {
  vi.stubGlobal('matchMedia', realMatchMedia)
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

describe('ResultsTable — mobile card list (#521)', () => {
  it('renders matched rows as cards instead of a table', () => {
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
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Charizard')).toBeInTheDocument()
    expect(screen.getByText('$250.00')).toBeInTheDocument()
  })

  it('tapping a matched card opens the detail modal, same as the desktop row', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    fireEvent.click(screen.getByLabelText(/View details for Charizard/))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('opens a Filters + Sort sheet instead of an inline filter row', () => {
    useAppStore.setState({
      rows: [makeRow({ card: { id: 'a', name: 'Charizard', set: { name: 'Base Set' } } })],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    expect(screen.getByRole('dialog', { name: /filters & sort/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Sort column')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by name')).toBeInTheDocument()
  })

  it('filtering from the sheet narrows the card list', () => {
    useAppStore.setState({
      rows: [
        makeRow({ card: { id: 'a', name: 'Charizard', set: { name: 'Base Set' } } }),
        makeRow({ card: { id: 'b', name: 'Squirtle', set: { name: 'Base Set' } } }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    fireEvent.change(screen.getByLabelText('Filter by name'), { target: { value: 'char' } })
    expect(screen.getByText('Charizard')).toBeInTheDocument()
    expect(screen.queryByText('Squirtle')).not.toBeInTheDocument()
  })
})
