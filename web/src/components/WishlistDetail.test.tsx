import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WishlistDetail } from './WishlistDetail'
import { _resetCollectionsCacheForTests } from './useCollections'
import {
  fetchWishlist,
  fetchCollections,
  promoteWishlistItem,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchWishlist: vi.fn(),
  promoteWishlistItem: vi.fn(),
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
}))

const mockFetchWishlist = vi.mocked(fetchWishlist)
const mockFetchCollections = vi.mocked(fetchCollections)
const mockPromote = vi.mocked(promoteWishlistItem)

const WISHLIST = {
  id: 7,
  name: 'Mew hunt',
  description: null,
  created_at: '2026-06-06T00:00:00',
  item_count: 2,
}

function item(overrides: Record<string, unknown>) {
  return {
    id: 1,
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
    ...overrides,
  }
}

describe('WishlistDetail', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    mockFetchWishlist.mockReset()
    mockFetchCollections.mockReset()
    mockPromote.mockReset()
    mockFetchCollections.mockResolvedValue([])
  })

  it('lists items with an outstanding / landed count', async () => {
    mockFetchWishlist.mockResolvedValue({
      ...WISHLIST,
      items: [
        item({ id: 1, card_name: 'Charizard' }),
        item({ id: 2, card_name: 'Blastoise', acquired_at: '2026-06-07T00:00:00', acquired_collection_item_id: 99 }),
      ],
    })
    render(<WishlistDetail wishlist={WISHLIST} open onOpenChange={() => {}} />)

    await waitFor(() =>
      expect(screen.getByText('1 still chasing · 1 landed')).toBeInTheDocument(),
    )
    expect(screen.getByText('Charizard')).toBeInTheDocument()
    // The acquired one is struck through.
    expect(screen.getByText('Blastoise')).toHaveClass('line-through')
  })

  it('promotes an item into a collection and marks it acquired', async () => {
    mockFetchWishlist.mockResolvedValue({
      ...WISHLIST,
      items: [item({ id: 1, card_name: 'Charizard' })],
    })
    mockFetchCollections.mockResolvedValue([
      {
        id: 3,
        name: 'Show Binder',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 5,
      },
    ])
    mockPromote.mockResolvedValue({
      wishlist_item: item({
        id: 1,
        card_name: 'Charizard',
        acquired_at: '2026-06-08T00:00:00',
        acquired_collection_item_id: 42,
      }),
      collection_item: {} as never,
    })
    render(<WishlistDetail wishlist={WISHLIST} open onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByText('Charizard')).toBeInTheDocument())

    // Radix DropdownMenu opens on the keyboard activation path under jsdom.
    const trigger = screen.getByRole('button', { name: /got it/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })

    const target = (await screen.findByText('Show Binder')).closest(
      '[role="menuitem"]',
    )!
    fireEvent.click(target)

    await waitFor(() =>
      expect(mockPromote).toHaveBeenCalledWith(7, 1, { collectionId: 3 }),
    )
    // The row flips from "still chasing" to "landed".
    await waitFor(() =>
      expect(screen.getByText('0 still chasing · 1 landed')).toBeInTheDocument(),
    )
  })
})
