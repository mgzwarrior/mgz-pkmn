import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BinderInventory } from './BinderInventory'
import { _resetBindersCacheForTests } from './useBinders'
import { _resetCollectionsCacheForTests } from './useCollections'
import {
  fetchBinders,
  createBinder,
  deleteBinder,
  fetchCollections,
  createCollection,
} from '../api/client'

vi.mock('../api/client', () => ({
  fetchBinders: vi.fn(),
  createBinder: vi.fn(),
  deleteBinder: vi.fn(),
  updateBinder: vi.fn(),
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  addCardToCollection: vi.fn(),
}))

const mockFetch = vi.mocked(fetchBinders)
const mockCreate = vi.mocked(createBinder)
const mockDelete = vi.mocked(deleteBinder)
const mockCollections = vi.mocked(fetchCollections)
const mockCreateCollection = vi.mocked(createCollection)

/** A filed collection summary (only the fields BinderInventory reads). */
function filed(id: number, name: string, binderId: number) {
  return {
    id,
    name,
    description: null,
    created_at: '2026-06-20T00:00:00Z',
    item_count: 0,
    kind: 'manual' as const,
    binder_id: binderId,
  }
}

function binder(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Base Set binder',
    created_at: '2026-06-20T00:00:00Z',
    binder_format: '9-pocket',
    binder_color: 'palm',
    binder_type: null,
    capacity: 360,
    collection_count: 0,
    is_empty: true,
    ...over,
  }
}

describe('BinderInventory', () => {
  beforeEach(() => {
    _resetBindersCacheForTests()
    _resetCollectionsCacheForTests()
    mockFetch.mockReset()
    mockCreate.mockReset()
    mockDelete.mockReset()
    mockCollections.mockReset()
    mockCollections.mockResolvedValue([])
    mockCreateCollection.mockReset()
  })

  it('shows the empty state when there are no binders', async () => {
    mockFetch.mockResolvedValue([])
    render(<BinderInventory />)
    expect(await screen.findByText(/Add an empty binder to your inventory/i)).toBeInTheDocument()
  })

  it('lists binders with an Empty label and capacity meta', async () => {
    mockFetch.mockResolvedValue([binder()] as never)
    render(<BinderInventory />)
    expect(await screen.findByText('Base Set binder')).toBeInTheDocument()
    expect(screen.getByText(/Empty · 9-pocket · 360 slots/i)).toBeInTheDocument()
  })

  it('shows the filed collections and a live count under a binder', async () => {
    mockFetch.mockResolvedValue([
      binder({ id: 1, is_empty: false, collection_count: 2, capacity: null, binder_format: null }),
    ] as never)
    mockCollections.mockResolvedValue([
      filed(10, 'Base holos', 1),
      filed(11, 'Trainers', 1),
    ] as never)
    render(<BinderInventory />)
    expect(await screen.findByText(/2 collections/i)).toBeInTheDocument()
    expect(screen.getByText('Base holos')).toBeInTheDocument()
    expect(screen.getByText('Trainers')).toBeInTheDocument()
  })

  it('files a new collection straight into a binder', async () => {
    mockFetch.mockResolvedValue([binder({ id: 3, name: 'Show binder' })] as never)
    mockCreateCollection.mockResolvedValue({
      id: 20,
      name: 'Holos',
      description: null,
      created_at: '2026-06-20T00:00:00Z',
      items: [],
      kind: 'manual',
      binder_id: 3,
    } as never)
    render(<BinderInventory />)
    await screen.findByText('Show binder')

    fireEvent.click(screen.getByRole('button', { name: /Add a collection to Show binder/i }))
    fireEvent.change(screen.getByPlaceholderText('Base Set holos'), {
      target: { value: 'Holos' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))

    await waitFor(() =>
      expect(mockCreateCollection).toHaveBeenCalledWith('Holos', { binder_id: 3 }),
    )
  })

  it('creates an empty binder', async () => {
    mockFetch.mockResolvedValue([])
    mockCreate.mockResolvedValue(
      binder({ id: 5, name: 'Jungle', capacity: null, binder_format: null }) as never,
    )
    render(<BinderInventory />)
    await screen.findByText(/Add an empty binder/i)

    fireEvent.click(screen.getByRole('button', { name: /Add binder/i }))
    fireEvent.change(screen.getByLabelText(/Binder name/i), { target: { value: 'Jungle' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Jungle', expect.any(Object)))
    expect(await screen.findByText('Jungle')).toBeInTheDocument()
  })

  it('creates a binder with the chosen cover color', async () => {
    mockFetch.mockResolvedValue([])
    mockCreate.mockResolvedValue(
      binder({ id: 5, name: 'Sun binder', capacity: null, binder_format: null, binder_color: 'sun' }) as never,
    )
    render(<BinderInventory />)
    await screen.findByText(/Add an empty binder/i)

    fireEvent.click(screen.getByRole('button', { name: /Add binder/i }))
    fireEvent.change(screen.getByLabelText(/Binder name/i), { target: { value: 'Sun binder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sun' }))
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'Sun binder',
        expect.objectContaining({ binder_color: 'sun' }),
      ),
    )
  })

  it('creates a binder with the chosen storage type (#726)', async () => {
    mockFetch.mockResolvedValue([])
    mockCreate.mockResolvedValue(
      binder({ id: 6, name: 'Slabs', capacity: null, binder_format: null, binder_type: 'graded' }) as never,
    )
    render(<BinderInventory />)
    await screen.findByText(/Add an empty binder/i)

    fireEvent.click(screen.getByRole('button', { name: /Add binder/i }))
    fireEvent.change(screen.getByLabelText(/Binder name/i), { target: { value: 'Slabs' } })
    fireEvent.change(screen.getByLabelText(/Storage type/i), { target: { value: 'graded' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'Slabs',
        expect.objectContaining({ binder_type: 'graded' }),
      ),
    )
  })

  it('deletes a binder after confirmation', async () => {
    mockFetch.mockResolvedValue([binder({ id: 9, name: 'Old binder' })] as never)
    mockDelete.mockResolvedValue(undefined)
    render(<BinderInventory />)
    await screen.findByText('Old binder')

    fireEvent.click(screen.getByRole('button', { name: /Delete Old binder/i }))
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete Old binder/i }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(9))
  })
})
