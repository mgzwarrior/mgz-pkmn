import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { fetchCardOwnership, type CardOwnership } from '../api/client'
import {
  ownershipKey,
  useCardOwnership,
  invalidateOwnership,
  _resetCardOwnershipForTests,
} from './useCardOwnership'

vi.mock('../api/client', () => ({
  fetchCardOwnership: vi.fn(),
}))

const mockFetch = vi.mocked(fetchCardOwnership)

const OWNED: CardOwnership = {
  collections: [{ id: 1, name: 'Show Binder', quantity: 2, purpose: 'personal' }],
  wishlists: [],
}

describe('ownershipKey', () => {
  it('colon-joins set id and number', () => {
    expect(ownershipKey('base1', '4')).toBe('base1::4')
  })
})

describe('useCardOwnership', () => {
  beforeEach(() => {
    _resetCardOwnershipForTests()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({})
  })

  it('returns undefined until fetched, then the occupancy', async () => {
    mockFetch.mockResolvedValue({ 'base1::4': OWNED })
    const { result } = renderHook(() =>
      useCardOwnership([{ setId: 'base1', number: '4' }]),
    )
    // First render: not yet known.
    expect(result.current.lookup('base1', '4')).toBeUndefined()
    await waitFor(() =>
      expect(result.current.lookup('base1', '4')).toEqual(OWNED),
    )
  })

  it('marks an unowned card null (fetched, no occupancy)', async () => {
    mockFetch.mockResolvedValue({}) // sparse: absent = not owned
    const { result } = renderHook(() =>
      useCardOwnership([{ setId: 'base1', number: '99' }]),
    )
    await waitFor(() =>
      expect(result.current.lookup('base1', '99')).toBeNull(),
    )
  })

  it('batches and dedupes — one fetch for a repeated identity', async () => {
    mockFetch.mockResolvedValue({ 'base1::4': OWNED })
    const ids = [{ setId: 'base1', number: '4' }]
    const { rerender } = renderHook((p: typeof ids) => useCardOwnership(p), {
      initialProps: ids,
    })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    // Re-render with the same identity → cache hit, no second fetch.
    rerender([{ setId: 'base1', number: '4' }])
    rerender([{ setId: 'base1', number: '4' }])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('refetches after invalidateOwnership', async () => {
    mockFetch.mockResolvedValue({ 'base1::4': OWNED })
    const { result } = renderHook(() =>
      useCardOwnership([{ setId: 'base1', number: '4' }]),
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    invalidateOwnership()
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(result.current.lookup('base1', '4')).toEqual(OWNED)
  })

  it('degrades to null when the fetch fails (anonymous / offline)', async () => {
    mockFetch.mockRejectedValue(new Error('401'))
    const { result } = renderHook(() =>
      useCardOwnership([{ setId: 'base1', number: '4' }]),
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(result.current.lookup('base1', '4')).toBeNull()
  })

  it('does not fetch for an empty identity list', () => {
    renderHook(() => useCardOwnership([]))
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
