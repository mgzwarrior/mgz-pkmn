import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import {
  fetchFavoriteSets,
  fetchFavoriteSetSuggestions,
  pinFavoriteSet,
  unpinFavoriteSet,
} from '../api/client'
import { FavoriteSetsPanel } from './FavoriteSetsPanel'
import { _resetFavoriteSetsCacheForTests } from './useFavoriteSets'
import {
  useSwipeProfile,
  _resetSwipeProfileForTests,
} from './useSwipeProfile'
import type { SetCard } from '../types'

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

function card(setId: string): SetCard {
  return {
    id: `${setId}-1`,
    name: 'Card',
    number: '1',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    thumb: null,
    market: 1,
    dexNumbers: [],
  }
}

describe('FavoriteSetsPanel', () => {
  beforeEach(() => {
    _resetFavoriteSetsCacheForTests()
    _resetSwipeProfileForTests()
    mockFetch.mockReset().mockResolvedValue([])
    mockSuggestions.mockReset().mockResolvedValue([])
    mockPin.mockReset().mockResolvedValue(undefined)
    mockUnpin.mockReset().mockResolvedValue(undefined)
  })

  it('renders nothing when there is nothing pinned and nothing to suggest', async () => {
    const { container } = render(<FavoriteSetsPanel />)
    await waitFor(() => expect(mockSuggestions).toHaveBeenCalled())
    expect(container.querySelector('section')).toBeNull()
  })

  it('suggests an owned set with a reason and pins it on click', async () => {
    mockSuggestions.mockResolvedValue([{ set_id: 'base1', owned_count: 5 }])
    render(<FavoriteSetsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /favorite sets/i }))
    const suggestion = await screen.findByText('Base')
    expect(suggestion.parentElement).toHaveTextContent('5 owned')

    fireEvent.click(screen.getByRole('button', { name: /pin base/i }))
    await waitFor(() => expect(mockPin).toHaveBeenCalledWith('base1'))
    // Optimistically becomes a pinned chip with an unpin control.
    await screen.findByRole('button', { name: /unpin base/i })
  })

  it('merges the swipe lean into suggestions with a "loved in swipe" reason', async () => {
    // Seed a positive swipe lean on a set the server didn't surface.
    const { result } = renderHook(() => useSwipeProfile())
    act(() => {
      result.current.act(card('neo1'), 'neo1', 'love') // neo1 = +2
    })

    render(<FavoriteSetsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /favorite sets/i }))
    const neo = await screen.findByText('Neo Genesis')
    expect(neo.parentElement).toHaveTextContent('loved in swipe')
  })

  it('lists pinned sets and unpins on click', async () => {
    mockFetch.mockResolvedValue([
      { set_id: 'base1', pinned_at: '2026-06-20T00:00:00Z' },
    ])
    render(<FavoriteSetsPanel />)

    const region = await screen.findByRole('region', { name: /favorite sets/i })
    fireEvent.click(await screen.findByRole('button', { name: /favorite sets/i }))
    expect(within(region).getByText('Base')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /unpin base/i }))
    await waitFor(() => expect(mockUnpin).toHaveBeenCalledWith('base1'))
  })

  it('is collapsed by default, summarizing what is inside until expanded (#735)', async () => {
    mockFetch.mockResolvedValue([
      { set_id: 'base1', pinned_at: '2026-06-20T00:00:00Z' },
    ])
    render(<FavoriteSetsPanel />)

    const toggle = await screen.findByRole('button', { name: /favorite sets/i })
    // Collapsed: the header summarizes but the chip isn't rendered.
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')
    expect(toggle).toHaveTextContent('1 pinned')
    expect(screen.queryByText('Base')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'favorite-sets-body')
    expect(await screen.findByText('Base')).toBeInTheDocument()
  })

  it('caps suggestions to the top five (#735)', async () => {
    mockSuggestions.mockResolvedValue([
      { set_id: 'base1', owned_count: 10 },
      { set_id: 'base2', owned_count: 9 },
      { set_id: 'base3', owned_count: 8 },
      { set_id: 'base4', owned_count: 7 },
      { set_id: 'base5', owned_count: 6 },
      { set_id: 'base6', owned_count: 5 },
      { set_id: 'neo1', owned_count: 4 },
    ])
    render(<FavoriteSetsPanel />)

    const toggle = await screen.findByRole('button', { name: /favorite sets/i })
    expect(toggle).toHaveTextContent('5 suggested')
    fireEvent.click(toggle)

    const pins = await screen.findAllByRole('button', { name: /^pin /i })
    expect(pins).toHaveLength(5)
  })
})
