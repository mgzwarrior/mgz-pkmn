import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BinderModal } from './BinderModal'
import { _resetCollectionsCacheForTests } from './useCollections'
import { createCollection, updateCollection, fetchCollections } from '../api/client'
import type { CollectionSummary } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  addCardToCollection: vi.fn(),
  bulkAddToCollection: vi.fn(),
  deleteCollection: vi.fn(),
}))

const mockCreate = vi.mocked(createCollection)
const mockUpdate = vi.mocked(updateCollection)
const mockFetch = vi.mocked(fetchCollections)

describe('BinderModal', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    mockCreate.mockReset()
    mockUpdate.mockReset()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue([])
  })

  it('creates a binder with cover color, format, and capacity', async () => {
    mockCreate.mockResolvedValue({
      id: 5,
      name: 'Trade binder',
      description: null,
      created_at: '2026-06-15T00:00:00',
      items: [],
      kind: 'binder',
      binder_color: 'sky',
      binder_format: '9-pocket',
      capacity: 360,
    })
    render(<BinderModal open onOpenChange={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('Trade binder'), {
      target: { value: 'Trade binder' },
    })
    // Default cover color is palm; switch to sky.
    fireEvent.click(screen.getByRole('button', { name: 'Sky' }))
    fireEvent.click(screen.getByRole('button', { name: /more binder details/i }))
    fireEvent.change(screen.getByPlaceholderText('360'), { target: { value: '360' } })
    // The pocket-format select is the only combobox in the details panel.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '9-pocket' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('Trade binder', {
        kind: 'binder',
        binder_format: '9-pocket',
        binder_color: 'sky',
        capacity: 360,
        source_set_id: null,
        is_master_set: false,
      }),
    )
  })

  it('prefills and PATCHes an existing binder', async () => {
    const binder: CollectionSummary = {
      id: 7,
      name: 'Show binder',
      description: null,
      created_at: '2026-06-10T00:00:00',
      item_count: 12,
      kind: 'binder',
      source_set_id: null,
      rule: null,
      binder_color: 'palm',
      binder_format: '9-pocket',
      capacity: 180,
      is_master_set: false,
    }
    mockUpdate.mockResolvedValue({
      ...binder,
      items: [],
      binder_color: 'ember',
    } as never)
    render(<BinderModal open onOpenChange={() => {}} editing={binder} />)

    // Name is prefilled from the binder being edited.
    expect(screen.getByDisplayValue('Show binder')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ember' }))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ name: 'Show binder', binder_color: 'ember' }),
      ),
    )
  })
})
