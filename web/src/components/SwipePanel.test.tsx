import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SwipePanel } from './SwipePanel'
import {
  fetchSets,
  fetchSetCards,
  createWishlist,
  addCardToWishlist,
  fetchWishlists,
  fetchMe,
  fetchCollections,
} from '../api/client'
import { _resetSwipeProfileForTests } from './useSwipeProfile'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import type { SetCard } from '../types'

vi.mock('../api/client', () => ({
  fetchSets: vi.fn(),
  fetchSetCards: vi.fn(),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
  fetchWishlists: vi.fn(),
  // SwipePanel reads useAuth to gate the per-card save buttons; when signed
  // in those buttons mount the collection / wishlist pickers, which fetch
  // their lists on mount. beforeEach pins the signed-out + empty defaults.
  fetchMe: vi.fn(),
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  addCardToCollection: vi.fn(),
}))

const mockFetchSets = vi.mocked(fetchSets)
const mockFetchSetCards = vi.mocked(fetchSetCards)
const mockCreateWishlist = vi.mocked(createWishlist)
const mockAddCardToWishlist = vi.mocked(addCardToWishlist)
const mockFetchWishlists = vi.mocked(fetchWishlists)
const mockFetchMe = vi.mocked(fetchMe)
const mockFetchCollections = vi.mocked(fetchCollections)

function card(overrides: Partial<SetCard> = {}): SetCard {
  return {
    id: 'sv1-1',
    name: 'Pikachu',
    number: '1',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    thumb: null,
    market: 5,
    ...overrides,
  }
}

// Each keystroke / drag commit kicks off a 180ms exit-animation timeout in
// SwipePanel before `advance()` runs and renders the next card. The default
// 1s waitFor budget gets tight when CI runs the whole suite under contention
// (#387); give the post-swipe assertions 3s of headroom from one place.
const POST_SWIPE_WAIT = { timeout: 3000 } as const

