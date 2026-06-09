import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowsePanel } from './BrowsePanel'
import { useBrowseController } from './useBrowseController'
import { useAppStore } from '../store'
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
  })

  it('toggles to pokedex view and lists species from the national dex', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'By Pokédex #' }))

    expect(screen.getByText('Browse by Pokédex #')).toBeInTheDocument()
    // The baked national dex seeds the picker with zero round-trips.
    expect(await screen.findByText('Bulbasaur')).toBeInTheDocument()
    expect(screen.getByText('Generation I')).toBeInTheDocument()
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

  it('drills into a species, fetches every printing, and adds one to the list', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Add Charizard from Base to list/ }))

    expect(useAppStore.getState().inputText).toContain('Charizard | Base | 4')
  })
})
