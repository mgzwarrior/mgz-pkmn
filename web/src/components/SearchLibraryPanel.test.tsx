import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchLibraryPanel } from './SearchLibraryPanel'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import * as client from '../api/client'
import { _resetAuthStoreForTests } from '../hooks/useAuth'

function resetStore() {
  useAppStore.setState({
    runs: [],
    currentRunId: null,
    inputText: '',
    rows: [],
    isRunning: false,
    progress: null,
    processingLines: [],
    runStartedAt: null,
    runEndedAt: null,
    recentRuns: [],
    viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
  })
}

describe('SearchLibraryPanel', () => {
  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    vi.spyOn(client, 'fetchMe').mockResolvedValue({
      user: { id: 7, email: 'trainer@example.com', display_name: 'Trainer' },
      authEnabled: true,
    })
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [], total: 0 })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders Searches and Recent tabs with Searches active (desktop: expanded)', async () => {
    render(<SearchLibraryPanel onRun={vi.fn()} onShowSearch={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /Searches/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: /Recent/i })).toBeInTheDocument()
    expect(await screen.findByText(/No saved searches yet/i)).toBeInTheDocument()
  })

  it('clicking the Recent tab swaps the content', () => {
    useAppStore.setState({
      recentRuns: [{ id: 'r1', savedAt: 1_700_000_000_000, lines: ['Pikachu'] }],
    })
    render(<SearchLibraryPanel onRun={vi.fn()} onShowSearch={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: /Recent/i }))

    expect(screen.getByRole('tab', { name: /Recent/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('Pikachu')).toBeInTheDocument()
  })

  it('Recent re-run threads through to the parent onRun callback', () => {
    const onRun = vi.fn()
    useAppStore.setState({
      recentRuns: [{ id: 'r1', savedAt: 1_700_000_000_000, lines: ['Mew'] }],
    })
    render(<SearchLibraryPanel onRun={onRun} onShowSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Recent/i }))

    fireEvent.click(screen.getByRole('button', { name: /Rerun search/i }))
    expect(onRun).toHaveBeenCalledWith('Mew')
  })

  it('prompts sign-in on the Searches tab when no user is identified', async () => {
    vi.mocked(client.fetchMe).mockResolvedValue({ user: null, authEnabled: true })
    render(<SearchLibraryPanel onRun={vi.fn()} onShowSearch={vi.fn()} />)

    expect(
      await screen.findByText(/Sign in to see saved searches/i),
    ).toBeInTheDocument()
  })

  it('does not leak a stale saved-search count in the tab badge when signed out', async () => {
    // signOut() clears auth.user but leaves the cached `runs` in zustand —
    // the Searches tab badge must not display the previous user's count.
    vi.mocked(client.fetchMe).mockResolvedValue({ user: null, authEnabled: true })
    useAppStore.setState({
      runs: [
        {
          id: 1,
          created_at: '2026-06-01T12:00:00Z',
          elapsed_seconds: 1,
          row_count: 3,
          summary: {
            total_rows: 3,
            matched: 2,
            missed: 1,
            priced: 2,
            totals_by_currency: {},
            tag_counts: {},
          },
          name: 'Stale',
          view_state: null,
        },
      ],
    })
    render(<SearchLibraryPanel onRun={vi.fn()} onShowSearch={vi.fn()} />)
    const searchesTab = await screen.findByRole('tab', { name: /Searches/i })
    expect(searchesTab.textContent ?? '').not.toMatch(/1/)
  })
})
