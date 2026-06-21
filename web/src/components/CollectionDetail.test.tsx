import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CollectionDetail } from './CollectionDetail'
import { fetchCollection } from '../api/client'
import type { Collection, CollectionSummary } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollection: vi.fn(),
}))

const mockFetch = vi.mocked(fetchCollection)

const SUMMARY: CollectionSummary = {
  id: 3,
  name: 'Base Set holos',
  description: null,
  created_at: '2026-06-21T00:00:00',
  item_count: 1,
  kind: 'manual',
}

function collectionWith(items: Collection['items']): Collection {
  return {
    id: 3,
    name: 'Base Set holos',
    description: null,
    created_at: '2026-06-21T00:00:00',
    items,
    kind: 'manual',
  }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('CollectionDetail', () => {
  it('lists the collection cards with their snapshot price', async () => {
    mockFetch.mockResolvedValue(
      collectionWith([
        {
          id: 1,
          card: { name: 'Charizard', images: { small: 'https://img/base1-4.png' } },
          notes: null,
          added_at: '2026-06-21T00:00:00',
          quantity: 2,
          card_set_id: 'base1',
          card_number: '4',
          card_name: 'Charizard',
          card_rarity: 'Rare Holo',
          card_image_url: 'https://img/base1-4.png',
          price_snapshot: 250,
        },
      ]),
    )

    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)

    expect(await screen.findByText('Charizard')).toBeInTheDocument()
    expect(screen.getByText(/base1-4/)).toBeInTheDocument()
    // Snapshot total folds in quantity (2 × $250).
    expect(screen.getByText('$500.00')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(3)
  })

  it('shows an empty state for a freshly created collection', async () => {
    mockFetch.mockResolvedValue(collectionWith([]))
    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)
    expect(await screen.findByText('No cards yet.')).toBeInTheDocument()
  })

  it("doesn't fetch while closed", () => {
    render(<CollectionDetail collection={SUMMARY} open={false} onOpenChange={() => {}} />)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
