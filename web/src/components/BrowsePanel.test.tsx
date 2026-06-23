import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowsePanel } from './BrowsePanel'
import { useBrowseController } from './useBrowseController'
import { useAppStore } from '../store'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { _resetFavoritePokemonCacheForTests } from './useFavoritePokemon'
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
    dexNumbers: [6],
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
    // Favorite-Pokémon star toggles (#742) read the per-user pin list; keep it
    // empty + inert so the stars render unfilled without a real request.
    vi.spyOn(client, 'fetchFavoritePokemon').mockResolvedValue([])
    vi.spyOn(client, 'pinFavoritePokemon').mockResolvedValue(undefined)
    vi.spyOn(client, 'unpinFavoritePokemon').mockResolvedValue(undefined)
    _resetAuthStoreForTests()
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    _resetFavoritePokemonCacheForTests()
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

  it('favorites a species from its pokedex tile (#742)', async () => {
    const pin = vi.spyOn(client, 'pinFavoritePokemon').mockResolvedValue(undefined)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'By Pokédex #' }))
    // Filter to a single species first so the grid renders one tile, not the
    // whole 1025-entry dex — the star click re-renders the list, and re-running
    // that over every tile blows the test timeout under CI contention.
    fireEvent.change(screen.getByLabelText('Find a Pokémon'), {
      target: { value: 'bulbasaur' },
    })

    // Bulbasaur is national dex #1 — its star toggle pins that number.
    const star = await screen.findByRole('button', { name: 'Add Bulbasaur to favorites' })
    fireEvent.click(star)
    await waitFor(() => expect(pin).toHaveBeenCalledWith(1))
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
        dexNumbers: [6],
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

    // Signed-in, so each tile carries the one-tap want / own quick actions.
    // Assert these before opening the modal — the dialog makes the grid inert.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^want$/i })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /^own$/i })).toBeInTheDocument()

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
        dexNumbers: [380],
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
        dexNumbers: [6],
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

  it('shows the one-tap want / own quick actions on a printing when signed in (#761)', async () => {
    vi.spyOn(client, 'fetchPokedexCards').mockResolvedValue(CHARIZARD_PRINTINGS)

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'By Pokédex #' }))
    fireEvent.change(screen.getByLabelText('Find a Pokémon'), {
      target: { value: 'charizard' },
    })
    fireEvent.click(await screen.findByText('Charizard'))
    expect(await screen.findByText('Base')).toBeInTheDocument()

    // useAuth resolves async — wait for the per-card quick actions to mount.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^want$/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /^own$/i })).toBeInTheDocument()
  })

  // A single set card to seed a create from, returned by fetchSetCards once
  // we drill into a set. Shape matches SetCard.
  const SEED_SET_CARD = {
    id: 'base1-4',
    name: 'Charizard',
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    thumb: null,
    market: 250,
    dexNumbers: [6],
  }

  // Drill into the first baked set and open one kind from the New ▾ menu.
  // Radix opens on the keyboard activation path, which is reliable under jsdom.
  async function openSetCreate(kind: RegExp) {
    const setTile = screen
      .getAllByRole('button')
      .find((b) => /\bcards$|count unknown/.test(b.textContent ?? ''))!
    fireEvent.click(setTile)
    // Wait for the set's cards to land so the create is seeded from them.
    await screen.findByText('Charizard')
    const newTrigger = await screen.findByRole('button', { name: /^new$/i })
    newTrigger.focus()
    fireEvent.keyDown(newTrigger, { key: 'Enter', code: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: kind }))
  }

  it('set view: New ▾ creates an owned collection seeded from the set (#737)', async () => {
    vi.spyOn(client, 'fetchSetCards').mockResolvedValue([SEED_SET_CARD] as never)
    vi.spyOn(client, 'fetchBinders').mockResolvedValue([])
    const create = vi.spyOn(client, 'createCollection').mockResolvedValue({
      id: 42,
      name: 'Base',
      description: null,
      created_at: '2026-06-16T00:00:00',
      items: [],
      kind: 'manual',
    } as never)
    const bulkAdd = vi
      .spyOn(client, 'bulkAddToCollection')
      .mockResolvedValue({ added: [], skipped: [] } as never)

    render(<Harness />)
    await openSetCreate(/^collection/i)

    // The collection dialog opens pre-seeded with the set's name; create it.
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByPlaceholderText<HTMLInputElement>('Base Set holos').value
    expect(name.length).toBeGreaterThan(0)
    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    // Lands as an owned collection (not a physical binder), then the set's
    // cards are dropped in via the browse bulk-add path.
    await waitFor(() => expect(create).toHaveBeenCalledWith(name, undefined))
    await waitFor(() =>
      expect(bulkAdd).toHaveBeenCalledWith(
        42,
        expect.arrayContaining([expect.objectContaining({ id: 'base1-4' })]),
        { addedVia: 'browse' },
      ),
    )
  })

  it('set view: New ▾ creates a chasing want-list seeded from the set (#737)', async () => {
    vi.spyOn(client, 'fetchSetCards').mockResolvedValue([SEED_SET_CARD] as never)
    const create = vi.spyOn(client, 'createWishlist').mockResolvedValue({
      id: 9,
      name: 'Base',
      description: null,
      created_at: '2026-06-16T00:00:00',
      items: [],
    } as never)
    const bulkAdd = vi
      .spyOn(client, 'bulkAddToWishlist')
      .mockResolvedValue({ added: [], skipped: [] } as never)

    render(<Harness />)
    await openSetCreate(/want-list/i)

    // The want-list dialog opens pre-seeded with the set's name; create it.
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByPlaceholderText<HTMLInputElement>(/chasing/i).value
    expect(name.length).toBeGreaterThan(0)
    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    // Lands as a chasing want-list, seeded with the set's cards.
    await waitFor(() => expect(create).toHaveBeenCalledWith(name, undefined))
    await waitFor(() =>
      expect(bulkAdd).toHaveBeenCalledWith(
        9,
        expect.arrayContaining([expect.objectContaining({ id: 'base1-4' })]),
        undefined,
      ),
    )
  })

  it('offers the row-independent Set ID cards export in Browse (#736)', async () => {
    render(<Harness />)
    // Set ID cards is reachable while browsing even with no matched rows;
    // the rest of the export menu stays in Search mode.
    expect(await screen.findByRole('button', { name: /Set ID cards/i })).toBeInTheDocument()
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
