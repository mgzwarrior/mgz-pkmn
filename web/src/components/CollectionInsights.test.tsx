import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { CollectionInsights } from './CollectionInsights'
import { fetchCollectionInsights, type CollectionInsights as Insights } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollectionInsights: vi.fn(),
}))

const mockFetch = vi.mocked(fetchCollectionInsights)

function insights(overrides: Partial<Insights> = {}): Insights {
  return {
    totals: { collections: 2, unique_cards: 3, total_quantity: 5, estimated_value: 500 },
    top_types: [
      { label: 'Fire', count: 2 },
      { label: 'Water', count: 1 },
    ],
    top_rarities: [{ label: 'Rare Holo', count: 1 }],
    top_sets: [{ label: 'base1', count: 2 }],
    duplicate_multiples: [],
    cross_collection: [],
    already_owned_chasing: [],
    ...overrides,
  }
}

describe('CollectionInsights', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('renders headline totals and breakdown bars', async () => {
    mockFetch.mockResolvedValue(insights())
    render(<CollectionInsights open onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByText('Est. value')).toBeInTheDocument())
    // Totals: collections / unique / copies / value.
    expect(screen.getByText('$500.00')).toBeInTheDocument()
    expect(screen.getByText('Unique cards')).toBeInTheDocument()
    // Breakdown labels render.
    expect(screen.getByText('Top types')).toBeInTheDocument()
    expect(screen.getByText('Fire')).toBeInTheDocument()
    expect(screen.getByText('base1')).toBeInTheDocument()
  })

  it('shows the empty state when there are no cards', async () => {
    mockFetch.mockResolvedValue(
      insights({ totals: { collections: 0, unique_cards: 0, total_quantity: 0, estimated_value: 0 } }),
    )
    render(<CollectionInsights open onOpenChange={() => {}} />)

    expect(await screen.findByText(/No collection data yet/i)).toBeInTheDocument()
  })

  it('lists duplicates and the already-owned cleanup nudge', async () => {
    mockFetch.mockResolvedValue(
      insights({
        duplicate_multiples: [
          {
            card_name: 'Charizard',
            card_set_id: 'base1',
            card_number: '4',
            quantity: 3,
            collection_name: 'Trade Stock',
          },
        ],
        cross_collection: [
          {
            card_name: 'Pikachu',
            card_set_id: 'base1',
            card_number: '58',
            total_quantity: 2,
            collections: ['Show Binder', 'Trade Stock'],
          },
        ],
        already_owned_chasing: [
          {
            card_name: 'Blastoise',
            card_set_id: 'base1',
            card_number: '2',
            wishlist_id: 9,
            wishlist_name: 'Chase',
            collections: ['Show Binder'],
          },
        ],
      }),
    )
    render(<CollectionInsights open onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByText('Duplicates')).toBeInTheDocument())
    expect(screen.getByText('3x')).toBeInTheDocument()
    expect(screen.getByText('Charizard')).toBeInTheDocument()
    expect(screen.getByText('Pikachu')).toBeInTheDocument()
    // Cleanup nudge names the card and its want-list.
    const nudge = screen.getByText('Already in a binder').closest('section')!
    expect(within(nudge).getByText('Blastoise')).toBeInTheDocument()
    expect(within(nudge).getByText('Chase')).toBeInTheDocument()
  })

  it('does not fetch while closed', () => {
    render(<CollectionInsights open={false} onOpenChange={() => {}} />)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
