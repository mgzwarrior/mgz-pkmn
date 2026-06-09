import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LibraryWishlistsTab } from './LibraryWishlistsTab'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { fetchWishlists } from '../api/client'

vi.mock('../api/client', () => ({
  fetchWishlists: vi.fn(),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
}))

const mockFetch = vi.mocked(fetchWishlists)

describe('LibraryWishlistsTab', () => {
  beforeEach(() => {
    _resetWishlistsCacheForTests()
    mockFetch.mockReset()
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
})
