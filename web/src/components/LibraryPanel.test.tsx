import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryPanel } from './LibraryPanel'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import * as client from '../api/client'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'

// Collapse state now lives in the parent (App auto-collapses the rail on
// entering Search mode, #522 follow-up) — this wrapper stands in for that
// parent so the collapse test can exercise real toggle behavior.
function ControlledSidebar(props: {
  onRun: (overrideText: string) => void
  onShowSearch: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <LibraryPanel variant="sidebar" collapsed={collapsed} onCollapsedChange={setCollapsed} {...props} />
  )
}

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

describe('LibraryPanel', () => {
  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    _resetCollectionsCacheForTests()
    _resetWishlistsCacheForTests()
    vi.spyOn(client, 'fetchMe').mockResolvedValue({
      user: { id: 7, email: 'trainer@example.com', display_name: 'Trainer' },
      authEnabled: true,
    })
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(client, 'fetchCollections').mockResolvedValue([])
    vi.spyOn(client, 'fetchWishlists').mockResolvedValue([])
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sidebar variant renders all three tabs with Searches active', async () => {
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} onShowSearch={vi.fn()} />)
    // Binders is gated on a resolved signed-in user, so wait for the auth
    // load before asserting the full tab set.
    expect(await screen.findByRole('tab', { name: /Binders/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Searches/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: /Recent/i })).toBeInTheDocument()
    expect(await screen.findByText(/No saved searches yet/i)).toBeInTheDocument()
  })

  it('clicking the Recent tab swaps the content', async () => {
    useAppStore.setState({
      recentRuns: [{ id: 'r1', savedAt: 1_700_000_000_000, lines: ['Pikachu'] }],
    })
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} onShowSearch={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: /Recent/i }))

    expect(screen.getByRole('tab', { name: /Recent/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('Pikachu')).toBeInTheDocument()
  })

  it('clicking the Binders tab fetches and shows the empty state', async () => {
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} onShowSearch={vi.fn()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Binders/i }))
    expect(
      await screen.findByText(/You don't have any binders yet/i),
    ).toBeInTheDocument()
  })

  it('sidebar collapse toggles a compact rail and announces state via aria-expanded', async () => {
    render(<ControlledSidebar onRun={vi.fn()} onShowSearch={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/No saved searches yet/i)).toBeInTheDocument(),
    )

    const collapseBtn = screen.getByRole('button', { name: /Collapse Backpack/i })
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapseBtn)

    const expandBtn = screen.getByRole('button', { name: /Expand Backpack/i })
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
  })

  it('accordion variant renders its tabs immediately — the entire dedicated Backpack tab, always expanded (#857 follow-up)', async () => {
    render(<LibraryPanel variant="accordion" onRun={vi.fn()} onShowSearch={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /Backpack/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Searches/i })).toBeInTheDocument()
  })

  it('hides the Binders tab when no user is identified', async () => {
    vi.mocked(client.fetchMe).mockResolvedValue({ user: null, authEnabled: true })
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} onShowSearch={vi.fn()} />)

    expect(
      await screen.findByText(/Sign in to see saved searches/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Searches/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Recent/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Binders/i })).not.toBeInTheDocument()
  })

  it('shows the Binders tab on self-host (authEnabled false)', async () => {
    vi.mocked(client.fetchMe).mockResolvedValue({
      user: { id: 1, email: null, display_name: 'default' },
      authEnabled: false,
    })
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} onShowSearch={vi.fn()} />)

    expect(await screen.findByRole('tab', { name: /Binders/i })).toBeInTheDocument()
  })

  it('does not leak a stale saved-search count when no user is identified', async () => {
    // signOut() clears auth.user but leaves the cached `runs` in zustand;
    // the count surfaces in three places (collapsed sidebar, accordion
    // header, Searches tab badge) and none should display the previous
    // user's value.
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
        {
          id: 2,
          created_at: '2026-06-01T12:00:00Z',
          elapsed_seconds: 1,
          row_count: 1,
          summary: {
            total_rows: 1,
            matched: 1,
            missed: 0,
            priced: 1,
            totals_by_currency: {},
            tag_counts: {},
          },
          name: 'Old',
          view_state: null,
        },
      ],
    })
    render(<LibraryPanel variant="accordion" onRun={vi.fn()} onShowSearch={vi.fn()} />)
    const heading = await screen.findByRole('heading', { name: /Backpack/i })
    // Accordion header — no "(2)" badge for the signed-out visitor.
    expect(heading.textContent ?? '').not.toMatch(/\(2\)/)
  })

  it('Recent re-run threads through to the parent onRun callback', () => {
    const onRun = vi.fn()
    useAppStore.setState({
      recentRuns: [{ id: 'r1', savedAt: 1_700_000_000_000, lines: ['Mew'] }],
    })
    render(<LibraryPanel variant="sidebar" onRun={onRun} onShowSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Recent/i }))

    fireEvent.click(screen.getByRole('button', { name: /Rerun search/i }))
    expect(onRun).toHaveBeenCalledWith('Mew')
  })
})
