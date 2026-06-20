import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BinderInventory } from './BinderInventory'
import { _resetBindersCacheForTests } from './useBinders'
import { fetchBinders, createBinder, deleteBinder } from '../api/client'

vi.mock('../api/client', () => ({
  fetchBinders: vi.fn(),
  createBinder: vi.fn(),
  deleteBinder: vi.fn(),
  updateBinder: vi.fn(),
}))

const mockFetch = vi.mocked(fetchBinders)
const mockCreate = vi.mocked(createBinder)
const mockDelete = vi.mocked(deleteBinder)

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
    mockFetch.mockReset()
    mockCreate.mockReset()
    mockDelete.mockReset()
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

  it('shows a collection count when the binder is filled', async () => {
    mockFetch.mockResolvedValue([
      binder({ is_empty: false, collection_count: 2, capacity: null, binder_format: null }),
    ] as never)
    render(<BinderInventory />)
    expect(await screen.findByText(/2 collections/i)).toBeInTheDocument()
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