describe('SwipePanel', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetSwipeProfileForTests()
    _resetWishlistsCacheForTests()
    _resetCollectionsCacheForTests()
    _resetAuthStoreForTests()
    mockFetchSets.mockReset()
    mockFetchSetCards.mockReset()
    mockCreateWishlist.mockReset()
    mockAddCardToWishlist.mockReset()
    mockFetchWishlists.mockReset()
    // Default to signed-out with empty lists; the auth-gated tests below
    // override fetchMe per-case.
    mockFetchMe.mockReset()
    mockFetchMe.mockResolvedValue({ user: null, authEnabled: true })
    mockFetchCollections.mockReset()
    mockFetchCollections.mockResolvedValue([])
    mockFetchSets.mockResolvedValue([
      { id: 'sv1', name: 'Scarlet & Violet', series: 'SV', total: 2, releaseDate: '2023/03/31' },
    ])
    mockFetchSetCards.mockResolvedValue([
      card({ id: 'sv1-1', name: 'Pikachu', market: 5 }),
      card({ id: 'sv1-2', name: 'Charizard', market: 50 }),
    ])
    mockFetchWishlists.mockResolvedValue([])
    // Pin the rarity-weighted sampler so candidate order is deterministic.
    // `Math.random() === 0` picks the first available set and the first
    // unseen card; after a swipe, the same source picks the remaining card.
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    randomSpy.mockRestore()
  })

  it('renders the current candidate card', async () => {
    render(<SwipePanel active />)
    await waitFor(() =>
      expect(screen.getByTestId('swipe-card')).toBeInTheDocument(),
    )
    // With Math.random pinned to 0, the weighted sampler picks the
    // first unseen card in the array (Pikachu).
    expect(screen.getByText('Pikachu')).toBeInTheDocument()
  })

  it('saves the card and advances when → is pressed', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(
      () => expect(screen.getByText('Charizard')).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    // The save count chip in the header should show "1 saved · reset".
    expect(
      screen.getByRole('button', { name: /1 saved · reset/i }),
    ).toBeInTheDocument()
  })

  it('passes (no save) when ← is pressed', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    await waitFor(
      () => expect(screen.getByText('Charizard')).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    // No "Build prep list" panel since saved list is empty.
    expect(screen.queryByText(/Build a prep list/i)).not.toBeInTheDocument()
  })

  it('records a "love" (ArrowUp) — saves *and* double-weights the card', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'ArrowUp' })

    await waitFor(
      () => expect(screen.getByText('Charizard')).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    expect(
      screen.getByRole('button', { name: /1 saved · reset/i }),
    ).toBeInTheDocument()
  })

  it('action-row buttons mirror the keyboard shortcuts', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(
      () => expect(screen.getByText('Charizard')).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    expect(
      screen.getByRole('button', { name: /1 saved · reset/i }),
    ).toBeInTheDocument()
  })

  it('a drag past the rightward threshold commits a save', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const card = screen.getByTestId('swipe-card')
    // jsdom Element doesn't implement set/release/hasPointerCapture; stub them
    // so the React handler doesn't throw when calling them on the event target.
    Object.defineProperty(card, 'setPointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(card, 'releasePointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(card, 'hasPointerCapture', { value: () => false, configurable: true })

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 200, clientY: 0 })
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 200, clientY: 0 })

    await waitFor(
      () => expect(screen.getByText('Charizard')).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    expect(
      screen.getByRole('button', { name: /1 saved · reset/i }),
    ).toBeInTheDocument()
  })

  it('shows the exhausted state once every set has been walked', async () => {
    // A single set with two cards — after two swipes the catalog is empty.
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await waitFor(
      () => expect(screen.getByText('Charizard')).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await waitFor(() =>
      expect(
        screen.getByText(/You.ve seen every card in the recent sets|every card/i),
      ).toBeInTheDocument(),
    )
  })

  it('surfaces a fetchSetCards error to the user', async () => {
    mockFetchSetCards.mockReset()
    mockFetchSetCards.mockRejectedValue(new Error('upstream offline'))
    render(<SwipePanel active />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/upstream offline/i),
    )
  })

  it('Reset profile clears saved cards and the seen list', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /1 saved · reset/i }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /1 saved · reset/i }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Reset profile' }),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Build a prep list/i)).not.toBeInTheDocument()
  })

  it('surfaces a Build prep list error when wishlist creation fails', async () => {
    mockCreateWishlist.mockRejectedValue(new Error('quota exceeded'))

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(screen.getByLabelText('Prep list name')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /build prep list/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/quota exceeded/i),
    )
    // CTA still visible — onCleared wasn't called.
    expect(screen.getByText(/Build a prep list/i)).toBeInTheDocument()
  })

  it('Build prep list creates a wishlist and adds saved cards', async () => {
    mockCreateWishlist.mockResolvedValue({
      id: 42,
      name: 'Custom prep',
      description: null,
      created_at: '2026-06-06T00:00:00',
      items: [],
    })
    mockAddCardToWishlist.mockResolvedValue({
      id: 1,
      card: {},
      notes: null,
      max_price: null,
      added_at: '2026-06-06T00:00:00',
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /1 saved · reset/i }),
      ).toBeInTheDocument(),
    )

    const input = screen.getByLabelText('Prep list name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Custom prep' } })
    fireEvent.click(screen.getByRole('button', { name: /build prep list/i }))

    await waitFor(() =>
      expect(mockCreateWishlist).toHaveBeenCalledWith('Custom prep', undefined),
    )
    // After success the saved list clears so the CTA disappears.
    await waitFor(() =>
      expect(screen.queryByText(/Build a prep list/i)).not.toBeInTheDocument(),
    )
    expect(mockAddCardToWishlist).toHaveBeenCalledTimes(1)
  })

  it('tapping the card (no drag) opens the same detail modal Search rows use', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    // A click with no preceding pointer movement is a tap, not a swipe.
    fireEvent.click(screen.getByTestId('swipe-card'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('Pikachu').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('$5.00')).toBeInTheDocument()
  })

  it('a sub-threshold drag is not mistaken for a tap', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const card = screen.getByTestId('swipe-card')
    Object.defineProperty(card, 'setPointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(card, 'releasePointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(card, 'hasPointerCapture', { value: () => false, configurable: true })

    // Past the click slop (6px) but short of the swipe threshold (110px):
    // a cancelled swipe, not a tap. The trailing click must not open the modal.
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 40, clientY: 0 })
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 40, clientY: 0 })
    fireEvent.click(card)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // And no decision committed — still on the first candidate.
    expect(screen.getByText('Pikachu')).toBeInTheDocument()
  })

  it('shows the collection / wishlist save buttons when signed in', async () => {
    mockFetchMe.mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    // useAuth resolves async — wait for the gated save buttons to mount.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /save to collection/i }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: /save to wishlist/i }),
    ).toBeInTheDocument()
    // The swipe-mechanic buttons stay alongside the new save pair.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('hides the save buttons when signed out, matching the Search row', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    // Let any pending auth resolution flush before asserting absence.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: /save to collection/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /save to wishlist/i }),
    ).not.toBeInTheDocument()
  })
})
