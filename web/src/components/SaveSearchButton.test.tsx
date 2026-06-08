import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

  it('opens the design-system name dialog and saves with the current view state', async () => {
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

    render(<SaveSearchButton auth={signedInAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Save this search/i }))

    const dialog = await screen.findByRole('dialog', { name: /Name this saved search/i })
    const input = within(dialog).getByLabelText(/Search name/i)
    fireEvent.change(input, { target: { value: 'Show prep' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(saveSpy).toHaveBeenCalled())
    expect(saveSpy.mock.calls[0][0]).toBe(42)
    expect(saveSpy.mock.calls[0][1]).toBe('Show prep')
    expect(saveSpy.mock.calls[0][2].sortColumn).toBe('market')
    expect(saveSpy.mock.calls[0][2].filters.name).toBe('pika')
    await waitFor(() => expect(useAppStore.getState().runs).toHaveLength(1))
  })

  it('shows an inline error inside the dialog when the name is blank', async () => {
    useAppStore.setState({ currentRunId: 42 })
    const saveSpy = vi.spyOn(client, 'saveRun').mockResolvedValue(makeRun(42, ''))

    render(<SaveSearchButton auth={signedInAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Save this search/i }))

    const dialog = await screen.findByRole('dialog', { name: /Name this saved search/i })
    fireEvent.change(within(dialog).getByLabelText(/Search name/i), { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/ }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/name is required/i)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('closes the dialog without saving when the user cancels', async () => {
    useAppStore.setState({ currentRunId: 42 })
    const saveSpy = vi.spyOn(client, 'saveRun')

    render(<SaveSearchButton auth={signedInAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Save this search/i }))

    const dialog = await screen.findByRole('dialog', { name: /Name this saved search/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/ }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Name this saved search/i })).not.toBeInTheDocument())
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('relabels to Rename when the current run is already in the saved list', async () => {
    useAppStore.setState({
      currentRunId: 42,
      runs: [makeRun(42, 'Show prep')],
    })
    render(<SaveSearchButton auth={signedInAuth} />)
    expect(screen.getByRole('button', { name: /Rename this saved search/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Rename this saved search/i }))
    const dialog = await screen.findByRole('dialog', { name: /Rename this saved search/i })
    // Pre-filled with the existing name so the visitor can edit instead
    // of retyping from scratch.
    expect(within(dialog).getByLabelText(/Search name/i)).toHaveValue('Show prep')
  })

  it('opens the auth picker immediately (no name prompt) for an anonymous auth-on user', async () => {
    useAppStore.setState({ currentRunId: 42 })
    const saveSpy = vi.spyOn(client, 'saveRun').mockResolvedValue(makeRun(42, 'Show prep'))

    render(<SaveSearchButton auth={anonymousAuth} />)
    fireEvent.click(screen.getByRole('button', { name: /Sign in to save this search/i }))

    // Auth modal opens immediately — no name dialog appears first.
    expect(await screen.findByRole('dialog', { name: /Sign in to save this search/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /Name this saved search/i })).not.toBeInTheDocument()
    expect(saveSpy).not.toHaveBeenCalled()
    // Run identifier + view state are stashed for the post-redirect handoff.
    const pending = window.sessionStorage.getItem('mgz-pkmn:pending-save-search')
    expect(pending).not.toBeNull()
    expect(JSON.parse(pending as string)).toMatchObject({ runId: 42 })
  })
})
