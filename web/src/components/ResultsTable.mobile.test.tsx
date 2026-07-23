/**
 * ResultsTable's mobile card-list view (#521) — a separate file so the
 * `matchMedia` stub can report a mobile viewport for every test here without
 * disturbing the desktop-default assumptions the rest of ResultsTable.test.tsx
 * relies on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  hasPersonalOwnership: (
    ownership: { collections: { purpose: string }[] } | null | undefined,
  ): boolean => !!ownership && ownership.collections.some((c) => c.purpose === 'personal'),
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
// back true and ResultsTable takes the card-list branch. `simulateResize`
// lets a test flip `matches` mid-render and fire the 'change' listener
// useIsMobileViewport subscribes to, so tests can exercise an actual resize
// rather than just the two static states.
let mockMatches = true
const changeListeners = new Set<(e: MediaQueryListEvent) => void>()
function simulateResize(matches: boolean) {
  mockMatches = matches
  changeListeners.forEach((fn) => fn({ matches } as MediaQueryListEvent))
}

const realMatchMedia = window.matchMedia
beforeEach(() => {
  mockMatches = true
  changeListeners.clear()
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return mockMatches
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
        changeListeners.add(fn)
      },
      removeEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
        changeListeners.delete(fn)
      },
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

  it('an ambiguous match shows a candidate picklist that reruns the line pinned to the chosen printing, with the variant hint carried over (#948)', () => {
    const onRerunLine = vi.fn()
    useAppStore.setState({
      rows: [
        makeRow({
          query: {
            raw: 'Charizard [reverseHolofoil]',
            name: 'Charizard',
            variant_hint: 'reverseHolofoil',
          } as Row['query'],
          card: { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          candidates: [
            { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
            {
              id: 'swsh3-25',
              name: 'Charizard',
              number: '25',
              set: { name: 'Darkness Ablaze' },
            },
          ],
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable onRerunLine={onRerunLine} />)

    const trigger = screen.getByRole('button', { name: /2 matches/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: /Darkness Ablaze/i }))

    expect(onRerunLine).toHaveBeenCalledWith(
      'Charizard | Darkness Ablaze | 25 [reverseHolofoil]',
    )
  })

  it('an unambiguous match does not show a candidate picklist', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'base1-58', name: 'Pikachu', number: '58', set: { name: 'Base Set' } },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable onRerunLine={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /matches/i })).toBeNull()
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

  it('closes the mobile filters sheet if the viewport resizes to desktop while it is open', async () => {
    useAppStore.setState({
      rows: [makeRow({ card: { id: 'a', name: 'Charizard', set: { name: 'Base Set' } } })],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    expect(screen.getByRole('dialog', { name: /filters & sort/i })).toBeInTheDocument()

    act(() => simulateResize(false))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /filters & sort/i })).not.toBeInTheDocument(),
    )
  })

  it('does not reopen the filters sheet immediately after resizing back into mobile', async () => {
    useAppStore.setState({
      rows: [makeRow({ card: { id: 'a', name: 'Charizard', set: { name: 'Base Set' } } })],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    expect(screen.getByRole('dialog', { name: /filters & sort/i })).toBeInTheDocument()

    act(() => simulateResize(false))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /filters & sort/i })).not.toBeInTheDocument(),
    )

    act(() => simulateResize(true))
    expect(screen.queryByRole('dialog', { name: /filters & sort/i })).not.toBeInTheDocument()
  })

  it('clears a desktop selection when resizing into the mobile card list, so BulkActionBar cannot act on a hidden selection', async () => {
    mockMatches = false
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'a', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    fireEvent.click(screen.getByLabelText('Select Charizard'))
    expect(screen.getByRole('region', { name: /bulk actions/i })).toBeInTheDocument()

    act(() => simulateResize(true))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /bulk actions/i })).not.toBeInTheDocument(),
    )
  })

  it('flags a card over the price cap the same way the desktop row does', () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, maxPrice: 100 },
      rows: [
        makeRow({
          card: { id: 'a', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: { market: 250, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)
    const price = screen.getByText('$250.00')
    expect(price).toHaveClass('text-sun-600', 'dark:text-sun-300', 'font-bold')
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

  it('sets a manual price override from the card, same as the desktop row (#266)', () => {
    useAppStore.setState({
      rows: [
        makeRow({
          card: { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base Set' } },
          pricing: { market: 100, currency: 'USD', variant: null, source: 'TCGPlayer', url: null },
        }),
      ],
      isRunning: false,
      progress: null,
    })
    render(<ResultsTable />)

    fireEvent.click(screen.getByLabelText(/price override for charizard/i))
    fireEvent.change(screen.getByLabelText(/price override for charizard/i), {
      target: { value: '12' },
    })
    fireEvent.blur(screen.getByLabelText(/price override for charizard/i))

    expect(screen.getAllByText('$12.00')).toHaveLength(2)
    expect(useAppStore.getState().rows[0].pricing.pricing_override).toBe(12)
  })
})
