import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryPanel } from './LibraryPanel'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import * as client from '../api/client'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import { _resetCollectionsCacheForTests } from './useCollections'
import { _resetWishlistsCacheForTests } from './useWishlists'

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

  it('sidebar variant renders all four tabs with Searches active', async () => {
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /Searches/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: /Recent/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Collections/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Wishlists/i })).toBeInTheDocument()
    expect(await screen.findByText(/No saved searches yet/i)).toBeInTheDocument()
  })

  it('clicking the Recent tab swaps the content', async () => {
    useAppStore.setState({
      recentRuns: [{ id: 'r1', savedAt: 1_700_000_000_000, lines: ['Pikachu'] }],
    })
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: /Recent/i }))

    expect(screen.getByRole('tab', { name: /Recent/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('Pikachu')).toBeInTheDocument()
  })

  it('clicking the Collections tab fetches and shows the empty state', async () => {
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Collections/i }))
    expect(
      await screen.findByText(/You don't have any collections yet/i),
    ).toBeInTheDocument()
  })

  it('clicking the Wishlists tab fetches and shows the empty state', async () => {
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Wishlists/i }))
    expect(
      await screen.findByText(/You don't have any wishlists yet/i),
    ).toBeInTheDocument()
  })

  it('sidebar collapse toggles a compact rail and announces state via aria-expanded', async () => {
    render(<LibraryPanel variant="sidebar" onRun={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/No saved searches yet/i)).toBeInTheDocument(),
    )

    const collapseBtn = screen.getByRole('button', { name: /Collapse Library/i })
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapseBtn)

    const expandBtn = screen.getByRole('button', { name: /Expand Library/i })
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
  })

  it('accordion variant is collapsed by default and tabs are hidden until expanded', async () => {
    render(<LibraryPanel variant="accordion" onRun={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /Library/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: /Searches/i })).not.toBeInTheDocument()

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: /Searches/i })).toBeInTheDocument()
  })

  it('Recent re-run threads through to the parent onRun callback', () => {
    const onRun = vi.fn()
    useAppStore.setState({
      recentRuns: [{ id: 'r1', savedAt: 1_700_000_000_000, lines: ['Mew'] }],
    })
    render(<LibraryPanel variant="sidebar" onRun={onRun} />)
    fireEvent.click(screen.getByRole('tab', { name: /Recent/i }))

    fireEvent.click(screen.getByRole('button', { name: /Rerun search/i }))
    expect(onRun).toHaveBeenCalledWith('Mew')
  })
})
