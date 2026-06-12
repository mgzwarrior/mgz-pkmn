import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryCollectionsTab } from './LibraryCollectionsTab'
import { _resetCollectionsCacheForTests } from './useCollections'
import { fetchCollections, createCollection } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
}))

const mockFetch = vi.mocked(fetchCollections)
const mockCreate = vi.mocked(createCollection)

describe('LibraryCollectionsTab', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    mockFetch.mockReset()
    mockCreate.mockReset()
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
      }),
    )
  })
})
