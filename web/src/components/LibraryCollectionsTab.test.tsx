import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryCollectionsTab } from './LibraryCollectionsTab'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import {
  fetchCollections,
  createCollection,
  fetchCollectionTarget,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
  // Pulled in by the always-mounted target modal + its want-list hook.
  fetchWishlists: vi.fn(() => Promise.resolve([])),
  fetchCollectionTarget: vi.fn(),
  chaseCollection: vi.fn(),
}))

const mockFetch = vi.mocked(fetchCollections)
const mockCreate = vi.mocked(createCollection)
const mockTarget = vi.mocked(fetchCollectionTarget)

describe('LibraryCollectionsTab', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    mockFetch.mockReset()
    mockCreate.mockReset()
    mockTarget.mockReset()
  })

  it('shows the empty state when the user has no collections', async () => {
    mockFetch.mockResolvedValue([])
    render(<LibraryCollectionsTab />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(
      screen.getByText(/You don't have any collections yet/i),
    ).toBeInTheDocument()
  })

  it('lists collections with their item counts', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 1,
        name: 'Charizard masters',
        description: 'all the holos',
        created_at: '2026-06-06T00:00:00',
        item_count: 4,
      },
      {
        id: 2,
        name: 'Show pickups',
        description: null,
        created_at: '2026-06-05T00:00:00',
        item_count: 1,
      },
    ])
    render(<LibraryCollectionsTab />)

    await waitFor(() =>
      expect(screen.getByText('Charizard masters')).toBeInTheDocument(),
    )
    expect(screen.getByText('all the holos')).toBeInTheDocument()
    expect(screen.getByText('4 cards')).toBeInTheDocument()
    expect(screen.getByText('1 card')).toBeInTheDocument()
  })

  it('surfaces a fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    render(<LibraryCollectionsTab />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network down/i),
    )
  })

  it('renders a smart/set pill for rule-based collections', async () => {
    mockFetch.mockResolvedValue([
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
    render(<LibraryCollectionsTab />)
    await waitFor(() =>
      expect(screen.getByText('All Eevees')).toBeInTheDocument(),
    )
    expect(screen.getByText('smart')).toBeInTheDocument()
  })

  it('creates a dynamic collection from the inline rule form', async () => {
    mockFetch.mockResolvedValue([])
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
    render(<LibraryCollectionsTab />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())

    fireEvent.click(
      screen.getByRole('button', { name: /new smart collection/i }),
    )
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
    mockFetch.mockResolvedValue([])
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
    render(<LibraryCollectionsTab />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())

    fireEvent.click(
      screen.getByRole('button', { name: /new smart collection/i }),
    )
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
    mockFetch.mockResolvedValue([
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
    render(<LibraryCollectionsTab />)
    await waitFor(() => expect(screen.getByText('target')).toBeInTheDocument())

    fireEvent.click(screen.getByText('All Eevees'))

    await waitFor(() => expect(mockTarget).toHaveBeenCalledWith(7, undefined))
    // Progress headline + chase affordance render from the resolved target.
    await waitFor(() =>
      expect(screen.getByText(/of 3 owned/)).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: /add 2 missing to want-list/i }),
    ).toBeInTheDocument()
  })
})
