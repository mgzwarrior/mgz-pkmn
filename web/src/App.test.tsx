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
import { render, fireEvent, act, screen, waitFor } from '@testing-library/react'
import App from './App'
import { useAppStore } from './store'
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
  // Other client functions are referenced by ExportBar / SetPickerModal
  // mounted inside App; stub them to keep render happy. Names must
  // match the real `client.ts` exports — `fetchSets`, not
  // `fetchSetCatalog`.
  exportFile: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
  fetchSets: vi.fn(() => Promise.resolve([])),
  setLogoUrl: vi.fn(() => ''),
  dedupeRows: vi.fn((rows: unknown[]) => rows),
  addOverride: vi.fn(),
  // Referenced by the WhatsNewModal mounted in the header.
  fetchChangelog: vi.fn(() => Promise.resolve([])),
  // SignInChip mounts on App render and calls `fetchMe` on mount;
  // stub to "anonymous" so the chip resolves to its signed-out shape
  // without a real HTTP round-trip.
  fetchMe: vi.fn(() => Promise.resolve(null)),
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
  })
  useAppStore.getState().resetSettings()
}

describe('App: bulk-run timestamp lifecycle', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>
  let currentTime = 0
  const setNow = (t: number) => {
    currentTime = t
  }

  beforeEach(() => {
    resetStore()
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

    render(<App />)
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

    render(<App />)
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

  it('a bulkLookup network rejection without onDone still stamps runEndedAt via the App-level catch', async () => {
    // Mirrors the real path where `fetch` itself rejects before
    // bulkLookup gets a chance to call onDone — the only case the
    // outer `catch` in handleRun is still needed for.
    useAppStore.setState({ inputText: 'Charizard' })
    mockBulkLookup.mockImplementation(() => {
      setNow(9_000)
      return Promise.reject(new Error('network'))
    })

    render(<App />)
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

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /look up/i }))

    await waitFor(() => {
      expect(useAppStore.getState().isRunning).toBe(false)
    })
    // The first stamp (5_000) wins; the catch must NOT overwrite to 5_010.
    expect(useAppStore.getState().runEndedAt).toBe(5_000)
  })
})

describe('App: discovery mode switcher', () => {
  beforeEach(() => {
    resetStore()
    mockBulkLookup.mockReset()
  })

  it('defaults to Search mode and shows the card-list editor', () => {
    render(<App />)
    const searchTab = screen.getByRole('tab', { name: /Search/ })
    expect(searchTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: /Card list/i })).toBeInTheDocument()
  })

  it('switching to Browse hides the editor and renders the inline browse panel', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /Browse/ }))
    expect(screen.queryByRole('textbox', { name: /Card list/i })).not.toBeInTheDocument()
    // The inline BrowsePanel renders its description and a section
    // wrapper labelled "Browse cards by set".
    expect(screen.getByRole('region', { name: /Browse cards by set/i })).toBeInTheDocument()
    expect(
      screen.getByText(/Pick a set to see every card with its market price/),
    ).toBeInTheDocument()
  })

  it('switching to Swipe shows the placeholder copy', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /Swipe/ }))
    expect(screen.getByText(/Swipe mode is coming/i)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Track progress on issue #340/i }),
    ).toBeInTheDocument()
  })

  it('switching back to Search restores the editor without losing input', () => {
    useAppStore.setState({ inputText: 'Charizard | Base Set | 4' })
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /Browse/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Search/ }))
    const textbox = screen.getByRole('textbox', { name: /Card list/i })
    expect(textbox).toHaveValue('Charizard | Base Set | 4')
  })
})
