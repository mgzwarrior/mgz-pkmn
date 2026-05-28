import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowseModal } from './BrowseModal'
import { useAppStore } from '../store'
import { fetchSetCards, fetchSets, setLogoUrl } from '../api/client'
import type { SetCard, SetInfo } from '../types'

vi.mock('../api/client', () => ({
  fetchSets: vi.fn(),
  fetchSetCards: vi.fn(),
  setLogoUrl: vi.fn((id: string) => `/api/v1/sets/${id}/logo`),
}))

const mockFetchSets = vi.mocked(fetchSets)
const mockFetchSetCards = vi.mocked(fetchSetCards)
const mockLogoUrl = vi.mocked(setLogoUrl)

const SETS: SetInfo[] = [
  {
    id: 'base1',
    name: 'Base Set',
    series: 'Base',
    total: 102,
    releaseDate: '1998/01/09',
  },
  {
    id: 'sv8',
    name: 'Surging Sparks',
    series: 'Scarlet & Violet',
    total: 252,
    releaseDate: '2024/11/08',
  },
]

const SV8_CARDS: SetCard[] = [
  {
    id: 'sv8-1',
    name: 'Pikachu',
    number: '1',
    rarity: 'Common',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    thumb: 'https://images.example/sv8-1.png',
    market: 0.5,
  },
  {
    id: 'sv8-25',
    name: 'Charizard ex',
    number: '25',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Stage 2', 'ex'],
    thumb: 'https://images.example/sv8-25.png',
    market: 42.5,
  },
  {
    id: 'sv8-200',
    name: 'Pikachu ex (Special Illustration Rare)',
    number: '200',
    rarity: 'Special Illustration Rare',
    supertype: 'Pokémon',
    subtypes: ['Basic', 'ex'],
    thumb: 'https://images.example/sv8-200.png',
    market: 150.0,
  },
]

