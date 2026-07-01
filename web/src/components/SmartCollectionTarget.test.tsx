import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SmartCollectionTarget } from './SmartCollectionTarget'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { fetchCollectionTarget, chaseCollection } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollectionTarget: vi.fn(),
  chaseCollection: vi.fn(),
  fetchWishlists: vi.fn(() => Promise.resolve([])),
}))

const mockTarget = vi.mocked(fetchCollectionTarget)
const mockChase = vi.mocked(chaseCollection)

const COLLECTION = {
  id: 7,
  name: 'All Eevees',
  description: null,
  created_at: '2026-06-06T00:00:00',
  item_count: 3,
  kind: 'dynamic' as const,
  source_set_id: null,
  rule: { name: 'eevee' },
  dynamic_scope: 'catalog' as const,
}

const TARGET = {
  id: 7,
  name: 'All Eevees',
  rule: { name: 'eevee' },
  total: 3,
  owned_count: 1,
  cards: [
    { card: { id: 'sv1-130', name: 'Eevee' }, card_set_id: 'sv1', card_number: '130', owned: true, owned_quantity: 2 },
    { card: { id: 'sv4-167', name: 'Eevee ex' }, card_set_id: 'sv4', card_number: '167', owned: false, owned_quantity: 0 },
    { card: { id: 'swsh7-186', name: 'Eevee VMAX' }, card_set_id: 'swsh7', card_number: '186', owned: false, owned_quantity: 0 },
  ],
}

describe('SmartCollectionTarget', () => {
  beforeEach(() => {
    _resetWishlistsCacheForTests()
    mockTarget.mockReset()
    mockChase.mockReset()
  })

  it('renders progress and the owned / missing split', async () => {
    mockTarget.mockResolvedValue(TARGET)
    render(<SmartCollectionTarget collection={COLLECTION} open onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByText(/of 3 owned/)).toBeInTheDocument())
    expect(screen.getByText('1')).toBeInTheDocument() // owned_count headline
    expect(screen.getByText(/33% complete/)).toBeInTheDocument()
    expect(screen.getByText('Owned (1)')).toBeInTheDocument()
    expect(screen.getByText(/Missing.*\(2\)/)).toBeInTheDocument()
  })

  it('chases the missing cards onto a new wishlist named after the collection', async () => {
    mockTarget.mockResolvedValue(TARGET)
    mockChase.mockResolvedValue({ wishlist_id: 3, added: 2, skipped: 0, total_missing: 2 })
    render(<SmartCollectionTarget collection={COLLECTION} open onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByText(/of 3 owned/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /add 2 missing to wishlist/i }))

    await waitFor(() =>
      expect(mockChase).toHaveBeenCalledWith(7, { wishlistName: 'All Eevees' }, undefined),
    )
    await waitFor(() =>
      expect(screen.getByText(/added 2 to your wishlist/i)).toBeInTheDocument(),
    )
  })

  it('tops up the same want-list on a second chase', async () => {
    mockTarget.mockResolvedValue(TARGET)
    mockChase
      .mockResolvedValueOnce({ wishlist_id: 3, added: 2, skipped: 0, total_missing: 2 })
      .mockResolvedValueOnce({ wishlist_id: 3, added: 0, skipped: 2, total_missing: 2 })
    render(<SmartCollectionTarget collection={COLLECTION} open onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByText(/of 3 owned/)).toBeInTheDocument())
    const btn = screen.getByRole('button', { name: /add 2 missing to wishlist/i })
    fireEvent.click(btn)
    await waitFor(() => expect(mockChase).toHaveBeenCalledTimes(1))
    fireEvent.click(btn)

    await waitFor(() =>
      expect(mockChase).toHaveBeenLastCalledWith(7, { wishlistId: 3 }, undefined),
    )
  })
})
