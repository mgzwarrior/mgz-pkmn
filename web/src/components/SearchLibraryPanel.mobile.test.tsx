/**
 * SearchLibraryPanel's mobile disclosure (#868) — a separate file so the
 * `matchMedia` stub can report a mobile viewport for every test here
 * without disturbing the desktop-default assumptions in
 * SearchLibraryPanel.test.tsx. Mirrors ResultsTable.mobile.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchLibraryPanel } from './SearchLibraryPanel'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import * as client from '../api/client'
import { _resetAuthStoreForTests } from '../hooks/useAuth'

const realMatchMedia = window.matchMedia

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
  useAppStore.setState({
    runs: [],
    recentRuns: [{ id: 'r1', savedAt: 1_700_000_000_000, lines: ['Pikachu'] }],
    viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
  })
  _resetAuthStoreForTests()
  vi.spyOn(client, 'fetchMe').mockResolvedValue({
    user: { id: 7, email: 'trainer@example.com', display_name: 'Trainer' },
    authEnabled: true,
  })
  vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [], total: 0 })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.matchMedia = realMatchMedia
})

describe('SearchLibraryPanel (mobile viewport)', () => {
  it('starts collapsed to a disclosure row so results stay one scroll away', () => {
    render(<SearchLibraryPanel onRun={vi.fn()} onShowSearch={vi.fn()} />)
    const disclosure = screen.getByRole('button', { name: /Saved & recent/i })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('expands on tap, revealing the Searches / Recent tabs', () => {
    render(<SearchLibraryPanel onRun={vi.fn()} onShowSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Saved & recent/i }))

    expect(screen.getByRole('button', { name: /Saved & recent/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('tab', { name: /Searches/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Recent/i }))
    expect(screen.getByText('Pikachu')).toBeInTheDocument()
  })
})
