import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LibraryPanel } from './LibraryPanel'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import * as client from '../api/client'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'

// Collapse state lives in the parent (App auto-collapses the rail on
// entering Search mode, #522 follow-up) — this wrapper stands in for that
// parent so the collapse test can exercise real toggle behavior.
function ControlledSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  return <LibraryPanel variant="sidebar" collapsed={collapsed} onCollapsedChange={setCollapsed} />
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
    vi.spyOn(client, 'fetchCollections').mockResolvedValue([])
    vi.spyOn(client, 'fetchWishlists').mockResolvedValue([])
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sidebar variant renders the binders directly — no tab strip (#868)', async () => {
    render(<LibraryPanel variant="sidebar" />)
    expect(
      await screen.findByText(/You don't have any binders yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('sidebar collapse toggles a compact rail and announces state via aria-expanded', async () => {
    render(<ControlledSidebar />)
    expect(
      await screen.findByText(/You don't have any binders yet/i),
    ).toBeInTheDocument()

    const collapseBtn = screen.getByRole('button', { name: /Collapse Backpack/i })
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapseBtn)

    const expandBtn = screen.getByRole('button', { name: /Expand Backpack/i })
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
  })

  it('accordion variant renders the binders immediately — the entire dedicated Backpack tab', async () => {
    render(<LibraryPanel variant="accordion" />)
    expect(screen.getByRole('heading', { name: /Backpack/i })).toBeInTheDocument()
    expect(
      await screen.findByText(/You don't have any binders yet/i),
    ).toBeInTheDocument()
  })

  it('shows a sign-in nudge instead of binders when no user is identified', async () => {
    vi.mocked(client.fetchMe).mockResolvedValue({ user: null, authEnabled: true })
    render(<LibraryPanel variant="sidebar" />)

    expect(await screen.findByText(/Sign in to build binders/i)).toBeInTheDocument()
    expect(screen.queryByText(/You don't have any binders yet/i)).not.toBeInTheDocument()
  })

  it('shows binders on self-host (authEnabled false)', async () => {
    vi.mocked(client.fetchMe).mockResolvedValue({
      user: { id: 1, email: null, display_name: 'default' },
      authEnabled: false,
    })
    render(<LibraryPanel variant="sidebar" />)

    expect(
      await screen.findByText(/You don't have any binders yet/i),
    ).toBeInTheDocument()
  })
})
