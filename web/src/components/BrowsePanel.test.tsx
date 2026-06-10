import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowsePanel } from './BrowsePanel'
import { useBrowseController } from './useBrowseController'
import { useAppStore } from '../store'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import * as client from '../api/client'
import type { PokedexCard } from '../types'

function Harness() {
  const controller = useBrowseController(true)
  return <BrowsePanel controller={controller} />
}

const CHARIZARD_PRINTINGS: PokedexCard[] = [
  {
    id: 'base1-4',
    name: 'Charizard',
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    thumb: null,
    market: 250,
    setId: 'base1',
    setName: 'Base',
    releaseDate: '1999/01/09',
  },
]

describe('BrowsePanel — pokedex view (#577)', () => {
  beforeEach(() => {
    useAppStore.setState({ inputText: '' })
    vi.restoreAllMocks()
    // The set-catalog revalidation fires on mount; keep it inert so the
    // baked catalog stays on screen and no real network is hit.
    vi.spyOn(client, 'fetchSets').mockResolvedValue([])
    vi.spyOn(client, 'fetchSetCards').mockResolvedValue([])
    // BrowsePanel now reads useAuth to gate the per-card save buttons, and
    // the buttons mount the collections / wishlists pickers. Default to a
    // signed-in user with empty lists so the save surface renders without
    // touching the network; reset the shared caches between tests.
    vi.spyOn(client, 'fetchMe').mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })
    vi.spyOn(client, 'fetchCollections').mockResolvedValue([])
    vi.spyOn(client, 'fetchWishlists').mockResolvedValue([])
    _resetAuthStoreForTests()
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
  })

  it('toggles to pokedex view and lists species from the national dex', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'By Pokédex #' }))

    expect(screen.getByText('Browse by Pokédex #')).toBeInTheDocument()
    // The baked national dex seeds the picker with zero round-trips.
    expect(await screen.findByText('Bulbasaur')).toBeInTheDocument()
    expect(screen.getByText('Generation I')).toBeInTheDocument()
    // Each species tile shows its standard sprite, derived from the dex #.
    const bulbasaurTile = screen.getByText('Bulbasaur').closest('button')!
    const sprite = bulbasaurTile.querySelector('img')
    expect(sprite?.getAttribute('src')).toContain('/pokemon/1.png')
  })

  it('filters the species list by name', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'By Pokédex #' }))

    fireEvent.change(screen.getByLabelText('Find a Pokémon'), {
      target: { value: 'charizard' },
    })

    expect(await screen.findByText('Charizard')).toBeInTheDocument()
    expect(screen.queryByText('Bulbasaur')).not.toBeInTheDocument()
  })

  it('drills into a species, fetches every printing, and opens the card detail modal', async () => {
    const fetchPokedex = vi
      .spyOn(client, 'fetchPokedexCards')
      .mockResolvedValue(CHARIZARD_PRINTINGS)

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'By Pokédex #' }))
    fireEvent.change(screen.getByLabelText('Find a Pokémon'), {
      target: { value: 'charizard' },
    })
    fireEvent.click(await screen.findByText('Charizard'))

    // Charizard is national dex #6 — the fetch keys off the number.
    await waitFor(() => expect(fetchPokedex).toHaveBeenCalledWith(6, undefined))

    // The printing renders its own set context (set name + year).
    expect(await screen.findByText('Base')).toBeInTheDocument()
    expect(screen.getByText('1 printing')).toBeInTheDocument()

    // Clicking the printing tile opens the same detail modal Search rows use.
    fireEvent.click(
      screen.getByRole('button', { name: /View details for Charizard from Base/ }),
    )
    const dialog = await screen.findByRole('dialog')
    // Name shows in both the title and the Identity row; the market price is
    // unique to the modal's pricing block.
    expect(within(dialog).getAllByText('Charizard').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('$250.00')).toBeInTheDocument()
  })

  it('shows the collection / wishlist save buttons on a printing when signed in', async () => {
    vi.spyOn(client, 'fetchPokedexCards').mockResolvedValue(CHARIZARD_PRINTINGS)

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'By Pokédex #' }))
    fireEvent.change(screen.getByLabelText('Find a Pokémon'), {
      target: { value: 'charizard' },
    })
    fireEvent.click(await screen.findByText('Charizard'))
    expect(await screen.findByText('Base')).toBeInTheDocument()

    // useAuth resolves async — wait for the per-card save buttons to mount.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /save to collection/i }),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByRole('button', { name: /save to wishlist/i }),
    ).toBeInTheDocument()
  })
})
