/**
 * SwipePanel's mobile personalization-panel reorder (#845 review) — a
 * separate file so the `matchMedia` stub can report a mobile viewport for
 * every test here without disturbing the desktop-default assumptions the
 * rest of SwipePanel.test.tsx relies on. Mirrors ResultsTable.mobile.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SwipePanel } from './SwipePanel'
import {
  fetchSets,
  fetchSetCards,
  fetchWishlists,
  fetchMe,
  fetchCollections,
  fetchSwipeExcluded,
} from '../api/client'
import { _resetSwipeProfileForTests } from './useSwipeProfile'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import type { SetCard } from '../types'

vi.mock('../api/client', () => ({
  fetchSets: vi.fn(),
  fetchSetCards: vi.fn(),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
  fetchWishlists: vi.fn(),
  fetchMe: vi.fn(),
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
  fetchSwipeExcluded: vi.fn(),
  recordSwipeSeen: vi.fn(),
  resetSwipeSeen: vi.fn(),
  fetchCardOwnership: vi.fn(async () => ({})),
  hasPersonalOwnership: (
    ownership: { collections: { purpose: string }[] } | null | undefined,
  ): boolean => !!ownership && ownership.collections.some((c) => c.purpose === 'personal'),
  fetchFavoritePokemon: vi.fn(async () => []),
  pinFavoritePokemon: vi.fn(),
  unpinFavoritePokemon: vi.fn(),
}))

const mockFetchSets = vi.mocked(fetchSets)
const mockFetchSetCards = vi.mocked(fetchSetCards)
const mockFetchWishlists = vi.mocked(fetchWishlists)
const mockFetchMe = vi.mocked(fetchMe)
const mockFetchCollections = vi.mocked(fetchCollections)
const mockFetchSwipeExcluded = vi.mocked(fetchSwipeExcluded)

function card(overrides: Partial<SetCard> = {}): SetCard {
  return {
    id: 'sv1-1',
    name: 'Pikachu',
    number: '1',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    thumb: null,
    market: 5,
    dexNumbers: [],
    ...overrides,
  }
}

// Report every media query as matching, so `(max-width: 639px)` — the sm
// breakpoint SwipePanel gates the personalization panels' DOM position on —
// comes back true and the panels render after the card instead of before it.
let mockMatches = true
const realMatchMedia = window.matchMedia

beforeEach(() => {
  mockMatches = true
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return mockMatches
      },
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )

  _resetSwipeProfileForTests()
  _resetWishlistsCacheForTests()
  _resetCollectionsCacheForTests()
  _resetAuthStoreForTests()
  mockFetchSets.mockReset()
  mockFetchSetCards.mockReset()
  mockFetchWishlists.mockReset()
  mockFetchMe.mockReset()
  mockFetchMe.mockResolvedValue({ user: null, authEnabled: true })
  mockFetchCollections.mockReset()
  mockFetchCollections.mockResolvedValue([])
  mockFetchSets.mockResolvedValue([
    { id: 'sv1', name: 'Scarlet & Violet', series: 'SV', total: 2, releaseDate: '2023/03/31' },
  ])
  mockFetchSetCards.mockResolvedValue([
    card({ id: 'sv1-1', name: 'Pikachu', number: '1', market: 5 }),
    card({ id: 'sv1-2', name: 'Charizard', number: '2', market: 50 }),
  ])
  mockFetchWishlists.mockResolvedValue([])
  mockFetchSwipeExcluded.mockReset()
  mockFetchSwipeExcluded.mockResolvedValue([])
  // Pin the rarity-weighted sampler so candidate order is deterministic —
  // `Math.random() === 0` picks the first available set and unseen card.
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.stubGlobal('matchMedia', realMatchMedia)
  vi.restoreAllMocks()
})

describe('SwipePanel — mobile personalization panel order (#845)', () => {
  it('places Your taste after the card in the DOM on mobile, not before it', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByTestId('swipe-card')).toBeInTheDocument())

    const swipeCard = screen.getByTestId('swipe-card')
    const taste = screen.getByRole('button', { name: /your taste/i })

    // This has to be an actual DOM position, not just a visual one — CSS
    // `order` would repaint the panel below the card while leaving tab and
    // screen-reader reading order landing on it first (review feedback on
    // the first pass at this fix).
    expect(
      swipeCard.compareDocumentPosition(taste) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps Your taste before the card in the DOM at the sm breakpoint and up', async () => {
    mockMatches = false
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByTestId('swipe-card')).toBeInTheDocument())

    const swipeCard = screen.getByTestId('swipe-card')
    const taste = screen.getByRole('button', { name: /your taste/i })

    expect(
      swipeCard.compareDocumentPosition(taste) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
  })
})