describe('BrowseModal', () => {
  beforeEach(() => {
    useAppStore.setState({ inputText: '' })
    mockFetchSets.mockReset()
    mockFetchSetCards.mockReset()
    mockLogoUrl.mockClear()
    mockFetchSets.mockResolvedValue(SETS)
    mockFetchSetCards.mockResolvedValue(SV8_CARDS)
  })

  function renderOpen() {
    const onOpenChange = vi.fn()
    const result = render(<BrowseModal open onOpenChange={onOpenChange} />)
    return { onOpenChange, ...result }
  }

  it('loads the set catalog on open and renders sets newest-first by series', async () => {
    renderOpen()
    // Wait until the actual catalog rows render, not just the fetch call.
    await screen.findByText('Surging Sparks')
    expect(screen.getByText('Base Set')).toBeInTheDocument()

    // Series headers appear in order: Scarlet & Violet (newest) → Base.
    const seriesHeaders = screen.getAllByText(/Scarlet & Violet|^Base$/)
    expect(seriesHeaders[0]).toHaveTextContent('Scarlet & Violet')
  })

  it('picking a set loads its trimmed card list and renders the grid', async () => {
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))

    // The detail header replaces the list header with the set name.
    await screen.findByRole('heading', { name: /Surging Sparks/ })

    // fetchSetCards was called with the chosen set id.
    expect(mockFetchSetCards).toHaveBeenCalledWith('sv8', undefined)

    // Every card from the trimmed payload renders a tile.
    expect(await screen.findByText('Pikachu')).toBeInTheDocument()
    expect(screen.getByText('Charizard ex')).toBeInTheDocument()
    expect(
      screen.getByText('Pikachu ex (Special Illustration Rare)'),
    ).toBeInTheDocument()
  })

  it('clicking Add to list on a card pushes the canonical line into the editor', async () => {
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Charizard ex')

    fireEvent.click(
      screen.getByRole('button', { name: 'Add Charizard ex to list' }),
    )

    expect(useAppStore.getState().inputText).toContain(
      'Charizard ex | Surging Sparks | 25',
    )
  })

  it('Add to list dedupes — clicking the same card twice leaves one line', async () => {
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Pikachu')

    const addBtn = screen.getByRole('button', { name: 'Add Pikachu to list' })
    fireEvent.click(addBtn)
    fireEvent.click(addBtn)

    const input = useAppStore.getState().inputText
    const matches = input
      .split('\n')
      .filter((l) => l.trim() === 'Pikachu | Surging Sparks | 1')
    expect(matches).toHaveLength(1)
  })

  it('Add all visible pushes every currently-filtered card', async () => {
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Pikachu')

    fireEvent.click(screen.getByRole('button', { name: 'Add all visible' }))

    const lines = useAppStore.getState().inputText.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines).toContain('Pikachu | Surging Sparks | 1')
    expect(lines).toContain('Charizard ex | Surging Sparks | 25')
  })

  it('the rarity filter chips narrow the visible grid', async () => {
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Pikachu')

    // Click "Holos" — Common Pikachu (#1) should drop out, leaving the
    // Rare Holo Charizard ex and the Special Illustration Rare (which
    // also contains "Holo" in its full rarity? — it doesn't, but it
    // matches via "ultra" bucket separately, so use that for the test).
    fireEvent.click(screen.getByRole('button', { name: 'Ultra+' }))

    await waitFor(() => {
      expect(screen.queryByText('Pikachu')).not.toBeInTheDocument()
      expect(
        screen.getByText('Pikachu ex (Special Illustration Rare)'),
      ).toBeInTheDocument()
    })
  })

  it('the search box narrows the visible grid case-insensitively', async () => {
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Pikachu')

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search cards in this set' }),
      { target: { value: 'charizard' } },
    )

    await waitFor(() => {
      expect(screen.queryByText('Pikachu')).not.toBeInTheDocument()
      expect(screen.getByText('Charizard ex')).toBeInTheDocument()
    })
  })

  it('Back button returns to the set list and re-fetches a different set fresh', async () => {
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Charizard ex')

    fireEvent.click(screen.getByRole('button', { name: 'Back to set list' }))

    // Back at the set list — the heading reverts.
    expect(
      screen.getByRole('heading', { name: 'Browse sets' }),
    ).toBeInTheDocument()
  })

  it('surfaces an error when the card fetch fails', async () => {
    mockFetchSetCards.mockRejectedValueOnce(new Error('upstream down'))
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))

    expect(
      await screen.findByText(/Couldn’t load cards: upstream down/),
    ).toBeInTheDocument()
  })

  it('surfaces an error when the catalog fetch fails', async () => {
    mockFetchSets.mockRejectedValueOnce(new Error('catalog down'))
    renderOpen()

    expect(
      await screen.findByText(/Couldn’t load sets: catalog down/),
    ).toBeInTheDocument()
  })

  it('reports an honest 0-added status when re-adding an already-added card', async () => {
    // Covers Copilot review thread #1 — the modal used to render "Added
    // 1 line" even when `appendInputLines` had silently dropped the
    // dupe. We now use the return value of `appendInputLines`, so the
    // status reflects what actually landed in the editor.
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Pikachu')

    const addBtn = screen.getByRole('button', { name: 'Add Pikachu to list' })
    fireEvent.click(addBtn)
    // After the first click: "Added 1 line to your list".
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added 1 line to your list',
    )
    // Second click on the same card is a no-op: dedupe silently drops
    // it, so the status now reports the honest 0.
    fireEvent.click(addBtn)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added 0 lines to your list',
    )
  })

  it('clears the "Added N lines" status when switching to a different set', async () => {
    // Covers Copilot review thread #2 — the status used to persist into
    // the next set's detail view, reading as stale information. The
    // load effect now clears it before fetching the new set's cards.
    const OTHER_CARDS: SetCard[] = [
      {
        id: 'base1-4',
        name: 'Charizard',
        number: '4',
        rarity: 'Rare Holo',
        supertype: 'Pokémon',
        subtypes: ['Stage 2'],
        thumb: null,
        market: 200.0,
      },
    ]
    mockFetchSetCards.mockImplementation((id: string) =>
      Promise.resolve(id === 'base1' ? OTHER_CARDS : SV8_CARDS),
    )

    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Pikachu')
    fireEvent.click(screen.getByRole('button', { name: 'Add Pikachu to list' }))
    await screen.findByRole('status') // ensures the status rendered

    // Back out and pick the other set.
    fireEvent.click(screen.getByRole('button', { name: 'Back to set list' }))
    fireEvent.click(await screen.findByText('Base Set'))
    await screen.findByText('Charizard')

    // No status carried over.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('Add holos / Add rares operate on the FULL set, not the filtered slice', async () => {
    // Covers Copilot review thread #3 — with a non-"All" rarity chip
    // active, the bulk buttons used to take their input from the
    // already-filtered grid, producing zero-add results that fought
    // the button's label. Now they always run against the unfiltered
    // pool so the label is honest.
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Pikachu')

    // Narrow visible to "Ultra+" (only the Special Illustration Rare
    // would be visible). Then click "Add holos" — should still find
    // the Rare Holo Charizard ex in the unfiltered pool.
    fireEvent.click(screen.getByRole('button', { name: 'Ultra+' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add holos' }))

    const lines = useAppStore.getState().inputText.split('\n')
    expect(lines).toContain('Charizard ex | Surging Sparks | 25')
  })

  it('caches the trimmed cards in memory — re-picking the same set skips the fetch', async () => {
    // New behaviour added during PR review (observation #2): re-opening
    // the same set should be instantaneous, with no loading flicker
    // and no second network call.
    renderOpen()
    fireEvent.click(await screen.findByText('Surging Sparks'))
    await screen.findByText('Pikachu')
    expect(mockFetchSetCards).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Back to set list' }))
    fireEvent.click(await screen.findByText('Surging Sparks'))

    // Cards render immediately from the SPA-side cache.
    expect(await screen.findByText('Pikachu')).toBeInTheDocument()
    // And no second fetch fired.
    expect(mockFetchSetCards).toHaveBeenCalledTimes(1)
  })
})
