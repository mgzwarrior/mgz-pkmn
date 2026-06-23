import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BinderModal } from './BinderModal'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetBindersCacheForTests } from './useBinders'
import {
  createCollection,
  updateCollection,
  fetchCollections,
  fetchBinders,
  createBinder,
} from '../api/client'
import type { BinderSummary, CollectionSummary } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  addCardToCollection: vi.fn(),
  bulkAddToCollection: vi.fn(),
  deleteCollection: vi.fn(),
  fetchBinders: vi.fn(),
  createBinder: vi.fn(),
}))

const mockCreate = vi.mocked(createCollection)
const mockUpdate = vi.mocked(updateCollection)
const mockFetch = vi.mocked(fetchCollections)
const mockFetchBinders = vi.mocked(fetchBinders)
const mockCreateBinder = vi.mocked(createBinder)

function binder(over: Partial<BinderSummary> = {}): BinderSummary {
  return {
    id: 3,
    name: 'Show binder',
    created_at: '2026-06-15T00:00:00',
    binder_format: null,
    binder_color: null,
    binder_type: null,
    capacity: 360,
    collection_count: 0,
    is_empty: true,
    ...over,
  }
}

describe('BinderModal', () => {
  beforeEach(() => {
    _resetCollectionsCacheForTests()
    _resetBindersCacheForTests()
    mockCreate.mockReset()
    mockUpdate.mockReset()
    mockFetch.mockReset()
    mockFetchBinders.mockReset()
    mockCreateBinder.mockReset()
    mockFetch.mockResolvedValue([])
    mockFetchBinders.mockResolvedValue([])
  })

  it('creates a binder with format and capacity (no cover color / storage type — those live on the binder unit)', async () => {
    mockCreate.mockResolvedValue({
      id: 5,
      name: 'Trade binder',
      description: null,
      created_at: '2026-06-15T00:00:00',
      items: [],
      kind: 'binder',
      binder_format: '9-pocket',
      capacity: 360,
    })
    render(<BinderModal open onOpenChange={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('Trade binder'), {
      target: { value: 'Trade binder' },
    })
    // The cover-color picker (#723) and storage-type select (#726) no longer
    // live here — they belong to the binder inventory unit.
    expect(screen.queryByRole('button', { name: 'Sky' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /more details/i }))
    expect(screen.queryByRole('combobox', { name: /storage type/i })).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('360'), { target: { value: '360' } })
    fireEvent.change(screen.getByRole('combobox', { name: /pocket format/i }), {
      target: { value: '9-pocket' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('Trade binder', {
        kind: 'binder',
        binder_format: '9-pocket',
        capacity: 360,
        source_set_id: null,
        is_master_set: false,
      }),
    )
    // Cover color and storage type aren't part of the create payload anymore.
    const [, opts] = mockCreate.mock.calls[0]
    expect(opts).not.toHaveProperty('binder_color')
    expect(opts).not.toHaveProperty('binder_type')
  })

  it('creates a smart collection carrying shared identity but no physical fields or color', async () => {
    mockCreate.mockResolvedValue({
      id: 6,
      name: 'All Eevees',
      description: null,
      created_at: '2026-06-15T00:00:00',
      items: [],
      kind: 'dynamic',
      rule: { name: 'Eevee' },
    })
    render(<BinderModal open onOpenChange={() => {}} />)

    fireEvent.click(screen.getByRole('radio', { name: /smart collection/i }))
    fireEvent.change(screen.getByPlaceholderText('All Eevees'), {
      target: { value: 'All Eevees' },
    })
    fireEvent.change(screen.getByPlaceholderText('Eevee'), { target: { value: 'Eevee' } })
    // Wait for the binder-file picker to settle (no binders here) before submit.
    await screen.findByText(/No binders yet/i)
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    const [, opts] = mockCreate.mock.calls[0]
    expect(opts).toMatchObject({ kind: 'dynamic', dynamic_scope: 'owned' })
    // A smart collection has no fixed slots and no cover color.
    expect(opts).not.toHaveProperty('binder_format')
    expect(opts).not.toHaveProperty('capacity')
    expect(opts).not.toHaveProperty('binder_color')
  })

  it('files a new smart collection into a chosen binder (#726)', async () => {
    mockFetchBinders.mockResolvedValue([binder({ id: 3, name: 'Show binder' })])
    mockCreate.mockResolvedValue({
      id: 10,
      name: 'All Eevees',
      description: null,
      created_at: '2026-06-15T00:00:00',
      items: [],
      kind: 'dynamic',
      rule: { name: 'Eevee' },
    } as never)
    render(<BinderModal open onOpenChange={() => {}} />)

    fireEvent.click(screen.getByRole('radio', { name: /smart collection/i }))
    fireEvent.change(screen.getByPlaceholderText('All Eevees'), {
      target: { value: 'All Eevees' },
    })
    fireEvent.change(screen.getByPlaceholderText('Eevee'), { target: { value: 'Eevee' } })

    // The shared binder-file picker lists existing binders; pick one.
    fireEvent.click(await screen.findByRole('radio', { name: /Show binder/i }))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'All Eevees',
        expect.objectContaining({ kind: 'dynamic', binder_id: 3 }),
      ),
    )
  })

  it('lets you save identity edits to an existing smart collection without a rule', async () => {
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
    }
    mockUpdate.mockResolvedValue({ ...smart, items: [] } as never)
    render(<BinderModal open onOpenChange={() => {}} editing={smart} />)

    // Save is enabled immediately — no throwaway rule value required.
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        8,
        expect.objectContaining({ name: 'All Eevees', binder_type: null }),
      ),
    )
    // The edit clears legacy collection storage type while leaving cover color
    // on the binder inventory unit.
    const [, patch] = mockUpdate.mock.calls[0]
    expect(patch).not.toHaveProperty('binder_color')
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
      binder_format: '9-pocket',
      capacity: 180,
      is_master_set: false,
    }
    mockUpdate.mockResolvedValue({
      ...binder,
      items: [],
    } as never)
    render(<BinderModal open onOpenChange={() => {}} editing={binder} />)

    // Name is prefilled from the binder being edited.
    expect(screen.getByDisplayValue('Show binder')).toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('Show binder'), {
      target: { value: 'Show binder 2' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ name: 'Show binder 2', binder_type: null }),
      ),
    )
  })

  it('seeds a fresh binder from a prefill (e.g. opened from Browse)', async () => {
    mockCreate.mockResolvedValue({
      id: 9,
      name: 'Jungle binder',
      description: null,
      created_at: '2026-06-15T00:00:00',
      items: [],
      kind: 'binder',
      source_set_id: 'base2',
    } as never)
    render(
      <BinderModal
        open
        onOpenChange={() => {}}
        prefill={{ name: 'Jungle binder', sourceSetId: 'base2' }}
      />,
    )

    // Name + set anchor arrive prefilled, and the details are auto-expanded so
    // the set shows its name ('Jungle' for base2) rather than the bare ID.
    expect(screen.getByDisplayValue('Jungle binder')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Jungle')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'Jungle binder',
        expect.objectContaining({ kind: 'binder', source_set_id: 'base2' }),
      ),
    )
  })
})
