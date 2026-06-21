import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  fetchFavoriteSets,
  fetchFavoriteSetSuggestions,
  pinFavoriteSet,
  unpinFavoriteSet,
} from '../api/client'
import {
  useFavoriteSets,
  _resetFavoriteSetsCacheForTests,
} from './useFavoriteSets'

vi.mock('../api/client', () => ({
  fetchFavoriteSets: vi.fn(),
  fetchFavoriteSetSuggestions: vi.fn(),
  pinFavoriteSet: vi.fn(),
  unpinFavoriteSet: vi.fn(),
}))

const mockFetch = vi.mocked(fetchFavoriteSets)
const mockSuggestions = vi.mocked(fetchFavoriteSetSuggestions)
const mockPin = vi.mocked(pinFavoriteSet)
const mockUnpin = vi.mocked(unpinFavoriteSet)

describe('useFavoriteSets', () => {
  beforeEach(() => {
    _resetFavoriteSetsCacheForTests()
    mockFetch.mockReset().mockResolvedValue([])
    mockSuggestions.mockReset().mockResolvedValue([])
    mockPin.mockReset().mockResolvedValue(undefined)
    mockUnpin.mockReset().mockResolvedValue(undefined)
  })

  it('loads pins and suggestions on mount', async () => {
    mockFetch.mockResolvedValue([{ set_id: 'base1', pinned_at: '2026-06-20T00:00:00Z' }])
    mockSuggestions.mockResolvedValue([{ set_id: 'sv4pt5', owned_count: 9 }])
    const { result } = renderHook(() => useFavoriteSets())
    await waitFor(() => expect(result.current.favorites.length).toBe(1))
    expect(result.current.favorites[0].set_id).toBe('base1')
    expect(result.current.suggestions[0]).toEqual({ set_id: 'sv4pt5', owned_count: 9 })
    expect(result.current.isPinned('base1')).toBe(true)
  })

  it('pins optimistically and drops the set from suggestions', async () => {
    mockSuggestions.mockResolvedValue([{ set_id: 'neo1', owned_count: 4 }])
    const { result } = renderHook(() => useFavoriteSets())
    await waitFor(() => expect(result.current.suggestions.length).toBe(1))

    await act(async () => {
      await result.current.pin('neo1')
    })
    expect(result.current.isPinned('neo1')).toBe(true)
    expect(result.current.suggestions.some((s) => s.set_id === 'neo1')).toBe(false)
    expect(mockPin).toHaveBeenCalledWith('neo1')
  })

  it('rolls back a pin — and restores the suggestion — when the request fails', async () => {
    mockSuggestions.mockResolvedValue([{ set_id: 'base1', owned_count: 3 }])
    mockPin.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFavoriteSets())
    await waitFor(() => expect(result.current.suggestions.length).toBe(1))

    await act(async () => {
      await result.current.pin('base1')
    })
    expect(result.current.isPinned('base1')).toBe(false)
    expect(result.current.error).toBe('boom')
    // The set returns to the suggestion list so the user can retry.
    expect(result.current.suggestions.some((s) => s.set_id === 'base1')).toBe(true)
  })

  it('unpins a set', async () => {
    mockFetch.mockResolvedValue([{ set_id: 'base1', pinned_at: '2026-06-20T00:00:00Z' }])
    const { result } = renderHook(() => useFavoriteSets())
    await waitFor(() => expect(result.current.favorites.length).toBe(1))

    await act(async () => {
      await result.current.unpin('base1')
    })
    expect(result.current.isPinned('base1')).toBe(false)
    expect(mockUnpin).toHaveBeenCalledWith('base1')
  })
})
