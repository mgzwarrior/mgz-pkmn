import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SwipePanel } from './SwipePanel'
import {
  fetchSets,
  fetchSetCards,
  createWishlist,
  addCardToWishlist,
  fetchWishlists,
} from '../api/client'
import { _resetSwipeProfileForTests } from './useSwipeProfile'
import { _resetWishlistsCacheForTests } from './useWishlists'
import type { SetCard } from '../types'

vi.mock('../api/client', () => ({
  fetchSets: vi.fn(),
  fetchSetCards: vi.fn(),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
  fetchWishlists: vi.fn(),
}))

const mockFetchSets = vi.mocked(fetchSets)
const mockFetchSetCards = vi.mocked(fetchSetCards)
const mockCreateWishlist = vi.mocked(createWishlist)
const mockAddCardToWishlist = vi.mocked(addCardToWishlist)
const mockFetchWishlists = vi.mocked(fetchWishlists)

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
    ...overrides,
  }
}

describe('SwipePanel', () => {
  beforeEach(() => {
    _resetSwipeProfileForTests()
    _resetWishlistsCacheForTests()
    mockFetchSets.mockReset()
    mockFetchSetCards.mockReset()
    mockCreateWishlist.mockReset()
    mockAddCardToWishlist.mockReset()
    mockFetchWishlists.mockReset()
    mockFetchSets.mockResolvedValue([
      { id: 'sv1', name: 'Scarlet & Violet', series: 'SV', total: 2, releaseDate: '2023/03/31' },
    ])
    mockFetchSetCards.mockResolvedValue([
      card({ id: 'sv1-1', name: 'Pikachu', market: 5 }),
      card({ id: 'sv1-2', name: 'Charizard', market: 50 }),
    ])
    mockFetchWishlists.mockResolvedValue([])
  })

  it('renders the current candidate card', async () => {
    render(<SwipePanel active />)
    await waitFor(() =>
      expect(screen.getByTestId('swipe-card')).toBeInTheDocument(),
    )
    // The higher-priced card wins the cold-start tie-break.
    expect(screen.getByText('Charizard')).toBeInTheDocument()
  })

  it('saves the card and advances when → is pressed', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Charizard')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    // The save count chip in the header should show "1 saved · reset".
    expect(
      screen.getByRole('button', { name: /1 saved · reset/i }),
    ).toBeInTheDocument()
  })

  it('passes (no save) when ← is pressed', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Charizard')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    // No "Build prep list" panel since saved list is empty.
    expect(screen.queryByText(/Build a prep list/i)).not.toBeInTheDocument()
  })

  it('Build prep list creates a wishlist and adds saved cards', async () => {
    mockCreateWishlist.mockResolvedValue({
      id: 42,
      name: 'Custom prep',
      description: null,
      created_at: '2026-06-06T00:00:00',
      items: [],
    })
    mockAddCardToWishlist.mockResolvedValue({
      id: 1,
      card: {},
      notes: null,
      max_price: null,
      added_at: '2026-06-06T00:00:00',
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Charizard')).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /1 saved · reset/i }),
      ).toBeInTheDocument(),
    )

    const input = screen.getByLabelText('Prep list name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Custom prep' } })
    fireEvent.click(screen.getByRole('button', { name: /build prep list/i }))

    await waitFor(() =>
      expect(mockCreateWishlist).toHaveBeenCalledWith('Custom prep', undefined),
    )
    // After success the saved list clears so the CTA disappears.
    await waitFor(() =>
      expect(screen.queryByText(/Build a prep list/i)).not.toBeInTheDocument(),
    )
    expect(mockAddCardToWishlist).toHaveBeenCalledTimes(1)
  })
})
