import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SwipePanel } from './SwipePanel'
import {
  fetchSets,
  fetchSetCards,
  fetchWishlists,
  fetchMe,
  fetchCollections,
  fetchSwipeExcluded,
  recordSwipeSeen,
  resetSwipeSeen,
  wantCard,
  ownCard,
} from '../api/client'
import { _resetSwipeProfileForTests } from './useSwipeProfile'
import { _resetWishlistsCacheForTests } from './useWishlists'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { useAppStore } from '../store'
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
  // Library-aware swipe exclusion (#581): the panel loads the persisted
  // exclusion set on mount and records each swiped card.
  fetchSwipeExcluded: vi.fn(),
  recordSwipeSeen: vi.fn(),
  resetSwipeSeen: vi.fn(),
  // Cross-collection ownership badge (#576): default to "nothing owned".
  fetchCardOwnership: vi.fn(async () => ({})),
  hasPersonalOwnership: (
    ownership: { collections: { purpose: string }[] } | null | undefined,
  ): boolean => !!ownership && ownership.collections.some((c) => c.purpose === 'personal'),
  // Favorite-Pokémon candidate weighting (#742): signed-in only; default to
  // an empty pin list so the deck isn't biased and no real request fires.
  fetchFavoritePokemon: vi.fn(async () => []),
  pinFavoritePokemon: vi.fn(),
  unpinFavoritePokemon: vi.fn(),
  // One-tap want / own quick actions (#761) — ownership swipe mode (#912)
  // reuses these to file the swiped card into the default wishlist /
  // collection.
  wantCard: vi.fn(async () => ({})),
  unwantCard: vi.fn(async () => ({})),
  ownCard: vi.fn(async () => ({})),
  unownCard: vi.fn(async () => ({})),
}))

const mockFetchSets = vi.mocked(fetchSets)
const mockFetchSetCards = vi.mocked(fetchSetCards)
const mockFetchWishlists = vi.mocked(fetchWishlists)
const mockFetchMe = vi.mocked(fetchMe)
const mockFetchCollections = vi.mocked(fetchCollections)
const mockFetchSwipeExcluded = vi.mocked(fetchSwipeExcluded)
const mockRecordSwipeSeen = vi.mocked(recordSwipeSeen)
const mockResetSwipeSeen = vi.mocked(resetSwipeSeen)
const mockWantCard = vi.mocked(wantCard)
const mockOwnCard = vi.mocked(ownCard)

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
    dexNumbers: [],
    ...overrides,
  }
}

// Each keystroke / drag commit kicks off a 180ms exit-animation timeout in
// SwipePanel before `advance()` runs and renders the next card. That's a real
// timer, so under full-suite CI contention (#387, #653) the saturated event
// loop fires it well past the old 3s budget — and 3s was *under* the 5s test
// timeout, so the assertion lost the race first. Give post-swipe assertions a
// wide budget from one place; on success the wait still resolves in ~200ms.
const POST_SWIPE_WAIT = { timeout: 10000 } as const

// Commit a keyboard swipe and deterministically flush the 180ms exit-animation
// timer. SwipePanel schedules the save/advance behind a real `setTimeout`, so a
// widened waitFor budget still loses to a CI event loop starved past it (#387,
// #653) — worst on tests that chain two swipes. Faking just that timer lands
// the swipe on a controlled clock instead of the loaded loop. Real timers are
// restored immediately so surrounding waitFor calls poll normally.
async function swipeKey(key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp') {
  vi.useFakeTimers()
  try {
    fireEvent.keyDown(window, { key })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
  } finally {
    vi.useRealTimers()
  }
}

