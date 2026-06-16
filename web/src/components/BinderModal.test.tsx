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
      binder_type: 'toploader',
      capacity: 360,
    })
    render(<BinderModal open onOpenChange={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('Trade binder'), {
      target: { value: 'Trade binder' },
    })
    // Default cover color is palm; switch to sky.
    fireEvent.click(screen.getByRole('button', { name: 'Sky' }))
    fireEvent.click(screen.getByRole('button', { name: /more details/i }))
    fireEvent.change(screen.getByPlaceholderText('360'), { target: { value: '360' } })
    fireEvent.change(screen.getByRole('combobox', { name: /storage type/i }), {
      target: { value: 'toploader' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: /pocket format/i }), {
      target: { value: '9-pocket' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('Trade binder', {
        kind: 'binder',
        binder_format: '9-pocket',
        binder_color: 'sky',
        binder_type: 'toploader',
        capacity: 360,
        source_set_id: null,
        is_master_set: false,
      }),
    )
  })

  it('creates a smart binder carrying shared identity but no physical fields', async () => {
    mockCreate.mockResolvedValue({
      id: 6,
      name: 'All Eevees',
      description: null,
      created_at: '2026-06-15T00:00:00',
      items: [],
      kind: 'dynamic',
      rule: { name: 'Eevee' },
      binder_color: 'ember',
    })
    render(<BinderModal open onOpenChange={() => {}} />)

    fireEvent.click(screen.getByRole('radio', { name: /smart binder/i }))
    fireEvent.change(screen.getByPlaceholderText('All Eevees'), {
      target: { value: 'All Eevees' },
    })
    fireEvent.change(screen.getByPlaceholderText('Eevee'), { target: { value: 'Eevee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ember' }))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    const [, opts] = mockCreate.mock.calls[0]
    expect(opts).toMatchObject({ kind: 'dynamic', binder_color: 'ember', dynamic_scope: 'owned' })
    // A smart binder has no fixed slots — physical fields aren't sent.
    expect(opts).not.toHaveProperty('binder_format')
    expect(opts).not.toHaveProperty('capacity')
  })

  it('lets you save identity edits to an existing smart binder without a rule', async () => {
    const smart: CollectionSummary = {
      id: 8,
      name: 'All Eevees',
      description: null,
      created_at: '2026-06-10T00:00:00',
      item_count: 5,
      kind: 'dynamic',
      source_set_id: null,
      rule: { name: 'eevee' },
      dynamic_scope: 'owned',
      binder_color: 'palm',
    }
    mockUpdate.mockResolvedValue({ ...smart, items: [], binder_color: 'sky' } as never)
    render(<BinderModal open onOpenChange={() => {}} editing={smart} />)

    // Save is enabled immediately — no throwaway rule value required.
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Sky' }))
    fireEvent.click(save)

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        8,
        expect.objectContaining({ name: 'All Eevees', binder_color: 'sky' }),
      ),
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
