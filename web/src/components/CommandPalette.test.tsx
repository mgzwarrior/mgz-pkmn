/**
 * CommandPalette (#525) — covers the `Cmd/Ctrl+K` hotkey (including that it
 * fires even while another input is focused, unlike the app's other global
 * shortcuts), the four command groups, keyboard navigation, and the
 * recent-commands-first ordering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { CommandPalette } from './CommandPalette'
import { EMPTY_VIEW_STATE, useAppStore } from '../store'
import { _resetAuthStoreForTests } from '../hooks/useAuth'
import * as client from '../api/client'
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
    input_text: 'Charizard',
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
    progress: null,
    processingLines: [],
    runStartedAt: null,
    runEndedAt: null,
    viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
    settings: { ...useAppStore.getState().settings },
  })
}

function noop() {
  /* no-op */
}

function renderPalette(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  return render(
    <CommandPalette
      mode="swipe"
      onSetMode={noop}
      onOpenSettings={noop}
      onOpenHelp={noop}
      onOpenLibrary={noop}
      {...overrides}
    />,
  )
}

function openPalette() {
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
}

describe('CommandPalette (#525)', () => {
  beforeEach(() => {
    resetStore()
    _resetAuthStoreForTests()
    vi.spyOn(client, 'fetchMe').mockResolvedValue({
      user: { id: 7, email: 'trainer@example.com', display_name: 'Trainer' },
      authEnabled: true,
    })
    vi.spyOn(client, 'listRuns').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(client, 'exportFile').mockResolvedValue(undefined)
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens on Cmd+K / Ctrl+K and closes on Escape', () => {
    renderPalette()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    openPalette()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens even while another input is focused — the shortcut requires the modifier, so it never collides with typing', () => {
    render(
      <div>
        <input aria-label="Card list" />
        <CommandPalette mode="search" onSetMode={noop} onOpenSettings={noop} onOpenHelp={noop} onOpenLibrary={noop} />
      </div>,
    )
    screen.getByLabelText('Card list').focus()
    expect(document.activeElement).toBe(screen.getByLabelText('Card list'))

    fireEvent.keyDown(screen.getByLabelText('Card list'), { key: 'k', metaKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('lists the Switch mode commands and invoking one calls onSetMode and closes', () => {
    const onSetMode = vi.fn()
    renderPalette({ onSetMode })
    openPalette()

    fireEvent.click(screen.getByRole('option', { name: /^Browse$/ }))
    expect(onSetMode).toHaveBeenCalledWith('browse')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('flags the current mode with a "Current" hint', () => {
    renderPalette({ mode: 'browse' })
    openPalette()
    const option = screen.getByRole('option', { name: /Browse/ })
    expect(within(option).getByText('Current')).toBeInTheDocument()
  })

  it('lists saved searches under "Jump to a saved search" and loads one on select', async () => {
    useAppStore.setState({ runs: [makeRun(1, { name: 'My Charizards' })] })
    vi.spyOn(client, 'getRun').mockResolvedValue(makeDetail(1))
    const onSetMode = vi.fn()
    renderPalette({ onSetMode })
    openPalette()

    await waitFor(() => screen.getByRole('option', { name: /My Charizards/ }))
    fireEvent.click(screen.getByRole('option', { name: /My Charizards/ }))

    await waitFor(() => expect(useAppStore.getState().inputText).toBe('Charizard'))
    expect(onSetMode).toHaveBeenCalledWith('search')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('hides saved-search commands when signed out, even if runs are cached from a previous session', async () => {
    vi.spyOn(client, 'fetchMe').mockResolvedValue({ user: null, authEnabled: true })
    useAppStore.setState({ runs: [makeRun(1, { name: 'Stale Search' })] })
    renderPalette()
    openPalette()

    expect(screen.queryByText(/Stale Search/)).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Browse$/ })).toBeInTheDocument()
  })

  it('disables jump-to-search commands while a lookup is running, matching the Backpack list', async () => {
    useAppStore.setState({ runs: [makeRun(1, { name: 'My Charizards' })], isRunning: true })
    renderPalette()
    openPalette()

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /My Charizards/ })).toBeDisabled(),
    )
  })

  it('disables export commands with no matched rows, and runs an export with the matched rows once there are some', async () => {
    renderPalette()
    openPalette()
    expect(screen.getByRole('option', { name: /Download \.xlsx/ })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })

    useAppStore.setState({
      rows: [
        {
          query: { raw: 'Charizard', name: 'Charizard' } as never,
          card: { id: 'c1', name: 'Charizard' },
          pricing: { market: 10, variant: null, source: null, url: null, currency: 'USD' },
          tag: '',
          matched: true,
          reason: '',
        },
      ],
    })
    openPalette()
    const xlsxOption = screen.getByRole('option', { name: /Download \.xlsx/ })
    expect(xlsxOption).not.toBeDisabled()
    fireEvent.click(xlsxOption)

    await waitFor(() => expect(client.exportFile).toHaveBeenCalledTimes(1))
    expect(client.exportFile).toHaveBeenCalledWith(
      useAppStore.getState().rows,
      'xlsx',
      expect.objectContaining({ title: 'cards' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('invokes the Open callbacks for Settings, Help, and Collections/Wishlists', () => {
    const onOpenSettings = vi.fn()
    const onOpenHelp = vi.fn()
    const onOpenLibrary = vi.fn()
    renderPalette({ onOpenSettings, onOpenHelp, onOpenLibrary })

    openPalette()
    fireEvent.click(screen.getByRole('option', { name: 'Open Settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    openPalette()
    fireEvent.click(screen.getByRole('option', { name: 'Open Help' }))
    expect(onOpenHelp).toHaveBeenCalledTimes(1)

    openPalette()
    fireEvent.click(screen.getByRole('option', { name: 'Open Collections' }))
    openPalette()
    fireEvent.click(screen.getByRole('option', { name: 'Open Wishlists' }))
    expect(onOpenLibrary).toHaveBeenCalledTimes(2)
  })

  it('filters commands by fuzzy label match as the query changes', () => {
    renderPalette()
    openPalette()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wsh' } })
    expect(screen.getByRole('option', { name: 'Open Wishlists' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Open Settings' })).not.toBeInTheDocument()
  })

  it('navigates with arrow keys and selects the highlighted row on Enter', () => {
    const onSetMode = vi.fn()
    renderPalette({ onSetMode, mode: 'swipe' })
    openPalette()

    const input = screen.getByRole('combobox')
    // Swipe / Browse / Search are the first three entries when unfiltered.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSetMode).toHaveBeenCalledWith('search')
  })

  it('surfaces a just-invoked command first the next time the palette opens with an empty query', () => {
    const onOpenHelp = vi.fn()
    renderPalette({ onOpenHelp })
    openPalette()
    fireEvent.click(screen.getByRole('option', { name: 'Open Help' }))

    openPalette()
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Open Help')
  })
})
