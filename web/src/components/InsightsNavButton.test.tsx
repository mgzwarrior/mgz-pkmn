import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { InsightsNavButton, INSIGHTS_NAV_THRESHOLD } from './InsightsNavButton'
import { fetchCollections, fetchCollectionInsights, type CollectionSummary } from '../api/client'
import { _resetCollectionsCacheForTests } from './useCollections'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  // CollectionInsights (rendered by the button) reads this when opened; the
  // gate tests never open the dialog, so a stub is enough.
  fetchCollectionInsights: vi.fn(() => Promise.resolve({})),
}))

const mockFetch = vi.mocked(fetchCollections)
const mockFetchInsights = vi.mocked(fetchCollectionInsights)

function summary(overrides: Partial<CollectionSummary>): CollectionSummary {
  return {
    id: 1,
    name: 'Binder',
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    item_count: 0,
    total_quantity: 0,
    kind: 'manual',
    ...overrides,
  }
}

describe('InsightsNavButton (#741)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    _resetCollectionsCacheForTests()
  })

  it('stays hidden below the 25-card threshold', async () => {
    mockFetch.mockResolvedValue([summary({ total_quantity: INSIGHTS_NAV_THRESHOLD - 1 })])
    render(<InsightsNavButton />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Collection insights/i })).not.toBeInTheDocument()
  })

  it('surfaces once 25+ cards are collected', async () => {
    mockFetch.mockResolvedValue([
      summary({ id: 1, total_quantity: 20 }),
      summary({ id: 2, total_quantity: 5 }),
    ])
    render(<InsightsNavButton />)
    expect(
      await screen.findByRole('button', { name: /Collection insights/i }),
    ).toBeInTheDocument()
  })

  it('excludes dynamic collections from the count', async () => {
    mockFetch.mockResolvedValue([
      summary({ id: 1, total_quantity: 10, kind: 'manual' }),
      summary({ id: 2, total_quantity: 100, kind: 'dynamic' }),
    ])
    render(<InsightsNavButton />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Collection insights/i })).not.toBeInTheDocument()
  })

  it('renders a labeled tab and opens the dialog on tap (#519)', async () => {
    mockFetch.mockResolvedValue([summary({ total_quantity: INSIGHTS_NAV_THRESHOLD })])
    mockFetchInsights.mockResolvedValue({
      totals: { collections: 1, unique_cards: 3, total_quantity: INSIGHTS_NAV_THRESHOLD, estimated_value: 100 },
      top_types: [],
      top_rarities: [],
      top_sets: [],
      top_value_cards: [],
      value_by_set: [],
      value_by_collection: [],
      duplicate_multiples: [],
      cross_collection: [],
      already_owned_chasing: [],
    })
    render(<InsightsNavButton variant="tab" />)
    const tab = await screen.findByRole('button', { name: /Collection insights/i })
    expect(tab).toHaveTextContent('Insights')
    expect(tab).toHaveAttribute('aria-haspopup', 'dialog')
    expect(tab).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(tab)
    expect(tab).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
