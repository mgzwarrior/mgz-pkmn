import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ResultsEmptyState } from './ResultsEmptyState'
import { useAppStore } from '../store'
import * as client from '../api/client'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import type { RunDetail, RunRowDetail, RunSummary } from '../types'

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
      totals_by_currency: {},
      tag_counts: {},
    },
    name: `Saved ${id}`,
    view_state: null,
    ...overrides,
  }
}

function makeDetail(id: number): RunDetail {
  const row: RunRowDetail = {
    position: 0,
    tag: '',
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
    input_text: 'Charizard',
    summary: makeRun(id).summary,
    rows: [row],
    name: `Saved ${id}`,
    view_state: null,
  }
}

function resetStore() {
  useAppStore.setState({ runs: [], inputText: '', rows: [], currentRunId: null })
}

describe('ResultsEmptyState', () => {
  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    vi.spyOn(client, 'fetchMe').mockResolvedValue({ user: null, authEnabled: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the base empty-state message', () => {
    render(<ResultsEmptyState />)
    expect(screen.getByText(/results will appear here/i)).toBeInTheDocument()
  })

  it('renders example query chips and a Walk a set entry when onRun/onBrowse are provided', () => {
    render(<ResultsEmptyState onRun={vi.fn()} onBrowse={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'All Charizard cards | Base Set' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /walk a set/i })).toBeInTheDocument()
  })

  it('omits the try-a-query section entirely when no callbacks are passed', () => {
    render(<ResultsEmptyState />)
    expect(screen.queryByText(/try a query/i)).not.toBeInTheDocument()
  })

  it('clicking an example chip calls onRun with that query', () => {
    const onRun = vi.fn()
    render(<ResultsEmptyState onRun={onRun} onBrowse={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'top:5 Charizard cards' }))
    expect(onRun).toHaveBeenCalledWith('top:5 Charizard cards')
  })

  it('clicking Walk a set calls onBrowse', () => {
    const onBrowse = vi.fn()
    render(<ResultsEmptyState onRun={vi.fn()} onBrowse={onBrowse} />)
    fireEvent.click(screen.getByRole('button', { name: /walk a set/i }))
    expect(onBrowse).toHaveBeenCalled()
  })

  it('hides the saved-searches section when signed out, even with runs cached', () => {
    useAppStore.setState({ runs: [makeRun(1, { name: 'Show prep' })] })
    render(<ResultsEmptyState />)
    expect(screen.queryByText(/your saved searches/i)).not.toBeInTheDocument()
  })

  it('shows up to three saved searches when signed in', async () => {
    vi.mocked(client.fetchMe).mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })
    useAppStore.setState({
      runs: [
        makeRun(1, { name: 'First' }),
        makeRun(2, { name: 'Second' }),
        makeRun(3, { name: 'Third' }),
        makeRun(4, { name: 'Fourth' }),
      ],
    })
    render(<ResultsEmptyState />)
    expect(await screen.findByText(/your saved searches/i)).toBeInTheDocument()
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
    expect(screen.queryByText('Fourth')).not.toBeInTheDocument()
  })

  it('clicking a saved search hydrates the store from getRun', async () => {
    vi.mocked(client.fetchMe).mockResolvedValue({
      user: { id: 1, email: 'u@e.com', display_name: 'U' },
      authEnabled: true,
    })
    useAppStore.setState({ runs: [makeRun(7, { name: 'Show prep' })] })
    vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(7))
    render(<ResultsEmptyState />)

    fireEvent.click(await screen.findByRole('button', { name: /Show prep/i }))

    await waitFor(() => expect(useAppStore.getState().currentRunId).toBe(7))
    expect(useAppStore.getState().inputText).toBe('Charizard')
    expect(useAppStore.getState().rows).toHaveLength(1)
  })
})
