import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LibraryCollectionsTab } from './LibraryCollectionsTab'
import { _resetCollectionsCacheForTests } from './useCollections'
import { fetchCollections } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
}))

const mockFetch = vi.mocked(fetchCollections)

describe('LibraryCollectionsTab', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    mockFetch.mockReset()
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
})
