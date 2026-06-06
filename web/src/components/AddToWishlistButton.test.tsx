import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddToWishlistButton } from './AddToWishlistButton'
import { _resetWishlistsCacheForTests } from './useWishlists'
import {
  fetchWishlists,
  createWishlist,
  addCardToWishlist,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchWishlists: vi.fn(),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
}))

const mockFetch = vi.mocked(fetchWishlists)
const mockCreate = vi.mocked(createWishlist)
const mockAdd = vi.mocked(addCardToWishlist)

const SAMPLE_CARD = { id: 'base1-4', name: 'Charizard' }

function openMenu() {
  const trigger = screen.getByRole('button', { name: /Save to wishlist/i })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
}

describe('AddToWishlistButton', () => {
  beforeEach(() => {
    _resetWishlistsCacheForTests()
    mockFetch.mockReset()
    mockCreate.mockReset()
    mockAdd.mockReset()
  })

  it('renders the trigger and fetches wishlists on mount', async () => {
    mockFetch.mockResolvedValue([])
    render(<AddToWishlistButton card={SAMPLE_CARD} />)
    expect(
      screen.getByRole('button', { name: /Save to wishlist/i }),
    ).toBeInTheDocument()
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
  })

  it('shows an empty state when no wishlists exist', async () => {
    mockFetch.mockResolvedValue([])
    render(<AddToWishlistButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()
    await waitFor(() =>
      expect(screen.getByText(/No wishlists yet/i)).toBeInTheDocument(),
    )
  })

  it('lists existing wishlists and adds the card on click', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 7,
        name: 'Charizard hunt',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 0,
      },
    ])
    mockAdd.mockResolvedValue({
      id: 1,
      card: SAMPLE_CARD,
      notes: null,
      max_price: null,
      added_at: '2026-06-06T00:00:01',
    })

    render(<AddToWishlistButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()
    const label = await screen.findByText('Charizard hunt')
    const item = label.closest('[role="menuitem"]')!
    fireEvent.click(item)

    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith(7, SAMPLE_CARD, undefined),
    )
  })

  it('creates a new wishlist with an optional max_price cap', async () => {
    mockFetch.mockResolvedValue([])
    mockCreate.mockResolvedValue({
      id: 42,
      name: 'Under $50',
      description: null,
      created_at: '2026-06-06T00:00:00',
      items: [],
    })
    mockAdd.mockResolvedValue({
      id: 1,
      card: SAMPLE_CARD,
      notes: null,
      max_price: 50,
      added_at: '2026-06-06T00:00:01',
    })

    render(<AddToWishlistButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()

    const newItem = (await screen.findByText(/New wishlist/i)).closest(
      '[role="menuitem"]',
    )!
    fireEvent.click(newItem)
    fireEvent.change(
      await screen.findByRole('textbox', { name: /New wishlist name/i }),
      { target: { value: 'Under $50' } },
    )
    // The cap field is a `number` input — find by label.
    fireEvent.change(screen.getByLabelText(/Max price/i), {
      target: { value: '50' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('Under $50', undefined),
    )
    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith(42, SAMPLE_CARD, { maxPrice: 50 }),
    )
  })

  it('creates a new wishlist without a cap when the field is left blank', async () => {
    mockFetch.mockResolvedValue([])
    mockCreate.mockResolvedValue({
      id: 99,
      name: 'No cap',
      description: null,
      created_at: '2026-06-06T00:00:00',
      items: [],
    })
    mockAdd.mockResolvedValue({
      id: 1,
      card: SAMPLE_CARD,
      notes: null,
      max_price: null,
      added_at: '2026-06-06T00:00:01',
    })

    render(<AddToWishlistButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()
    const newItem = (await screen.findByText(/New wishlist/i)).closest(
      '[role="menuitem"]',
    )!
    fireEvent.click(newItem)
    fireEvent.change(
      await screen.findByRole('textbox', { name: /New wishlist name/i }),
      { target: { value: 'No cap' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith(99, SAMPLE_CARD, { maxPrice: null }),
    )
  })

  it('surfaces an error when the add call fails', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 7,
        name: 'Errors here',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 0,
      },
    ])
    mockAdd.mockRejectedValue(new Error('boom'))

    render(<AddToWishlistButton card={SAMPLE_CARD} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    openMenu()
    const item = (await screen.findByText('Errors here')).closest(
      '[role="menuitem"]',
    )!
    fireEvent.click(item)
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument())
  })
})
