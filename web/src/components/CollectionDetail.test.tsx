import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CollectionDetail } from './CollectionDetail'
import { _resetCollectionsCacheForTests } from './useCollections'
import {
  fetchCollection,
  fetchCollections,
  updateCollection,
  updateCollectionItem,
} from '../api/client'
import type { Collection, CollectionItem, CollectionSummary } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollection: vi.fn(),
  // useCollections is pulled in for the editable quantity stepper (#769).
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  addCardToCollection: vi.fn(),
  bulkAddToCollection: vi.fn(),
  updateCollectionItem: vi.fn(),
}))

const mockFetch = vi.mocked(fetchCollection)
const mockFetchList = vi.mocked(fetchCollections)
const mockUpdate = vi.mocked(updateCollection)
const mockUpdateItem = vi.mocked(updateCollectionItem)

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

/** One collection item with sensible defaults for the fields the row reads. */
function item(over: Partial<CollectionItem> = {}): CollectionItem {
  return {
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
    ...over,
  }
}

beforeEach(() => {
  _resetCollectionsCacheForTests()
  mockFetch.mockReset()
  mockFetchList.mockReset()
  mockFetchList.mockResolvedValue([])
  mockUpdate.mockReset()
  mockUpdateItem.mockReset()
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
    // The row shows the line total (unit × qty = 2 × $250) and the snapshot
    // total folds in quantity the same way (#790).
    expect(screen.getByLabelText(/^Line total/)).toHaveTextContent('$500.00')
    expect(screen.getByText(/Snapshot total/i)).toHaveTextContent('$500.00')
    expect(mockFetch).toHaveBeenCalledWith(3)
  })

  it('shows an empty state for a freshly created collection', async () => {
    mockFetch.mockResolvedValue(collectionWith([]))
    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)
    expect(await screen.findByText('No cards yet.')).toBeInTheDocument()
    // No export control when there's nothing to export (#773).
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
  })

  it('offers export when the collection has cards (#773)', async () => {
    mockFetch.mockResolvedValue(collectionWith([item({ id: 7 })]))
    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)
    await screen.findByText('Charizard')
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  })

  it("doesn't fetch while closed", () => {
    render(<CollectionDetail collection={SUMMARY} open={false} onOpenChange={() => {}} />)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('increments a card quantity from the stepper (#769)', async () => {
    mockFetch.mockResolvedValue(collectionWith([item({ id: 7, quantity: 2 })]))
    mockUpdateItem.mockResolvedValue(item({ id: 7, quantity: 3 }))
    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)

    await screen.findByText('Charizard')
    fireEvent.click(screen.getByRole('button', { name: /increase quantity of charizard/i }))

    await waitFor(() => expect(mockUpdateItem).toHaveBeenCalledWith(3, 7, 3))
    // Optimistic update bumps the displayed count.
    expect(screen.getByLabelText(/owned quantity of charizard/i)).toHaveTextContent('3')
  })

  it('updates the row line total and snapshot total after a quantity change (#790)', async () => {
    mockFetch.mockResolvedValue(collectionWith([item({ id: 7, quantity: 2, price_snapshot: 250 })]))
    mockUpdateItem.mockResolvedValue(item({ id: 7, quantity: 3, price_snapshot: 250 }))
    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)

    await screen.findByText('Charizard')
    // Before: 2 × $250 on both the row and the snapshot total.
    expect(screen.getByLabelText(/^Line total/)).toHaveTextContent('$500.00')
    expect(screen.getByText(/Snapshot total/i)).toHaveTextContent('$500.00')

    fireEvent.click(screen.getByRole('button', { name: /increase quantity of charizard/i }))

    // After: the optimistic 3 × $250 flows into both prices, no reopen.
    await waitFor(() => expect(screen.getByLabelText(/^Line total/)).toHaveTextContent('$750.00'))
    expect(screen.getByText(/Snapshot total/i)).toHaveTextContent('$750.00')
  })

  it('disables the stepper while a quantity update is in flight (#769 review)', async () => {
    mockFetch.mockResolvedValue(collectionWith([item({ id: 7, quantity: 2 })]))
    // Hold the PATCH open so we can observe the pending (disabled) state.
    let resolvePatch!: (v: CollectionItem) => void
    mockUpdateItem.mockReturnValue(
      new Promise<CollectionItem>((res) => {
        resolvePatch = res
      }),
    )
    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)

    await screen.findByText('Charizard')
    const inc = screen.getByRole('button', { name: /increase quantity of charizard/i })
    fireEvent.click(inc)

    // Both controls are gated until the in-flight request resolves, so a
    // second click can't race an out-of-order absolute update onto the server.
    await waitFor(() => expect(inc).toBeDisabled())
    expect(screen.getByRole('button', { name: /decrease quantity of charizard/i })).toBeDisabled()
    expect(mockUpdateItem).toHaveBeenCalledTimes(1)

    resolvePatch(item({ id: 7, quantity: 3 }))
    await waitFor(() => expect(inc).not.toBeDisabled())
  })

  it('floors the stepper at 1 (decrement disabled)', async () => {
    mockFetch.mockResolvedValue(collectionWith([item({ id: 7, quantity: 1 })]))
    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)

    await screen.findByText('Charizard')
    expect(screen.getByRole('button', { name: /decrease quantity of charizard/i })).toBeDisabled()
  })

  it('shows quantity read-only for a dynamic (smart) collection', async () => {
    const dynamic: CollectionSummary = { ...SUMMARY, kind: 'dynamic' }
    mockFetch.mockResolvedValue({
      ...collectionWith([item({ id: 7, quantity: 4 })]),
      kind: 'dynamic',
    } as Collection)
    render(<CollectionDetail collection={dynamic} open onOpenChange={() => {}} />)

    await screen.findByText('Charizard')
    // No editable stepper — the rule defines membership, so counts aren't editable.
    expect(
      screen.queryByRole('button', { name: /increase quantity/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText(/owned quantity/i)).toHaveTextContent('4x')
  })

  it('renames the collection from the header and reflects it live (#787)', async () => {
    mockFetch.mockResolvedValue(collectionWith([]))
    mockUpdate.mockResolvedValue({ ...collectionWith([]), name: 'Vintage holos' })
    render(<CollectionDetail collection={SUMMARY} open onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByText('Base Set holos')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /rename collection/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /collection name/i }), {
      target: { value: 'Vintage holos' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save collection name/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(3, { name: 'Vintage holos' }))
    await waitFor(() => expect(screen.getByText('Vintage holos')).toBeInTheDocument())
  })
})