describe('SwipePanel', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetSwipeProfileForTests()
    // A cold profile re-offers the onboarding pass (#714); dismiss it by
    // default so unrelated tests see the plain panel. The onboarding tests
    // below clear the key themselves.
    window.localStorage.setItem('mgz-pkmn:swipe-onboarding:v1', 'done')
    _resetWishlistsCacheForTests()
    _resetCollectionsCacheForTests()
    _resetAuthStoreForTests()
    mockFetchSets.mockReset()
    mockFetchSetCards.mockReset()
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
    // Distinct collector numbers per card: the library-aware exclusion
    // (#581) keys on (set_id, number), so two cards sharing a number would
    // be treated as the same identity. Real set data is unique here.
    mockFetchSetCards.mockResolvedValue([
      card({ id: 'sv1-1', name: 'Pikachu', number: '1', market: 5 }),
      card({ id: 'sv1-2', name: 'Charizard', number: '2', market: 50 }),
    ])
    mockFetchWishlists.mockResolvedValue([])
    mockFetchSwipeExcluded.mockReset()
    mockFetchSwipeExcluded.mockResolvedValue([])
    mockRecordSwipeSeen.mockReset()
    mockRecordSwipeSeen.mockResolvedValue(undefined)
    mockResetSwipeSeen.mockReset()
    mockResetSwipeSeen.mockResolvedValue(undefined)
    mockWantCard.mockReset()
    mockWantCard.mockResolvedValue({} as never)
    mockOwnCard.mockReset()
    mockOwnCard.mockResolvedValue({} as never)
    // Pin the rarity-weighted sampler so candidate order is deterministic.
    // `Math.random() === 0` picks the first available set and the first
    // unseen card; after a swipe, the same source picks the remaining card.
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    randomSpy.mockRestore()
    // The store persists across tests; reset the opt-in library toggles so
    // a test that flips them doesn't leak into the next (#581).
    useAppStore.setState((s) => ({
      settings: {
        ...s.settings,
        swipeExcludeOwned: false,
        swipeExcludeChasing: false,
      },
    }))
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

  it('rarity-floor control defaults to Chase cards and persists changes', async () => {
    // A prior test may have left the persisted floor changed; pin it.
    useAppStore.setState((s) => ({
      settings: { ...s.settings, swipeRarityFloor: 'chase' },
    }))
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const select = screen.getByLabelText('Rarity floor') as HTMLSelectElement
    expect(select.value).toBe('chase')

    fireEvent.change(select, { target: { value: 'all' } })
    expect(useAppStore.getState().settings.swipeRarityFloor).toBe('all')

    // Restore the default so the change doesn't leak into later tests.
    useAppStore.setState((s) => ({
      settings: { ...s.settings, swipeRarityFloor: 'chase' },
    }))
  })

  it('renders the next card as an inert peek beneath the top card', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    // Only the top card is the interactive (testid) target; the prefetched
    // next card sits beneath it as an aria-hidden peek so the swap reveals
    // a card that's already mounted — no slide-in, no loader flash.
    expect(screen.getAllByTestId('swipe-card')).toHaveLength(1)
    await waitFor(() =>
      expect(screen.getByText('Charizard')).toBeInTheDocument(),
    )
  })

  it('saves the card and advances when → is pressed', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    // The save commits after the exit-animation timeout. Wait on the header
    // chip directly — the next card now peeks in from the start, so its
    // text appearing is no longer a reliable "advance happened" signal.
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: /1 saved · reset/i }),
        ).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
  })

  it('passes (no save) when ← is pressed', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    await waitFor(
      () => expect(screen.getByText('Charizard')).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
  })

  it('records a "love" (ArrowUp) — saves *and* double-weights the card', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'ArrowUp' })

    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: /1 saved · reset/i }),
        ).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
  })

  it('action-row buttons mirror the keyboard shortcuts', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: /1 saved · reset/i }),
        ).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
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
      () =>
        expect(
          screen.getByRole('button', { name: /1 saved · reset/i }),
        ).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
  })

  // Chaining two swipes doubles the exit-animation timer race, which still
  // loses to a starved CI event loop often enough to redden the job on
  // unrelated PRs (#804; same contention as #387 / #653). Retry just this
  // test so a transient miss re-runs in isolation; a real regression still
  // fails every attempt and blocks.
  it('shows the exhausted state once every set has been walked', { retry: 2 }, async () => {
    // A single set with two cards — after two swipes the catalog is empty.
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    // Chaining two swipes compounds the exit-animation timer race, so drive
    // each commit on a faked clock. The first pass must fully commit (Pikachu
    // leaves the stack) before the next keystroke — while the exit animation
    // is in flight the handler ignores input, so an instant peek must not race
    // it.
    await swipeKey('ArrowLeft')
    await waitFor(
      () => expect(screen.queryByText('Pikachu')).not.toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    await swipeKey('ArrowLeft')
    await waitFor(
      () =>
        expect(
          screen.getByText(/You.ve seen every card in the recent sets|every card/i),
        ).toBeInTheDocument(),
      POST_SWIPE_WAIT,
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
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: /1 saved · reset/i }),
        ).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    fireEvent.click(screen.getByRole('button', { name: /1 saved · reset/i }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Reset profile' }),
      ).toBeInTheDocument(),
    )
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

  it('shows the one-tap want / own quick actions when signed in (#761)', async () => {
    mockFetchMe.mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    // useAuth resolves async — wait for the gated quick actions to mount.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^want$/i })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /^own$/i })).toBeInTheDocument()
    // The swipe-mechanic buttons stay alongside the new quick-action pair.
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

  it('records each swiped card as seen (#581)', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    // The set id derives from the (unmocked) baked catalog the candidate was
    // sampled from; the card number + decision are the deterministic parts.
    await waitFor(() =>
      expect(mockRecordSwipeSeen).toHaveBeenCalledWith(
        expect.any(String),
        '1',
        'save',
      ),
    )
  })

  it('shows the library-aware exclusion toggles only when signed in (#581)', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    // Signed out (the beforeEach default) → no library toggles.
    expect(
      screen.queryByRole('checkbox', { name: 'owned' }),
    ).not.toBeInTheDocument()
  })

  it('toggling "hide owned" updates settings and refetches exclusions (#581)', async () => {
    mockFetchMe.mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const owned = await screen.findByRole('checkbox', { name: 'owned' })
    fireEvent.click(owned)

    await waitFor(() =>
      expect(useAppStore.getState().settings.swipeExcludeOwned).toBe(true),
    )
    await waitFor(() =>
      expect(mockFetchSwipeExcluded).toHaveBeenCalledWith({
        owned: true,
        chasing: false,
      }),
    )
  })

  it('hides the taste/ownership mode toggle when signed out (#912)', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    expect(screen.queryByRole('group', { name: 'Swipe mode' })).not.toBeInTheDocument()
  })

  it('switching to ownership mode relabels the gesture legend and action buttons (#912)', async () => {
    mockFetchMe.mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const toggle = await screen.findByRole('group', { name: 'Swipe mode' })
    // Taste mode is the default — the original labels are still live.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    fireEvent.click(within(toggle).getByRole('button', { name: 'Ownership' }))

    expect(screen.getByRole('button', { name: 'Owned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chase' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not interested' })).toBeInTheDocument()
  })

  it('ownership mode: a right swipe files the card into the default collection instead of the taste profile (#912)', async () => {
    mockFetchMe.mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const toggle = await screen.findByRole('group', { name: 'Swipe mode' })
    fireEvent.click(within(toggle).getByRole('button', { name: 'Ownership' }))

    fireEvent.click(screen.getByRole('button', { name: 'Owned' }))

    await waitFor(
      () => expect(mockOwnCard).toHaveBeenCalledTimes(1),
      POST_SWIPE_WAIT,
    )
    expect(mockWantCard).not.toHaveBeenCalled()
    // Still recorded as seen (#581) — the no-repeat memory is mode-independent.
    await waitFor(() =>
      expect(mockRecordSwipeSeen).toHaveBeenCalledWith(expect.any(String), '1', 'save'),
    )
  })

  it('ownership mode: an up swipe (Chase) adds the card to the default wishlist (#912)', async () => {
    mockFetchMe.mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const toggle = await screen.findByRole('group', { name: 'Swipe mode' })
    fireEvent.click(within(toggle).getByRole('button', { name: 'Ownership' }))

    fireEvent.click(screen.getByRole('button', { name: 'Chase' }))

    await waitFor(
      () => expect(mockWantCard).toHaveBeenCalledTimes(1),
      POST_SWIPE_WAIT,
    )
    expect(mockOwnCard).not.toHaveBeenCalled()
  })

  it('ownership mode: a "Not interested" swipe leaves the library alone, recording only the no-repeat exclusion (#912)', async () => {
    mockFetchMe.mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const toggle = await screen.findByRole('group', { name: 'Swipe mode' })
    fireEvent.click(within(toggle).getByRole('button', { name: 'Ownership' }))

    fireEvent.click(screen.getByRole('button', { name: 'Not interested' }))

    await waitFor(
      () =>
        expect(mockRecordSwipeSeen).toHaveBeenCalledWith(
          expect.any(String),
          '1',
          'pass',
        ),
      POST_SWIPE_WAIT,
    )
    expect(mockOwnCard).not.toHaveBeenCalled()
    expect(mockWantCard).not.toHaveBeenCalled()
  })

  it('pressing Enter on the focused card opens the detail modal', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.keyDown(screen.getByTestId('swipe-card'), { key: 'Enter' })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('Pikachu').length).toBeGreaterThan(0)

    // Escape closes it (onChangeIndex back to null).
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('a drag past the leftward threshold commits a pass (no save)', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const card = screen.getByTestId('swipe-card')
    Object.defineProperty(card, 'setPointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(card, 'releasePointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(card, 'hasPointerCapture', { value: () => false, configurable: true })

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(card, { pointerId: 1, clientX: -200, clientY: 0 })
    fireEvent.pointerUp(card, { pointerId: 1, clientX: -200, clientY: 0 })

    await waitFor(
      () => expect(screen.getByText('Charizard')).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
    // A pass saves nothing — the header still offers a plain reset.
    expect(
      screen.getByRole('button', { name: 'Reset profile' }),
    ).toBeInTheDocument()
  })

  it('a drag past the upward threshold commits a love (save + weight)', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const card = screen.getByTestId('swipe-card')
    Object.defineProperty(card, 'setPointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(card, 'releasePointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(card, 'hasPointerCapture', { value: () => false, configurable: true })

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 0, clientY: -200 })
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 0, clientY: -200 })

    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: /1 saved · reset/i }),
        ).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
  })

  it('the Pass and More-like-this action buttons commit decisions', async () => {
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))
    // The action buttons are disabled mid-exit; wait for the pass to finish
    // (Pikachu gone, Charizard promoted) before the second decision.
    await waitFor(
      () => expect(screen.queryByText('Pikachu')).not.toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )

    fireEvent.click(screen.getByRole('button', { name: 'More like this' }))
    // Love saves the card; the header chip reflects the one save.
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: /1 saved · reset/i }),
        ).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
  })

  it('falls back to the placeholder when the card art fails to load', async () => {
    mockFetchSetCards.mockReset()
    mockFetchSetCards.mockResolvedValue([
      card({ id: 'sv1-1', name: 'Pikachu', thumb: 'https://img/pikachu.png' }),
    ])

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())

    const img = screen.getByAltText('Pikachu') as HTMLImageElement
    fireEvent.error(img)

    // The broken image is swapped for the ImageOff placeholder.
    await waitFor(() =>
      expect(screen.queryByAltText('Pikachu')).not.toBeInTheDocument(),
    )
  })

  it('offers the onboarding pass on a cold profile and counts swipes once started (#714)', async () => {
    window.localStorage.removeItem('mgz-pkmn:swipe-onboarding:v1')

    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    expect(screen.getByText('New here? Teach Swipe your taste')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start the pass' }))
    expect(screen.queryByText('New here? Teach Swipe your taste')).not.toBeInTheDocument()
    expect(screen.getByText(/Learning your taste — 0 of/)).toBeInTheDocument()

    await swipeKey('ArrowRight')
    await waitFor(
      () => expect(screen.getByText(/Learning your taste — 1 of/)).toBeInTheDocument(),
      POST_SWIPE_WAIT,
    )
  })

  it('does not offer the onboarding pass once dismissed (#714)', async () => {
    // beforeEach seeds the dismissed marker — the plain panel case.
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    expect(screen.queryByText('New here? Teach Swipe your taste')).not.toBeInTheDocument()
  })

  it('a profile reset re-offers the onboarding pass (#714)', async () => {
    // beforeEach seeds the dismissed marker; reset must clear it.
    render(<SwipePanel active />)
    await waitFor(() => expect(screen.getByText('Pikachu')).toBeInTheDocument())
    expect(screen.queryByText('New here? Teach Swipe your taste')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset profile' }))
    await waitFor(() =>
      expect(screen.getByText('New here? Teach Swipe your taste')).toBeInTheDocument(),
    )
    expect(window.localStorage.getItem('mgz-pkmn:swipe-onboarding:v1')).toBeNull()
  })
})
