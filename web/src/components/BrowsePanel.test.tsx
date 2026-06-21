import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowsePanel } from './BrowsePanel'
import { useBrowseController } from './useBrowseController'
import { useAppStore } from '../store'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import * as client from '../api/client'
import type { PokedexCard, SetCard } from '../types'

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

  it('set view: drills into a set, opens the detail modal, and shows the save buttons', async () => {
    const SET_CARDS: SetCard[] = [
      {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        supertype: 'Pokémon',
        subtypes: ['Stage 2'],
        thumb: 'https://img/base1-4.png',
        market: 250,
      },
    ]
    const fetchCards = vi
      .spyOn(client, 'fetchSetCards')
      .mockResolvedValue(SET_CARDS)

    render(<Harness />)

    // Default view is "By set"; the baked catalog renders the set tiles with
    // no round-trip. Drill into the first one (Base).
    const setTile = screen
      .getAllByRole('button')
      .find((b) => /\bcards$|count unknown/.test(b.textContent ?? ''))!
    fireEvent.click(setTile)

    await waitFor(() => expect(fetchCards).toHaveBeenCalled())
    expect(await screen.findByText('1 of 1 card')).toBeInTheDocument()

    // Signed-in, so each tile carries the collection + wishlist save pair.
    // Assert these before opening the modal — the dialog makes the grid inert.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /save to collection/i }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: /save to wishlist/i }),
    ).toBeInTheDocument()

    // A broken thumbnail falls back to the placeholder.
    fireEvent.error(screen.getByAltText('Charizard'))
    await waitFor(() =>
      expect(screen.queryByAltText('Charizard')).not.toBeInTheDocument(),
    )

    // The set-detail toolbar handlers (search / rarity bucket / sort) run;
    // Charizard (Rare Holo) survives all three filters.
    fireEvent.change(screen.getByLabelText('Search cards in this set'), {
      target: { value: 'char' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Holos' }))
    fireEvent.change(screen.getByLabelText('Sort cards'), {
      target: { value: 'price-desc' },
    })
    expect(screen.getByText('1 of 1 card')).toBeInTheDocument()

    // Clicking the card tile opens the same detail modal Search rows use.
    fireEvent.click(
      screen.getByRole('button', { name: /View details for Charizard/ }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('Charizard').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('$250.00')).toBeInTheDocument()

    // Escape closes the modal (onChangeIndex back to null)…
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )

    // …and the back control returns to the set list.
    fireEvent.click(screen.getByRole('button', { name: 'Back to set list' }))
    expect(screen.getByText('Browse sets')).toBeInTheDocument()
  })

  it('set view: filters by card category and badges the card in the modal (#700)', async () => {
    const SET_CARDS: SetCard[] = [
      {
        id: 'sv8-203',
        name: 'Latios',
        number: '203',
        rarity: 'Illustration Rare',
        supertype: 'Pokémon',
        subtypes: ['Basic'],
        thumb: null,
        market: 40,
      },
      {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        supertype: 'Pokémon',
        subtypes: ['Stage 2'],
        thumb: null,
        market: 250,
      },
    ]
    vi.spyOn(client, 'fetchSetCards').mockResolvedValue(SET_CARDS)

    render(<Harness />)

    const setTile = screen
      .getAllByRole('button')
      .find((b) => /\bcards$|count unknown/.test(b.textContent ?? ''))!
    fireEvent.click(setTile)

    expect(await screen.findByText('2 of 2 cards')).toBeInTheDocument()

    // Narrow to connecting-scene: only the seeded Latois (sv8-203) survives.
    fireEvent.change(screen.getByLabelText('Filter by card category'), {
      target: { value: 'connecting-scene' },
    })
    expect(await screen.findByText('1 of 2 cards')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /View details for Charizard/ }),
    ).not.toBeInTheDocument()

    // The detail modal badges every archetype, with a learn-more link for the
    // art-driven connecting-scene category.
    fireEvent.click(
      screen.getByRole('button', { name: /View details for Latios/ }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Connecting scene')).toBeInTheDocument()
    expect(within(dialog).getByText('Illustration rare')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('link', { name: /Connecting scene/ }),
    ).toHaveAttribute('href', expect.stringContaining('bulbapedia'))
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

  it('set view: creates a binder pre-anchored to the set you are walking (#682)', async () => {
    vi.spyOn(client, 'fetchSetCards').mockResolvedValue([])
    const create = vi.spyOn(client, 'createCollection').mockResolvedValue({
      id: 42,
      name: 'New binder',
      description: null,
      created_at: '2026-06-16T00:00:00',
      items: [],
      kind: 'binder',
    } as never)

    render(<Harness />)

    // Drill into the first baked set, then open the binder modal from the
    // contextual "Create binder" action.
    const setTile = screen
      .getAllByRole('button')
      .find((b) => /\bcards$|count unknown/.test(b.textContent ?? ''))!
    fireEvent.click(setTile)
    fireEvent.click(await screen.findByRole('button', { name: /create binder/i }))

    // The modal opens pre-seeded with the set's name, and the set anchor shows
    // that same name in the combobox (resolved from the ID).
    const dialog = await screen.findByRole('dialog')
    const setName = within(dialog).getByPlaceholderText<HTMLInputElement>('Trade binder').value
    expect(setName.length).toBeGreaterThan(0)
    expect(within(dialog).getByPlaceholderText(/search sets/i)).toHaveValue(setName)

    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    // Created as a physical binder anchored to the walked set's ID.
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        setName,
        expect.objectContaining({
          kind: 'binder',
          source_set_id: expect.stringMatching(/.+/),
        }),
      ),
    )
  })

  it('swaps a broken printing thumbnail for the placeholder', async () => {
    vi.spyOn(client, 'fetchPokedexCards').mockResolvedValue([
      { ...CHARIZARD_PRINTINGS[0], thumb: 'https://img/base1-4.png' },
    ])

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'By Pokédex #' }))
    fireEvent.change(screen.getByLabelText('Find a Pokémon'), {
      target: { value: 'charizard' },
    })
    fireEvent.click(await screen.findByText('Charizard'))

    const img = await screen.findByAltText('Charizard')
    fireEvent.error(img)
    await waitFor(() =>
      expect(screen.queryByAltText('Charizard')).not.toBeInTheDocument(),
    )
  })
})
