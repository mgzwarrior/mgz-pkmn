import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  fetchFavoritePokemon,
  pinFavoritePokemon,
  unpinFavoritePokemon,
  pokemonSpriteUrl,
} from '../api/client'
import { FavoritePokemonOnboarding } from './FavoritePokemonOnboarding'
import { _resetFavoritePokemonCacheForTests } from './useFavoritePokemon'

vi.mock('../api/client', () => ({
  fetchFavoritePokemon: vi.fn(),
  pinFavoritePokemon: vi.fn(),
  unpinFavoritePokemon: vi.fn(),
  pokemonSpriteUrl: vi.fn((n: number) => `https://sprite/${n}.png`),
}))

const mockFetch = vi.mocked(fetchFavoritePokemon)
const mockPin = vi.mocked(pinFavoritePokemon)
const mockUnpin = vi.mocked(unpinFavoritePokemon)

describe('FavoritePokemonOnboarding', () => {
  beforeEach(() => {
    _resetFavoritePokemonCacheForTests()
    mockFetch.mockReset().mockResolvedValue([])
    mockPin.mockReset().mockResolvedValue(undefined)
    mockUnpin.mockReset().mockResolvedValue(undefined)
    vi.mocked(pokemonSpriteUrl).mockClear()
  })

  it('renders nothing when closed', () => {
    render(<FavoritePokemonOnboarding open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Pick your favorite Pokémon')).not.toBeInTheDocument()
  })

  it('shows the survey with the crowd-favorites quick picks when open', () => {
    render(<FavoritePokemonOnboarding open onClose={vi.fn()} />)
    expect(screen.getByText('Pick your favorite Pokémon')).toBeInTheDocument()
    expect(screen.getByText('Crowd favorites')).toBeInTheDocument()
    // Pikachu (25) leads the curated quick-pick row.
    expect(screen.getByRole('button', { name: 'Add Pikachu to favorites' })).toBeInTheDocument()
  })

  it('pins a Pokémon when its tile is tapped', async () => {
    render(<FavoritePokemonOnboarding open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Pikachu to favorites' }))
    await waitFor(() => expect(mockPin).toHaveBeenCalledWith(25))
  })

  it('searches the baked Pokédex by name', () => {
    render(<FavoritePokemonOnboarding open onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search for a Pokémon' }), {
      target: { value: 'bulbasaur' },
    })
    expect(screen.getByRole('button', { name: 'Add Bulbasaur to favorites' })).toBeInTheDocument()
  })

  it('marks onboarding complete via onClose on both Done and Skip', () => {
    const onClose = vi.fn()
    render(<FavoritePokemonOnboarding open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
