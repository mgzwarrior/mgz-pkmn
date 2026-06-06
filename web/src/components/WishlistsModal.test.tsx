import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WishlistsModal } from './WishlistsModal'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { fetchWishlists } from '../api/client'

vi.mock('../api/client', () => ({
  fetchWishlists: vi.fn(),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
}))

const mockFetch = vi.mocked(fetchWishlists)

describe('WishlistsModal', () => {
  beforeEach(() => {
    _resetWishlistsCacheForTests()
    mockFetch.mockReset()
  })

  it('renders nothing when closed', () => {
    mockFetch.mockResolvedValue([])
    render(<WishlistsModal open={false} onOpenChange={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the empty state when the user has no wishlists', async () => {
    mockFetch.mockResolvedValue([])
    render(<WishlistsModal open onOpenChange={() => {}} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(
      screen.getByText(/You don't have any wishlists yet/i),
    ).toBeInTheDocument()
  })

  it('lists wishlists with their item counts', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 1,
        name: 'Charizard hunt',
        description: 'every set',
        created_at: '2026-06-06T00:00:00',
        item_count: 4,
      },
      {
        id: 2,
        name: 'Under $50',
        description: null,
        created_at: '2026-06-05T00:00:00',
        item_count: 1,
      },
    ])
    render(<WishlistsModal open onOpenChange={() => {}} />)

    await waitFor(() =>
      expect(screen.getByText('Charizard hunt')).toBeInTheDocument(),
    )
    expect(screen.getByText('every set')).toBeInTheDocument()
    expect(screen.getByText('4 cards')).toBeInTheDocument()
    expect(screen.getByText('1 card')).toBeInTheDocument()
  })

  it('surfaces a fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    render(<WishlistsModal open onOpenChange={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText(/network down/i)).toBeInTheDocument(),
    )
  })
})
