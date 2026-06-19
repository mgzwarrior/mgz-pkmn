import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  fetchSwipeExcluded,
  recordSwipeSeen,
  resetSwipeSeen,
} from '../api/client'
import { exclusionKey, useSwipeExclusions } from './useSwipeExclusions'

vi.mock('../api/client', () => ({
  fetchSwipeExcluded: vi.fn(),
  recordSwipeSeen: vi.fn(),
  resetSwipeSeen: vi.fn(),
}))

const mockFetch = vi.mocked(fetchSwipeExcluded)
const mockRecord = vi.mocked(recordSwipeSeen)
const mockReset = vi.mocked(resetSwipeSeen)

describe('exclusionKey', () => {
  it('colon-joins set id and number so segments cannot run together', () => {
    expect(exclusionKey('sv1', '1')).toBe('sv1::1')
    // A hyphen in the number can't be confused with the card-id form.
    expect(exclusionKey('swsh12tg', 'TG01')).toBe('swsh12tg::TG01')
  })
})

describe('useSwipeExclusions', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue([])
    mockRecord.mockReset()
    mockRecord.mockResolvedValue(undefined)
    mockReset.mockReset()
    mockReset.mockResolvedValue(undefined)
  })

  it('loads the persisted exclusion set on mount', async () => {
    mockFetch.mockResolvedValue([
      { set_id: 'sv1', number: '1' },
      { set_id: 'base1', number: '4' },
    ])
    const { result } = renderHook(() =>
      useSwipeExclusions({ excludeOwned: false, excludeChasing: false }),
    )
    await waitFor(() => expect(result.current.excludedKeys.size).toBe(2))
    expect(result.current.excludedKeys.has('sv1::1')).toBe(true)
    expect(result.current.excludedKeys.has('base1::4')).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith({ owned: false, chasing: false })
  })

  it('refetches with the owned / chasing flags when toggles change', async () => {
    const { rerender } = renderHook(
      ({ owned, chasing }) =>
        useSwipeExclusions({ excludeOwned: owned, excludeChasing: chasing }),
      { initialProps: { owned: false, chasing: false } },
    )
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith({ owned: false, chasing: false }),
    )
    rerender({ owned: true, chasing: true })
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith({ owned: true, chasing: true }),
    )
  })

  it('optimistically excludes a recorded card and persists it', async () => {
    const { result } = renderHook(() =>
      useSwipeExclusions({ excludeOwned: false, excludeChasing: false }),
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())

    act(() => {
      result.current.recordSeen('sv1', '7', 'save')
    })
    expect(result.current.excludedKeys.has('sv1::7')).toBe(true)
    expect(mockRecord).toHaveBeenCalledWith('sv1', '7', 'save')
  })

  it('resetDeck clears the keys and calls the server', async () => {
    mockFetch.mockResolvedValue([{ set_id: 'sv1', number: '1' }])
    const { result } = renderHook(() =>
      useSwipeExclusions({ excludeOwned: false, excludeChasing: false }),
    )
    await waitFor(() => expect(result.current.excludedKeys.size).toBe(1))

    act(() => {
      result.current.resetDeck()
    })
    expect(result.current.excludedKeys.size).toBe(0)
    expect(mockReset).toHaveBeenCalled()
  })

  it('falls back to an empty set when the endpoint is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('401'))
    const { result } = renderHook(() =>
      useSwipeExclusions({ excludeOwned: false, excludeChasing: false }),
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    // No throw, deck still works with an empty exclusion set.
    expect(result.current.excludedKeys.size).toBe(0)
  })
})
