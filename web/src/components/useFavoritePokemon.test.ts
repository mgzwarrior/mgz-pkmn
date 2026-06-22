import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  fetchFavoritePokemon,
  pinFavoritePokemon,
  unpinFavoritePokemon,
} from '../api/client'
import {
  useFavoritePokemon,
  _resetFavoritePokemonCacheForTests,
} from './useFavoritePokemon'

vi.mock('../api/client', () => ({
  fetchFavoritePokemon: vi.fn(),
  pinFavoritePokemon: vi.fn(),
  unpinFavoritePokemon: vi.fn(),
}))

const mockFetch = vi.mocked(fetchFavoritePokemon)
const mockPin = vi.mocked(pinFavoritePokemon)
const mockUnpin = vi.mocked(unpinFavoritePokemon)

describe('useFavoritePokemon', () => {
  beforeEach(() => {
    _resetFavoritePokemonCacheForTests()
    mockFetch.mockReset().mockResolvedValue([])
    mockPin.mockReset().mockResolvedValue(undefined)
    mockUnpin.mockReset().mockResolvedValue(undefined)
  })

  it('loads pinned Pokémon on mount', async () => {
    mockFetch.mockResolvedValue([{ dex_number: 6, pinned_at: '2026-06-22T00:00:00Z' }])
    const { result } = renderHook(() => useFavoritePokemon())
    await waitFor(() => expect(result.current.favorites.length).toBe(1))
    expect(result.current.favorites[0].dex_number).toBe(6)
    expect(result.current.isFavorite(6)).toBe(true)
    expect(result.current.isFavorite(25)).toBe(false)
  })

  it('skips the fetch when disabled', async () => {
    renderHook(() => useFavoritePokemon({ enabled: false }))
    // Give any stray effect a tick; the per-user endpoint must stay untouched.
    await Promise.resolve()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('pins optimistically', async () => {
    const { result } = renderHook(() => useFavoritePokemon())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.pin(25)
    })
    expect(result.current.isFavorite(25)).toBe(true)
    expect(mockPin).toHaveBeenCalledWith(25)
  })

  it('rolls back a pin when the request fails', async () => {
    mockPin.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFavoritePokemon())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.pin(25)
    })
    expect(result.current.isFavorite(25)).toBe(false)
    expect(result.current.error).toBe('boom')
  })

  it('unpins a Pokémon', async () => {
    mockFetch.mockResolvedValue([{ dex_number: 6, pinned_at: '2026-06-22T00:00:00Z' }])
    const { result } = renderHook(() => useFavoritePokemon())
    await waitFor(() => expect(result.current.favorites.length).toBe(1))

    await act(async () => {
      await result.current.unpin(6)
    })
    expect(result.current.isFavorite(6)).toBe(false)
    expect(mockUnpin).toHaveBeenCalledWith(6)
  })
})
