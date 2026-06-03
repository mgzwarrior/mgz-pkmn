import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { RunHistorySidebar } from './RunHistorySidebar'
import { useAppStore } from '../store'
import * as client from '../api/client'
import type { RunDetail, RunSummary } from '../types'

function makeRun(id: number, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id,
    created_at: '2026-06-01T12:00:00Z',
    elapsed_seconds: 1.2,
    row_count: 3,
    summary: {
      total_rows: 3,
      matched: 2,
      missed: 1,
      priced: 2,
      totals_by_currency: { USD: 12.5 },
      tag_counts: { keep: 2, trade: 1 },
    },
    ...overrides,
  }
}

function makeDetail(id: number): RunDetail {
  return {
    id,
    created_at: '2026-06-01T12:00:00Z',
    elapsed_seconds: 1.2,
    input_text: 'Charizard\nPikachu',
    summary: makeRun(id).summary,
    rows: [
      {
        position: 0,
        tag: 'keep',
        market_price: 10,
        currency: 'USD',
        query: {
          raw: 'Charizard',
          name: 'Charizard',
          set_hint: null,
          number: null,
          variant_hint: null,
          url_hint: null,
          bulk_top: null,
          bulk_all: false,
          price_min: null,
          price_max: null,
        },
        card: { id: 'card-1', name: 'Charizard' },
        pricing: { market: 10, variant: null, source: null, url: null, currency: 'USD' },
      },
    ],
  }
}

function resetStore() {
  useAppStore.setState({
    runs: [],
    currentRunId: null,
    inputText: '',
    rows: [],
    isRunning: false,
    progress: { done: 5, total: 10 },
    processingLines: [{ line: 'stale', status: 'pending' }],
    runStartedAt: 1_700_000_000_000,
    runEndedAt: 1_700_000_001_000,
  })
}

describe('RunHistorySidebar', () => {
  beforeEach(resetStore)
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the empty state when there are no saved runs', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [], total: 0 })
    render(<RunHistorySidebar />)
    expect(await screen.findByText(/No saved runs yet/i)).toBeInTheDocument()
  })

  it('lists runs from the API with tag breakdown', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({
      items: [makeRun(1), makeRun(2, { row_count: 5 })],
      total: 2,
    })
    render(<RunHistorySidebar />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(2))
    // Both rows share the same tag counts (fixture default), so the
    // chip text appears twice — `getAllByText` rather than `getByText`.
    expect(screen.getAllByText('keep ×2')).toHaveLength(2)
    expect(screen.getAllByText('trade ×1')).toHaveLength(2)
  })

  it('clicking a run loads input + rows into the store and marks current', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(7)], total: 1 })
    vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(7))
    render(<RunHistorySidebar />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Load run/i }))

    await waitFor(() => expect(useAppStore.getState().currentRunId).toBe(7))
    expect(useAppStore.getState().inputText).toBe('Charizard\nPikachu')
    expect(useAppStore.getState().rows).toHaveLength(1)
    expect(useAppStore.getState().rows[0]?.matched).toBe(true)
  })

  it('hydrating a saved run clears ephemeral progress + timer state', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(7)], total: 1 })
    vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(7))
    render(<RunHistorySidebar />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Load run/i }))
    await waitFor(() => expect(useAppStore.getState().currentRunId).toBe(7))

    // ProcessingQueue + LookupTimer read these; leaving them set would
    // show stale progress and a stale elapsed value after the hydrate.
    expect(useAppStore.getState().progress).toBeNull()
    expect(useAppStore.getState().processingLines).toEqual([])
    expect(useAppStore.getState().runStartedAt).toBeNull()
    expect(useAppStore.getState().runEndedAt).toBeNull()
  })

  it('rapid clicks on different runs do not race — only the first lands', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({
      items: [makeRun(7), makeRun(8)],
      total: 2,
    })
    const getSpy = vi.spyOn(client, 'getRun').mockImplementation(
      (id) =>
        new Promise((resolve) => {
          // Resolve asynchronously so the second click happens while the
          // first request is still in flight.
          setTimeout(() => resolve(makeDetail(id)), 10)
        }),
    )
    render(<RunHistorySidebar />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(2))

    const [first, second] = screen.getAllByRole('button', { name: /Load run/i })
    fireEvent.click(first)
    fireEvent.click(second)

    await waitFor(() => expect(useAppStore.getState().currentRunId).not.toBeNull())
    // Only one getRun call should have fired — the second click was
    // blocked by the in-flight guard.
    expect(getSpy).toHaveBeenCalledTimes(1)
  })

  it('re-export action calls exportRun for the run', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(7)], total: 1 })
    const exportSpy = vi.spyOn(client, 'exportRun').mockResolvedValue()
    render(<RunHistorySidebar />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Re-export run 7/i }))
    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith(7, 'xlsx'))
  })

  it('rerun is blocked while a lookup is in flight', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(7)], total: 1 })
    const getSpy = vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(7))
    render(<RunHistorySidebar />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))
    // Flush the isRunning flip through React so the component's
    // captured `isRunning` closure (via useCallback dep) updates
    // before we dispatch the click.
    await act(async () => {
      useAppStore.setState({ isRunning: true })
    })

    const loadBtn = screen.getByRole('button', { name: /Load run/i })
    expect(loadBtn).toBeDisabled()
    fireEvent.click(loadBtn)
    expect(getSpy).not.toHaveBeenCalled()
  })

  it('collapse button toggles a compact rail and announces state via aria-expanded', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(1)], total: 1 })
    render(<RunHistorySidebar />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    const collapseBtn = screen.getByRole('button', { name: /Collapse run history/i })
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapseBtn)

    const expandBtn = screen.getByRole('button', { name: /Expand run history/i })
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
  })

  it('surfaces the listRuns error', async () => {
    vi.spyOn(client, 'listRuns').mockRejectedValue(new Error('boom'))
    render(<RunHistorySidebar />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})
