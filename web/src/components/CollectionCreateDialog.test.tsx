import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CollectionCreateDialog } from './CollectionCreateDialog'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetBindersCacheForTests } from './useBinders'
import {
  fetchCollections,
  createCollection,
  fetchBinders,
  createBinder,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  fetchBinders: vi.fn(),
  createBinder: vi.fn(),
}))

const mockCollections = vi.mocked(fetchCollections)
const mockCreate = vi.mocked(createCollection)
const mockBinders = vi.mocked(fetchBinders)
const mockCreateBinder = vi.mocked(createBinder)

beforeEach(() => {
  _resetCollectionsCacheForTests()
  _resetBindersCacheForTests()
  mockCollections.mockReset().mockResolvedValue([])
  mockBinders.mockReset().mockResolvedValue([])
  mockCreate.mockReset().mockResolvedValue({
    id: 1,
    name: 'X',
    description: null,
    created_at: '2026-06-21T00:00:00',
    items: [],
    kind: 'manual',
  })
  mockCreateBinder.mockReset()
})

describe('CollectionCreateDialog', () => {
  it('creates a loose collection when no binder is chosen', async () => {
    render(<CollectionCreateDialog open onOpenChange={() => {}} />)
    // Wait for the binder fetch to settle before deciding "no binders" (#724).
    await waitFor(() => expect(screen.getByLabelText('New binder name')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Base Set holos'), {
      target: { value: 'Trade pile' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Trade pile', undefined))
    expect(mockCreateBinder).not.toHaveBeenCalled()
  })

  it('files into a chosen binder and shows its free slots', async () => {
    mockBinders.mockResolvedValue([
      {
        id: 3,
        name: 'Show binder',
        created_at: '2026-06-01T00:00:00',
        binder_format: '9-pocket',
        binder_color: 'sky',
        binder_type: null,
        capacity: 360,
        collection_count: 1,
        wishlist_count: 0,
        is_empty: false,
      },
    ])
    // One collection already filed into binder 3 occupying 90 slots → 270 free.
    mockCollections.mockResolvedValue([
      {
        id: 9,
        name: 'Existing',
        description: null,
        created_at: '2026-06-02T00:00:00',
        item_count: 90,
        kind: 'manual',
        binder_id: 3,
      },
    ])

    render(<CollectionCreateDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Show binder')).toBeInTheDocument())
    expect(screen.getByText('270 of 360 slots free')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Base Set holos'), {
      target: { value: 'Base holos' },
    })
    fireEvent.click(screen.getByRole('radio', { name: /show binder/i }))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Base holos', { binder_id: 3 }))
  })

  it('creates a new binder even when binders already exist, then files into it', async () => {
    mockBinders.mockResolvedValue([
      {
        id: 3,
        name: 'Show binder',
        created_at: '2026-06-01T00:00:00',
        binder_format: null,
        binder_color: null,
        binder_type: null,
        capacity: 360,
        collection_count: 0,
        wishlist_count: 0,
        is_empty: true,
      },
    ])
    mockCreateBinder.mockResolvedValue({
      id: 20,
      name: 'Slot 2',
      created_at: '2026-06-21T00:00:00',
      binder_format: null,
      binder_color: null,
      binder_type: null,
      capacity: 180,
      collection_count: 0,
      is_empty: true,
    } as never)

    render(<CollectionCreateDialog open onOpenChange={() => {}} />)
    // The "New binder" option is offered alongside the existing binder.
    fireEvent.click(await screen.findByRole('radio', { name: /new binder/i }))
    fireEvent.change(screen.getByPlaceholderText('Base Set holos'), {
      target: { value: 'Base holos' },
    })
    fireEvent.change(screen.getByLabelText('New binder name'), {
      target: { value: 'Slot 2' },
    })
    fireEvent.change(screen.getByLabelText('New binder capacity (slots)'), {
      target: { value: '180' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreateBinder).toHaveBeenCalledWith('Slot 2', {
        binder_color: null,
        capacity: 180,
      }),
    )
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Base holos', { binder_id: 20 }))
  })

  it('creates a binder inline when none exist, then files the collection into it', async () => {
    mockCreateBinder.mockResolvedValue({
      id: 12,
      name: 'Slot 1',
      created_at: '2026-06-21T00:00:00',
      binder_format: null,
      binder_color: 'palm',
      binder_type: null,
      capacity: 360,
      collection_count: 0,
      is_empty: true,
    } as never)

    render(<CollectionCreateDialog open onOpenChange={() => {}} />)
    // No binders → the inline binder form is shown once the fetch settles.
    await waitFor(() => expect(screen.getByLabelText('New binder name')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Base Set holos'), {
      target: { value: 'Base holos' },
    })
    fireEvent.change(screen.getByLabelText('New binder name'), {
      target: { value: 'Slot 1' },
    })
    fireEvent.change(screen.getByLabelText('New binder capacity (slots)'), {
      target: { value: '360' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreateBinder).toHaveBeenCalledWith('Slot 1', {
        binder_color: null,
        capacity: 360,
      }),
    )
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Base holos', { binder_id: 12 }))
  })
})
