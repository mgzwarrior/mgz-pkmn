/**
 * App.test — exercises the bulk-lookup lifecycle in App.tsx, focused on
 * the run-timestamp wiring added for the lookup-timer feature (#263).
 *
 * Strategy: mock `bulkLookup` so we can drive `onEvent` + `onDone` from
 * the test, render the real `<App />` against the real Zustand store,
 * and assert that `runStartedAt` / `runEndedAt` transition as expected
 * through start, first-event, completion, stop, and error paths.
 *
 * Heavier interactions (the textarea wiring, the chips, the modal
 * surfaces) are covered by their own component tests — here we touch
 * just enough of the UI to set inputText + click Look up / Stop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { useAppStore } from './store'
import { _resetAuthStoreForTests } from './hooks/useAuth'
import type { BulkEvent } from './types'

const { mockBulkLookup, mockLookupLine, mockParseLine } = vi.hoisted(() => ({
  mockBulkLookup: vi.fn(),
  mockLookupLine: vi.fn(),
  mockParseLine: vi.fn(),
}))

vi.mock('./api/client', () => ({
  bulkLookup: mockBulkLookup,
  lookupLine: mockLookupLine,
  parseLine: mockParseLine,
  saveRun: vi.fn(),
  listRuns: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  // Other client functions are referenced by ExportBar / SetPickerModal
  // mounted inside App; stub them to keep render happy. Names must
  // match the real `client.ts` exports — `fetchSets`, not
  // `fetchSetCatalog`.
  exportFile: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
  fetchSets: vi.fn(() => Promise.resolve([])),
  // SwipePanel mounts on the Swipe tab and calls `fetchSetCards` on
  // each candidate fetch — stub to an empty list so the panel surfaces
  // its "loading sets…" state without hitting the network.
  fetchSetCards: vi.fn(() => Promise.resolve([])),
  // SwipePanel's "Build prep list" CTA depends on `useWishlists`, which
  // mounts its own GET on the first hook subscriber.
  fetchWishlists: vi.fn(() => Promise.resolve([])),
  // InsightsNavButton mounts in the header and reads useCollections on its
  // first subscriber; stub the list so the gate resolves to 0 (button hidden).
  fetchCollections: vi.fn(() => Promise.resolve([])),
  createWishlist: vi.fn(),
  addCardToWishlist: vi.fn(),
  setLogoUrl: vi.fn(() => ''),
  dedupeRows: vi.fn((rows: unknown[]) => rows),
  addOverride: vi.fn(),
  // Referenced by the HelpModal's "What's new" section.
  fetchChangelog: vi.fn(() => Promise.resolve([])),
  // SignInChip / ResultsTable / App all read useAuth on mount, which
  // calls `fetchMe`. Stub to the auth-on-but-anonymous envelope so the
  // chip resolves to its signed-out shape and the user-scoped chips
  // (collections / wishlists) stay hidden in the default fixture.
  fetchMe: vi.fn(() => Promise.resolve({ user: null, authEnabled: true })),
  logout: vi.fn(() => Promise.resolve()),
  requestMagicLink: vi.fn(() => Promise.resolve()),
}))

function makeEvent(index: number, total: number, matched = true): BulkEvent {
  return {
    index,
    total,
    matched,
    reason: matched ? '' : 'no match',
    stage: matched ? 'resolved' : 'no_match',
    tag: '',
    query: {
      raw: `q${index}`,
      name: `q${index}`,
      set_hint: null,
      number: null,
      variant_hint: null,
      url_hint: null,
      bulk_top: null,
      bulk_all: false,
      price_min: null,
      price_max: null,
    },
    card: matched ? { id: `c${index}`, name: `q${index}` } : null,
    pricing: { market: null, variant: null, source: null, url: null, currency: 'USD' },
  }
}

function resetStore() {
  useAppStore.setState({
    inputText: '',
    rows: [],
    processingLines: [],
    progress: null,
    isRunning: false,
    runStartedAt: null,
    runEndedAt: null,
    editorCollapsed: false,
  })
  useAppStore.getState().resetSettings()
}

// The app now opens on Swipe (#814). Most of these tests exercise the
// Search-mode editor / run lifecycle, so render and switch to Search first —
// reproducing the old default landing without coupling each test to it.
function renderInSearchMode() {
  const utils = render(<App />)
  fireEvent.click(
    within(screen.getByRole('tablist', { name: /Discovery mode/i })).getByRole('tab', {
      name: /Search/,
    }),
  )
  return utils
}

describe('App: bulk-run timestamp lifecycle', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>
  let currentTime = 0
  const setNow = (t: number) => {
    currentTime = t
  }

  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    mockBulkLookup.mockReset()
    mockLookupLine.mockReset()
    mockParseLine.mockReset()
    currentTime = 0
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentTime)
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  it('resets timestamps on click, sets runStartedAt on first event, sets runEndedAt on done', async () => {
    // Pre-populate stale timestamps from a prior run; handleRun should
    // clear them before the first event lands so the running clock
    // doesn't briefly show a value from the previous run.
    useAppStore.setState({
      inputText: 'Charizard',
      runStartedAt: 111,
      runEndedAt: 222,
    })

    let captured: { onEvent: (e: BulkEvent) => void; onDone: () => void } | null = null
    mockBulkLookup.mockImplementation(
      (
        _lines: string[],
        _settings: unknown,
        onEvent: (e: BulkEvent) => void,
        onDone: () => void,
      ) => {
        captured = { onEvent, onDone }
        return new Promise<void>(() => {
          /* never resolves on its own — test drives onDone */
        })
      },
    )

    renderInSearchMode()
    setNow(1_000)
    fireEvent.click(screen.getByRole('button', { name: /look up/i }))

    // Immediately after click: timestamps reset to null, run flagged.
    await waitFor(() => {
      expect(useAppStore.getState().isRunning).toBe(true)
    })
    expect(useAppStore.getState().runStartedAt).toBeNull()
    expect(useAppStore.getState().runEndedAt).toBeNull()
    expect(captured).not.toBeNull()

    // First event arrives at t=2000.
    setNow(2_000)
    act(() => captured!.onEvent(makeEvent(0, 1)))
    expect(useAppStore.getState().runStartedAt).toBe(2_000)
    expect(useAppStore.getState().runEndedAt).toBeNull()

    // A second event must NOT re-bump runStartedAt — the first SSE
    // event is the anchor for the whole run.
    setNow(2_500)
    act(() => captured!.onEvent(makeEvent(1, 2)))
    expect(useAppStore.getState().runStartedAt).toBe(2_000)

    // Done event at t=3500 — run flips off and runEndedAt is stamped.
    setNow(3_500)
    act(() => captured!.onDone())
    expect(useAppStore.getState().isRunning).toBe(false)
    expect(useAppStore.getState().runEndedAt).toBe(3_500)
    expect(useAppStore.getState().runStartedAt).toBe(2_000)
  })

  it('Stop aborts the stream; bulkLookup\'s onDone(aborted) is what stamps runEndedAt', async () => {
    useAppStore.setState({ inputText: 'Charizard' })
    // Simulate real client.ts: surface the first event so runStartedAt
    // is set, then wait for the abort signal and call onDone(true) —
    // which is the contract App.tsx now relies on as the single
    // source of truth for end-of-run stamping.
    mockBulkLookup.mockImplementation(
      (
        _lines: string[],
        _settings: unknown,
        onEvent: (e: BulkEvent) => void,
        onDone: (aborted: boolean) => void,
        signal: AbortSignal,
      ) => {
        setNow(1_000)
        onEvent(makeEvent(0, 5))
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            onDone(true)
            resolve()
          })
        })
      },
    )

    renderInSearchMode()
    fireEvent.click(screen.getByRole('button', { name: /look up/i }))
    await waitFor(() => {
      expect(useAppStore.getState().runStartedAt).toBe(1_000)
    })

    setNow(4_200)
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    await waitFor(() => {
      expect(useAppStore.getState().isRunning).toBe(false)
    })
    expect(useAppStore.getState().runEndedAt).toBe(4_200)
  })

  it('progress counts resolved lines so out-of-order events never make it regress', async () => {
    // The server streams results in completion order, not input order (#303),
    // so a late-finishing early line must not rewind the progress bar.
    useAppStore.setState({ inputText: 'a\nb\nc' })

    let captured: { onEvent: (e: BulkEvent) => void } | null = null
    mockBulkLookup.mockImplementation(
      (_lines: string[], _settings: unknown, onEvent: (e: BulkEvent) => void) => {
        captured = { onEvent }
        return new Promise<void>(() => {})
      },
    )

    renderInSearchMode()
    fireEvent.click(screen.getByRole('button', { name: /look up/i }))
    await waitFor(() => expect(captured).not.toBeNull())

    // Arrive out of order: line 2 resolves first, then 0, then 1.
    act(() => captured!.onEvent(makeEvent(2, 3)))
    expect(useAppStore.getState().progress).toEqual({ done: 1, total: 3 })
    act(() => captured!.onEvent(makeEvent(0, 3)))
    expect(useAppStore.getState().progress).toEqual({ done: 2, total: 3 })
    act(() => captured!.onEvent(makeEvent(1, 3)))
    expect(useAppStore.getState().progress).toEqual({ done: 3, total: 3 })
  })

  it('progress counts a deduped line so a duplicate card ID still reaches total', async () => {
    // With dedupe on, a line resolving to an already-seen card ID is skipped
    // from the table but still resolved its input line — it must count toward
    // progress, otherwise the bar strands below total (e.g. 2 / 3).
    useAppStore.setState({ inputText: 'Pikachu\nPikachu\nMew' })
    useAppStore.getState().updateSettings({ dedupe: true })

    let captured: { onEvent: (e: BulkEvent) => void } | null = null
    mockBulkLookup.mockImplementation(
      (_lines: string[], _settings: unknown, onEvent: (e: BulkEvent) => void) => {
        captured = { onEvent }
        return new Promise<void>(() => {})
      },
    )

    renderInSearchMode()
    fireEvent.click(screen.getByRole('button', { name: /look up/i }))
    await waitFor(() => expect(captured).not.toBeNull())

    // Lines 0 and 1 resolve to the same card ID; line 1 is the duplicate.
    const dup = (index: number) => ({ ...makeEvent(index, 3), card: { id: 'pika', name: 'Pikachu' } })
    act(() => captured!.onEvent(dup(0)))
    expect(useAppStore.getState().progress).toEqual({ done: 1, total: 3 })
    act(() => captured!.onEvent(dup(1)))
    expect(useAppStore.getState().progress).toEqual({ done: 2, total: 3 })
    act(() => captured!.onEvent(makeEvent(2, 3)))
    expect(useAppStore.getState().progress).toEqual({ done: 3, total: 3 })
  })

  it('a bulkLookup network rejection without onDone still stamps runEndedAt via the App-level catch', async () => {
    // Mirrors the real path where `fetch` itself rejects before
    // bulkLookup gets a chance to call onDone — the only case the
    // outer `catch` in handleRun is still needed for.
    useAppStore.setState({ inputText: 'Charizard' })
    mockBulkLookup.mockImplementation(() => {
      setNow(9_000)
      return Promise.reject(new Error('network'))
    })

    renderInSearchMode()
    fireEvent.click(screen.getByRole('button', { name: /look up/i }))

    await waitFor(() => {
      expect(useAppStore.getState().isRunning).toBe(false)
    })
    expect(useAppStore.getState().runEndedAt).toBe(9_000)
  })

  it('does not double-stamp runEndedAt when both onDone and the catch would fire', async () => {
    // Defensive case: if bulkLookup were to both call onDone AND
    // throw (as the real `if (!aborted) throw err` branch does), the
    // outer catch must not overwrite the timestamp onDone stamped.
    useAppStore.setState({ inputText: 'Charizard' })
    mockBulkLookup.mockImplementation(
      (
        _lines: string[],
        _settings: unknown,
        _onEvent: (e: BulkEvent) => void,
        onDone: (aborted: boolean) => void,
      ) => {
        setNow(5_000)
        onDone(false)
        setNow(5_010)
        return Promise.reject(new Error('post-onDone throw'))
      },
    )

    renderInSearchMode()
    fireEvent.click(screen.getByRole('button', { name: /look up/i }))

    await waitFor(() => {
      expect(useAppStore.getState().isRunning).toBe(false)
    })
    // The first stamp (5_000) wins; the catch must NOT overwrite to 5_010.
    expect(useAppStore.getState().runEndedAt).toBe(5_000)
  })
})

