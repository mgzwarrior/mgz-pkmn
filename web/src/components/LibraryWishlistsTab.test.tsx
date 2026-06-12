import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryWishlistsTab } from './LibraryWishlistsTab'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { _resetCollectionsCacheForTests } from './useCollections'
import { fetchWishlists, fetchWishlist, fetchCollections } from '../api/client'

vi.mock('../api/client', () => ({
  fetchWishlists: vi.fn(),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
  fetchWishlist: vi.fn(),
  promoteWishlistItem: vi.fn(),
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
}))

const mockFetch = vi.mocked(fetchWishlists)
const mockFetchWishlist = vi.mocked(fetchWishlist)
const mockFetchCollections = vi.mocked(fetchCollections)

describe('LibraryWishlistsTab', () => {
  beforeEach(() => {
    _resetWishlistsCacheForTests()
    _resetCollectionsCacheForTests()
    mockFetch.mockReset()
    mockFetchWishlist.mockReset()
    mockFetchCollections.mockReset()
    mockFetchCollections.mockResolvedValue([])
  })

  it('shows the empty state when the user has no wishlists', async () => {
    mockFetch.mockResolvedValue([])
    render(<LibraryWishlistsTab />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(
      screen.getByText(/You don't have any wishlists yet/i),
    ).toBeInTheDocument()
  })

  it('lists wishlists with their item counts', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 1,
        name: 'Mew hunt',
        description: 'all the Mew variants',
        created_at: '2026-06-06T00:00:00',
        item_count: 3,
      },
      {
        id: 2,
        name: 'White whale',
        description: null,
        created_at: '2026-06-05T00:00:00',
        item_count: 1,
      },
    ])
    render(<LibraryWishlistsTab />)

    await waitFor(() =>
      expect(screen.getByText('Mew hunt')).toBeInTheDocument(),
    )
    expect(screen.getByText('all the Mew variants')).toBeInTheDocument()
    expect(screen.getByText('3 cards')).toBeInTheDocument()
    expect(screen.getByText('1 card')).toBeInTheDocument()
  })

  it('surfaces a fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    render(<LibraryWishlistsTab />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network down/i),
    )
  })

  it('opens the detail modal when a wishlist row is clicked', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 7,
        name: 'Mew hunt',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 1,
      },
    ])
    mockFetchWishlist.mockResolvedValue({
      id: 7,
      name: 'Mew hunt',
      description: null,
      created_at: '2026-06-06T00:00:00',
      items: [
        {
          id: 11,
          card: { id: 'base1-4', name: 'Charizard' },
          notes: null,
          max_price: null,
          added_at: '2026-06-06T00:00:00',
          card_set_id: 'base1',
          card_number: '4',
          card_name: 'Charizard',
          card_rarity: 'Rare Holo',
          card_types: null,
          card_image_url: null,
          price_snapshot: null,
          priced_at: null,
          acquired_at: null,
          acquired_collection_item_id: null,
        },
      ],
    })
    render(<LibraryWishlistsTab />)
    await waitFor(() => expect(screen.getByText('Mew hunt')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Mew hunt'))

    await waitFor(() =>
      expect(screen.getByText('1 still chasing · 0 landed')).toBeInTheDocument(),
    )
    expect(mockFetchWishlist).toHaveBeenCalledWith(7)
    expect(screen.getByText('Charizard')).toBeInTheDocument()
  })
})
