import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { LibrarySearchesTab } from './LibrarySearchesTab'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import * as client from '../api/client'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import type { RunDetail, RunRowDetail, RunSummary, SavedViewState } from '../types'

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
    name: `Saved ${id}`,
    view_state: null,
    ...overrides,
  }
}

function makeDetail(id: number, viewState: SavedViewState | null = null): RunDetail {
  const row: RunRowDetail = {
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
  }
  return {
    id,
    created_at: '2026-06-01T12:00:00Z',
    elapsed_seconds: 1.2,
    input_text: 'Charizard\nPikachu',
    summary: makeRun(id).summary,
    rows: [row],
    name: `Saved ${id}`,
    view_state: viewState,
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
    viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
  })
}

describe('LibrarySearchesTab', () => {
  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    vi.spyOn(client, 'fetchMe').mockResolvedValue({
      user: { id: 7, email: 'trainer@example.com', display_name: 'Trainer' },
      authEnabled: true,
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the empty state when there are no saved searches', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [], total: 0 })
    render(<LibrarySearchesTab />)
    expect(await screen.findByText(/No saved searches yet/i)).toBeInTheDocument()
  })

  it('does not call the runs list while signed out on an auth-enabled deploy', async () => {
    vi.mocked(client.fetchMe).mockResolvedValue({
      user: null,
      authEnabled: true,
    })
    const listSpy = vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [], total: 0 })

    render(<LibrarySearchesTab />)

    expect(await screen.findByText(/Sign in to see saved searches/i)).toBeInTheDocument()
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('lists saved searches from the API with name + tag breakdown', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({
      items: [makeRun(1, { name: 'Show prep' }), makeRun(2, { name: 'Wishlist', row_count: 5 })],
      total: 2,
    })
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(2))
    expect(screen.getByText('Show prep')).toBeInTheDocument()
    expect(screen.getByText('Wishlist')).toBeInTheDocument()
    expect(screen.getAllByText('keep ×2')).toHaveLength(2)
    expect(screen.getAllByText('trade ×1')).toHaveLength(2)
  })

  it('clicking a saved search loads input + rows and restores view_state', async () => {
    const savedView: SavedViewState = {
      sortColumn: 'market',
      sortDir: 'desc',
      showFilters: true,
      filters: {
        name: '',
        set: '',
        rarity: 'Rare',
        marketMin: '',
        marketMax: '',
        source: '',
      },
    }
    vi.spyOn(client, 'listRuns').mockResolvedValue({
      items: [makeRun(7, { view_state: savedView })],
      total: 1,
    })
    vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(7, savedView))
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Load saved search/i }))

    await waitFor(() => expect(useAppStore.getState().currentRunId).toBe(7))
    expect(useAppStore.getState().inputText).toBe('Charizard\nPikachu')
    expect(useAppStore.getState().rows).toHaveLength(1)
    expect(useAppStore.getState().viewState).toEqual(savedView)
  })

  it('falls back to the empty view when a saved search has no stored view_state', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(7)], total: 1 })
    vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(7, null))
    useAppStore.setState({
      viewState: {
        ...EMPTY_VIEW_STATE,
        sortColumn: 'name',
        sortDir: 'asc',
        filters: { ...EMPTY_VIEW_STATE.filters, name: 'pika' },
      },
    })
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Load saved search/i }))
    await waitFor(() => expect(useAppStore.getState().currentRunId).toBe(7))
    expect(useAppStore.getState().viewState).toEqual(EMPTY_VIEW_STATE)
  })

  it('hydrating a saved search clears ephemeral progress + timer state', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(7)], total: 1 })
    vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(7))
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Load saved search/i }))
    await waitFor(() => expect(useAppStore.getState().currentRunId).toBe(7))

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
          setTimeout(() => resolve(makeDetail(id)), 10)
        }),
    )
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(2))

    const [first, second] = screen.getAllByRole('button', { name: /Load saved search/i })
    fireEvent.click(first)
    fireEvent.click(second)

    await waitFor(() => expect(useAppStore.getState().currentRunId).not.toBeNull())
    expect(getSpy).toHaveBeenCalledTimes(1)
  })

  it('load is blocked while a lookup is in flight', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(7)], total: 1 })
    const getSpy = vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(7))
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))
    await act(async () => {
      useAppStore.setState({ isRunning: true })
    })

    const loadBtn = screen.getByRole('button', { name: /Load saved search/i })
    expect(loadBtn).toBeDisabled()
    fireEvent.click(loadBtn)
    expect(getSpy).not.toHaveBeenCalled()
  })

  it('surfaces the listRuns error', async () => {
    vi.spyOn(client, 'listRuns').mockRejectedValue(new Error('boom'))
    render(<LibrarySearchesTab />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  it('deletes a saved search after a two-step confirm and optimistically removes it', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({
      items: [makeRun(1, { name: 'Keep me' }), makeRun(2, { name: 'Trash me' })],
      total: 2,
    })
    const deleteSpy = vi.spyOn(client, 'deleteRun').mockResolvedValue(undefined)
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(2))

    // First click reveals confirm rather than deleting.
    fireEvent.click(screen.getByRole('button', { name: /Delete saved search Trash me/i }))
    expect(deleteSpy).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', { name: /Confirm delete saved search Trash me/i }),
    )
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(2))
    await waitFor(() => expect(useAppStore.getState().runs.map((r) => r.id)).toEqual([1]))
    expect(screen.queryByText('Trash me')).not.toBeInTheDocument()
  })

  it('cancelling the confirm leaves the saved search in place', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(1, { name: 'Keep me' })], total: 1 })
    const deleteSpy = vi.spyOn(client, 'deleteRun').mockResolvedValue(undefined)
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Delete saved search Keep me/i }))
    fireEvent.click(screen.getByRole('button', { name: /Cancel delete/i }))

    expect(deleteSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Keep me')).toBeInTheDocument()
  })

  it('restores the row and surfaces an error when delete fails', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(3, { name: 'Oops' })], total: 1 })
    vi.spyOn(client, 'deleteRun').mockRejectedValue(new Error('nope'))
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Delete saved search Oops/i }))
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete saved search Oops/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
    // Rolled back — the run is still listed.
    await waitFor(() => expect(useAppStore.getState().runs.map((r) => r.id)).toEqual([3]))
  })

  it('clears currentRunId when the deleted run was loaded', async () => {
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [makeRun(5, { name: 'Active' })], total: 1 })
    vi.spyOn(client, 'deleteRun').mockResolvedValue(undefined)
    render(<LibrarySearchesTab />)
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))
    act(() => {
      useAppStore.setState({ currentRunId: 5 })
    })

    fireEvent.click(screen.getByRole('button', { name: /Delete saved search Active/i }))
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete saved search Active/i }))

    await waitFor(() => expect(useAppStore.getState().currentRunId).toBeNull())
  })
})