describe('App: footer disclosures', () => {
  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    mockBulkLookup.mockReset()
    mockLookupLine.mockReset()
    mockParseLine.mockReset()
  })

  it('discloses the marketplace affiliate relationship in the app footer', () => {
    renderInSearchMode()
    expect(
      screen.getByText(
        /Affiliate disclosure: mgz-pkmn may earn from qualifying purchases through eBay and TCGplayer links\./,
      ),
    ).toBeInTheDocument()
  })
})

describe('App: discovery mode switcher', () => {
  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    mockBulkLookup.mockReset()
    // jsdom doesn't implement scrollIntoView; the Tour highlights its target
    // with it on mount, so stub it for the take-the-tour path.
    Element.prototype.scrollIntoView = vi.fn()
  })

  // The Library panel's tablist now also lives in App, so scope every
  // discovery-mode lookup to the discovery-mode tablist instead of
  // matching on the bare tab name (which would also hit Library's
  // "Searches" tab).
  function discoveryTabs() {
    return within(screen.getByRole('tablist', { name: /Discovery mode/i }))
  }

  it('defaults to Swipe mode and orders the tabs Swipe, Browse, Search', () => {
    render(<App />)
    const tabs = discoveryTabs().getAllByRole('tab')
    // Newcomer-first order matches the Help modal (#792, #814). The first span
    // in each tab is its label (the second is the hint).
    expect(tabs.map((t) => t.querySelector('span')?.textContent)).toEqual([
      'Swipe',
      'Browse',
      'Search',
    ])
    expect(discoveryTabs().getByRole('tab', { name: /Swipe/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Swipe is the landing surface, not the Search editor.
    expect(screen.getByRole('region', { name: /Swipe mode/i })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Card list/i })).not.toBeInTheDocument()
  })

  it('switching to Browse hides the editor and renders the inline browse panel', () => {
    renderInSearchMode()
    fireEvent.click(discoveryTabs().getByRole('tab', { name: /Browse/ }))
    expect(screen.queryByRole('textbox', { name: /Card list/i })).not.toBeInTheDocument()
    // The inline BrowsePanel renders its description and a section
    // wrapper labelled "Browse cards by set".
    expect(screen.getByRole('region', { name: /Browse cards by set/i })).toBeInTheDocument()
    expect(
      screen.getByText(/Pick a set to see every card with its market price/),
    ).toBeInTheDocument()
  })

  it('switching to Swipe mounts the SwipePanel', () => {
    renderInSearchMode()
    fireEvent.click(discoveryTabs().getByRole('tab', { name: /Swipe/ }))
    expect(screen.getByRole('region', { name: /Swipe mode/i })).toBeInTheDocument()
    expect(
      screen.getByText(/One card at a time — right to save/i),
    ).toBeInTheDocument()
  })

  it('surfaces Export in Search mode but not in Browse or Swipe', () => {
    renderInSearchMode()
    // In Search mode, Export lives in the Results section.
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument()

    fireEvent.click(discoveryTabs().getByRole('tab', { name: /Browse/ }))
    expect(screen.queryByRole('button', { name: /Export/i })).not.toBeInTheDocument()

    fireEvent.click(discoveryTabs().getByRole('tab', { name: /Swipe/ }))
    expect(screen.queryByRole('button', { name: /Export/i })).not.toBeInTheDocument()
  })

  it('the tour drives the discovery mode as it advances and restores it on close', async () => {
    renderInSearchMode()
    fireEvent.click(discoveryTabs().getByRole('tab', { name: /Browse/ }))
    expect(discoveryTabs().getByRole('tab', { name: /Browse/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: /Help/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Take the tour/i }))

    // Opens on "Find cards" without disturbing the mode the user was in.
    const tour = within(screen.getByRole('dialog', { name: /Tour:/i }))
    expect(screen.getByText(/Step 1 of/)).toBeInTheDocument()
    expect(discoveryTabs().getByRole('tab', { name: /Browse/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Advancing to the Swipe step switches the app into Swipe.
    fireEvent.click(tour.getByRole('button', { name: /Next/i }))
    expect(discoveryTabs().getByRole('tab', { name: /Swipe/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Closing the tour restores the mode the user started in.
    fireEvent.click(screen.getByRole('button', { name: /Skip tour/i }))
    expect(discoveryTabs().getByRole('tab', { name: /Browse/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('switching back to Search restores the editor without losing input', () => {
    useAppStore.setState({ inputText: 'Charizard | Base Set | 4' })
    renderInSearchMode()
    fireEvent.click(discoveryTabs().getByRole('tab', { name: /Browse/ }))
    fireEvent.click(discoveryTabs().getByRole('tab', { name: /Search/ }))
    const textbox = screen.getByRole('textbox', { name: /Card list/i })
    expect(textbox).toHaveValue('Charizard | Base Set | 4')
  })

  it('rerunning a Recent search from the default Swipe mode surfaces Search', async () => {
    // A run never resolves, so the app stays mid-run while we assert the switch.
    mockBulkLookup.mockImplementation(() => new Promise<void>(() => {}))
    useAppStore.setState({
      recentRuns: [{ id: 'r1', savedAt: Date.now(), lines: ['Charizard'] }],
    })
    render(<App />)
    // Open the Backpack's Recent tab and rerun (the app opens on Swipe, so the
    // results would otherwise stay hidden behind the Swipe panel — #814).
    fireEvent.click(screen.getAllByRole('tab', { name: /Recent/ })[0])
    fireEvent.click(screen.getAllByRole('button', { name: /Rerun search/i })[0])
    await waitFor(() =>
      expect(discoveryTabs().getByRole('tab', { name: /Search/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
  })
})

describe('App: mobile bottom-tab nav (#519)', () => {
  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    mockBulkLookup.mockReset()
  })

  function primaryNav() {
    return within(screen.getByRole('navigation', { name: 'Primary' }))
  }

  it('renders the four labeled destinations in the bottom bar', () => {
    render(<App />)
    for (const label of ['Discover', 'Backpack', 'Insights', 'Account']) {
      expect(primaryNav().getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(primaryNav().getByRole('button', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('the Account tab reveals the account surface; Discover returns to the workspace', () => {
    render(<App />)
    expect(screen.queryByText('Your account')).not.toBeInTheDocument()

    fireEvent.click(primaryNav().getByRole('button', { name: 'Account' }))
    expect(screen.getByText('Your account')).toBeInTheDocument()
    expect(primaryNav().getByRole('button', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    fireEvent.click(primaryNav().getByRole('button', { name: 'Discover' }))
    expect(screen.queryByText('Your account')).not.toBeInTheDocument()
  })

  it('collapses the header utility behind a single More trigger', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })
})
