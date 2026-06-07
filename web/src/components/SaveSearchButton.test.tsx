import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SaveSearchButton } from './SaveSearchButton'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import * as client from '../api/client'
import type { UseAuthResult } from '../hooks/useAuth'
import type { RunSummary } from '../types'

function makeRun(id: number, name: string | null): RunSummary {
  return {
    id,
    created_at: '2026-06-01T12:00:00Z',
    elapsed_seconds: 1.0,
    row_count: 1,
    summary: {
      total_rows: 1,
      matched: 1,
      missed: 0,
      priced: 1,
      totals_by_currency: { USD: 5 },
      tag_counts: {},
    },
    name,
    view_state: null,
  }
}

const signedInAuth: Pick<UseAuthResult, 'user' | 'authEnabled' | 'loading'> = {
  user: { id: 7, email: 'trainer@example.com', display_name: 'Trainer' },
  authEnabled: true,
  loading: false,
}

const anonymousAuth: Pick<UseAuthResult, 'user' | 'authEnabled' | 'loading'> = {
  user: null,
  authEnabled: true,
  loading: false,
}

describe('SaveSearchButton', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    useAppStore.setState({
      runs: [],
      currentRunId: null,
      viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when there is no currentRunId', () => {
    const { container } = render(<SaveSearchButton auth={signedInAuth} />)
    expect(container.firstChild).toBeNull()
  })

  it('saves the run with the prompted name and the current view state', async () => {
    useAppStore.setState({
      currentRunId: 42,
      viewState: {
        ...EMPTY_VIEW_STATE,
        sortColumn: 'market',
        sortDir: 'desc',
        filters: { ...EMPTY_VIEW_STATE.filters, name: 'pika' },
      },
    })
    const saveSpy = vi.spyOn(client, 'saveRun').mockResolvedValue(makeRun(42, 'Show prep'))
    vi.spyOn(client, 'listRuns').mockResolvedValue({
      items: [makeRun(42, 'Show prep')],
      total: 1,
    })
    vi.spyOn(window, 'prompt').mockReturnValue('Show prep')

    render(<SaveSearchButton auth={signedInAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Save this search/i }))

    await waitFor(() => expect(saveSpy).toHaveBeenCalled())
    expect(saveSpy.mock.calls[0][0]).toBe(42)
    expect(saveSpy.mock.calls[0][1]).toBe('Show prep')
    expect(saveSpy.mock.calls[0][2].sortColumn).toBe('market')
    expect(saveSpy.mock.calls[0][2].filters.name).toBe('pika')
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))
  })

  it('shows an error when the user submits a blank name', async () => {
    useAppStore.setState({ currentRunId: 42 })
    const saveSpy = vi.spyOn(client, 'saveRun').mockResolvedValue(makeRun(42, ''))
    vi.spyOn(window, 'prompt').mockReturnValue('   ')

    render(<SaveSearchButton auth={signedInAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Save this search/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/name is required/i)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('does nothing when the prompt is cancelled', () => {
    useAppStore.setState({ currentRunId: 42 })
    const saveSpy = vi.spyOn(client, 'saveRun')
    vi.spyOn(window, 'prompt').mockReturnValue(null)

    render(<SaveSearchButton auth={signedInAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Save this search/i }))

    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('relabels to Rename when the current run is already in the saved list', () => {
    useAppStore.setState({
      currentRunId: 42,
      runs: [makeRun(42, 'Show prep')],
    })
    render(<SaveSearchButton auth={signedInAuth} />)
    expect(screen.getByRole('button', { name: /Rename this saved search/i })).toBeInTheDocument()
  })

  it('opens the sign-in picker instead of saving immediately for an anonymous auth-on user', async () => {
    useAppStore.setState({ currentRunId: 42 })
    const saveSpy = vi.spyOn(client, 'saveRun').mockResolvedValue(makeRun(42, 'Show prep'))
    vi.spyOn(window, 'prompt').mockReturnValue('Show prep')

    render(<SaveSearchButton auth={anonymousAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Sign in to save this search/i }))

    expect(await screen.findByRole('dialog', { name: /Sign in to save this search/i })).toBeInTheDocument()
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('resumes the pending save with the originally prompted name after sign-in', async () => {
    useAppStore.setState({ currentRunId: 42 })
    const saveSpy = vi.spyOn(client, 'saveRun').mockResolvedValue(makeRun(42, 'Show prep'))
    vi.spyOn(client, 'listRuns').mockResolvedValue({
      items: [makeRun(42, 'Show prep')],
      total: 1,
    })
    vi.spyOn(window, 'prompt').mockReturnValue('Show prep')

    const { rerender } = render(<SaveSearchButton auth={anonymousAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Sign in to save this search/i }))
    await screen.findByRole('dialog', { name: /Sign in to save this search/i })

    rerender(<SaveSearchButton auth={signedInAuth} />)

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(42, 'Show prep', expect.any(Object)))
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
