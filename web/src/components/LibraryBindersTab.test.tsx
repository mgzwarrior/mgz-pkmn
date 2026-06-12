import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LibraryBindersTab } from './LibraryBindersTab'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import {
  fetchCollections,
  createCollection,
  fetchWishlists,
  fetchWishlist,
  fetchCollectionTarget,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
  fetchWishlists: vi.fn(),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
  fetchWishlist: vi.fn(),
  promoteWishlistItem: vi.fn(),
  fetchCollectionTarget: vi.fn(),
  chaseCollection: vi.fn(),
}))

const mockCollections = vi.mocked(fetchCollections)
const mockWishlists = vi.mocked(fetchWishlists)
const mockCreate = vi.mocked(createCollection)
const mockFetchWishlist = vi.mocked(fetchWishlist)
const mockTarget = vi.mocked(fetchCollectionTarget)

describe('LibraryBindersTab', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    mockCollections.mockReset()
    mockWishlists.mockReset()
    mockCreate.mockReset()
    mockFetchWishlist.mockReset()
    mockTarget.mockReset()
    mockCollections.mockResolvedValue([])
    mockWishlists.mockResolvedValue([])
  })

  it('shows the combined empty state when there are no binders', async () => {
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())
    expect(
      await screen.findByText(/You don't have any binders yet/i),
    ).toBeInTheDocument()
  })

  it('interleaves owned collections and chasing want-lists newest-first with kind badges', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 1,
        name: 'Charizard masters',
        description: 'all the holos',
        created_at: '2026-06-04T00:00:00',
        item_count: 4,
      },
    ])
    mockWishlists.mockResolvedValue([
      {
        id: 2,
        name: 'Mew hunt',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 3,
      },
    ])
    render(<LibraryBindersTab />)

    await waitFor(() =>
      expect(screen.getByText('Charizard masters')).toBeInTheDocument(),
    )
    expect(screen.getByText('Mew hunt')).toBeInTheDocument()
    // "Owned"/"Chasing" also label the filter radios, so scope the kind
    // badge assertions to the list itself.
    const list = screen.getByRole('list')
    expect(within(list).getByText('Owned')).toBeInTheDocument()
    expect(within(list).getByText('Chasing')).toBeInTheDocument()
    expect(screen.getByText('4 cards')).toBeInTheDocument()
    expect(screen.getByText('3 cards')).toBeInTheDocument()

    // Newest-first: the want-list (06-06) sorts above the collection (06-04).
    const names = screen.getAllByText(/Charizard masters|Mew hunt/)
    expect(names.map((n) => n.textContent)).toEqual(['Mew hunt', 'Charizard masters'])
  })

  it('filters to owned binders only', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'Charizard masters', description: null, created_at: '2026-06-04T00:00:00', item_count: 4 },
    ])
    mockWishlists.mockResolvedValue([
      { id: 2, name: 'Mew hunt', description: null, created_at: '2026-06-06T00:00:00', item_count: 3 },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Mew hunt')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('radio', { name: /^owned$/i }))

    expect(screen.getByText('Charizard masters')).toBeInTheDocument()
    expect(screen.queryByText('Mew hunt')).not.toBeInTheDocument()
  })

  it('filters to chasing binders only', async () => {
    mockCollections.mockResolvedValue([
      { id: 1, name: 'Charizard masters', description: null, created_at: '2026-06-04T00:00:00', item_count: 4 },
    ])
    mockWishlists.mockResolvedValue([
      { id: 2, name: 'Mew hunt', description: null, created_at: '2026-06-06T00:00:00', item_count: 3 },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Charizard masters')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('radio', { name: /^chasing$/i }))

    expect(screen.getByText('Mew hunt')).toBeInTheDocument()
    expect(screen.queryByText('Charizard masters')).not.toBeInTheDocument()
  })

  it('surfaces a fetch error', async () => {
    mockCollections.mockRejectedValue(new Error('network down'))
    render(<LibraryBindersTab />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network down/i),
    )
  })

  it('renders a smart pill for rule-based collections', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 1,
        name: 'All Eevees',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 3,
        kind: 'dynamic',
        source_set_id: null,
        rule: { name: 'eevee' },
      },
    ])
    render(<LibraryBindersTab />)
    await waitFor(() =>
      expect(screen.getByText('All Eevees')).toBeInTheDocument(),
    )
    expect(screen.getByText('smart')).toBeInTheDocument()
  })

  it('creates a dynamic collection from the inline rule form', async () => {
    mockCreate.mockResolvedValue({
      id: 9,
      name: 'All Eevees',
      description: null,
      created_at: '2026-06-11T00:00:00',
      items: [],
      kind: 'dynamic',
      source_set_id: null,
      rule: { name: 'Eevee' },
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /new smart collection/i }))
    fireEvent.change(screen.getByPlaceholderText(/collection name/i), {
      target: { value: 'All Eevees' },
    })
    fireEvent.change(screen.getByPlaceholderText('Eevee'), {
      target: { value: 'Eevee' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('All Eevees', {
        kind: 'dynamic',
        rule: { name: 'Eevee' },
        dynamic_scope: 'owned',
      }),
    )
  })

  it('creates a catalog-scope target when the scope toggle is flipped', async () => {
    mockCreate.mockResolvedValue({
      id: 9,
      name: 'All Eevees',
      description: null,
      created_at: '2026-06-11T00:00:00',
      items: [],
      kind: 'dynamic',
      source_set_id: null,
      rule: { name: 'Eevee' },
      dynamic_scope: 'catalog',
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(mockCollections).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /new smart collection/i }))
    fireEvent.change(screen.getByPlaceholderText(/collection name/i), {
      target: { value: 'All Eevees' },
    })
    fireEvent.change(screen.getByPlaceholderText('Eevee'), {
      target: { value: 'Eevee' },
    })
    fireEvent.click(screen.getByRole('radio', { name: /whole catalog/i }))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('All Eevees', {
        kind: 'dynamic',
        rule: { name: 'Eevee' },
        dynamic_scope: 'catalog',
      }),
    )
  })

  it('opens the target modal for a catalog-scope collection', async () => {
    mockCollections.mockResolvedValue([
      {
        id: 7,
        name: 'All Eevees',
        description: null,
        created_at: '2026-06-06T00:00:00',
        item_count: 3,
        kind: 'dynamic',
        source_set_id: null,
        rule: { name: 'eevee' },
        dynamic_scope: 'catalog',
      },
    ])
    mockTarget.mockResolvedValue({
      id: 7,
      name: 'All Eevees',
      rule: { name: 'eevee' },
      total: 3,
      owned_count: 1,
      cards: [
        { card: { id: 'sv1-130', name: 'Eevee' }, card_set_id: 'sv1', card_number: '130', owned: true, owned_quantity: 1 },
        { card: { id: 'sv4-167', name: 'Eevee ex' }, card_set_id: 'sv4', card_number: '167', owned: false, owned_quantity: 0 },
        { card: { id: 'swsh7-186', name: 'Eevee VMAX' }, card_set_id: 'swsh7', card_number: '186', owned: false, owned_quantity: 0 },
      ],
    })
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('target')).toBeInTheDocument())

    fireEvent.click(screen.getByText('All Eevees'))

    await waitFor(() => expect(mockTarget).toHaveBeenCalledWith(7, undefined))
    await waitFor(() =>
      expect(screen.getByText(/of 3 owned/)).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: /add 2 missing to want-list/i }),
    ).toBeInTheDocument()
  })

  it('opens the detail modal when a want-list row is clicked', async () => {
    mockWishlists.mockResolvedValue([
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
    render(<LibraryBindersTab />)
    await waitFor(() => expect(screen.getByText('Mew hunt')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Mew hunt'))

    await waitFor(() =>
      expect(screen.getByText('1 still chasing · 0 landed')).toBeInTheDocument(),
    )
    expect(mockFetchWishlist).toHaveBeenCalledWith(7)
    // The card name renders inside the opened detail dialog.
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Charizard')).toBeInTheDocument()
  })
})
