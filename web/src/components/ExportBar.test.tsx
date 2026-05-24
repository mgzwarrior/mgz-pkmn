import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportBar } from './ExportBar'
import { useAppStore } from '../store'
import type { Row } from '../types'
import { exportFile, downloadSetCardsPdf } from '../api/client'

vi.mock('../api/client', () => ({
  exportFile: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
}))

const mockExportFile = vi.mocked(exportFile)
const mockDownloadSetCardsPdf = vi.mocked(downloadSetCardsPdf)

/**
 * Radix DropdownMenu opens on `pointerdown`, not on `click`, so the plain
 * `fireEvent.click` shorthand doesn't reveal the menu in jsdom. Fire the
 * full sequence keyboard users follow: focus the trigger and press Enter.
 */
function openDropdown() {
  const trigger = screen.getByRole('button', { name: 'Export' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
}

function makeRow(matched: boolean): Row {
  return {
    query: {
      raw: 'Pikachu | Jungle',
      name: 'Pikachu',
      set_hint: 'Jungle',
      number: null,
      variant_hint: null,
      url_hint: null,
      bulk_top: null,
      bulk_all: false,
      price_min: null,
      price_max: null,
    },
    card: matched ? { id: 'jungle-60', name: 'Pikachu' } : null,
    pricing: { market: null, variant: null, source: null, url: null, currency: 'USD' },
    tag: '',
    matched,
    reason: matched ? 'matched' : 'no match',
  }
}

describe('ExportBar', () => {
  beforeEach(() => {
    // Each test starts with the default empty store and fresh mocks.
    // Zustand's persist middleware keeps prior `settings` around across
    // tests via the in-memory localStorage stub, so we reset both slices
    // explicitly to default values rather than relying on the initial state.
    useAppStore.setState({
      rows: [],
      settings: {
        apiKey: '',
        maxPrice: null,
        noImages: true,
        tag: '',
        dedupe: false,
        sort: 'number',
      },
    })
    mockExportFile.mockReset()
    mockDownloadSetCardsPdf.mockReset()
    mockExportFile.mockResolvedValue(undefined)
    mockDownloadSetCardsPdf.mockResolvedValue(undefined)
  })

  it('renders an Export trigger', () => {
    render(<ExportBar />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  })

  it('lists every export format when the dropdown opens', () => {
    render(<ExportBar />)
    openDropdown()
    expect(screen.getByText('Download .xlsx')).toBeInTheDocument()
    expect(screen.getByText('PDF binder')).toBeInTheDocument()
    expect(screen.getByText('Condensed PDF')).toBeInTheDocument()
    expect(screen.getByText('Checklist')).toBeInTheDocument()
    expect(screen.getByText('Set ID cards')).toBeInTheDocument()
  })

  it('disables row-dependent items when no rows are matched, but keeps Set ID cards enabled', () => {
    render(<ExportBar />)
    openDropdown()

    for (const label of ['Download .xlsx', 'PDF binder', 'Condensed PDF', 'Checklist']) {
      const item = screen.getByText(label).closest('[role="menuitem"]')!
      expect(item).toHaveAttribute('data-disabled')
    }
    const setCards = screen.getByText('Set ID cards').closest('[role="menuitem"]')!
    expect(setCards).not.toHaveAttribute('data-disabled')

    // Row count label is only shown when there are matched rows.
    expect(screen.queryByText(/^\d+ rows?$/)).not.toBeInTheDocument()
  })

  it('enables row-dependent items and shows the row count when matches exist', () => {
    useAppStore.setState({ rows: [makeRow(true), makeRow(true), makeRow(false)] })

    render(<ExportBar />)
    openDropdown()

    for (const label of ['Download .xlsx', 'PDF binder', 'Condensed PDF', 'Checklist']) {
      const item = screen.getByText(label).closest('[role="menuitem"]')!
      expect(item).not.toHaveAttribute('data-disabled')
    }
    expect(screen.getByText('2 rows')).toBeInTheDocument()
  })

  it('uses singular "row" when exactly one match exists', () => {
    useAppStore.setState({ rows: [makeRow(true)] })

    render(<ExportBar />)
    openDropdown()

    expect(screen.getByText('1 row')).toBeInTheDocument()
  })

  it('calls exportFile with the current rows + settings when a format is picked', async () => {
    const rows = [makeRow(true), makeRow(true)]
    useAppStore.setState({
      rows,
      settings: {
        apiKey: 'k',
        maxPrice: 25,
        noImages: false,
        tag: 'binder',
        dedupe: true,
        sort: 'alpha',
      },
    })

    render(<ExportBar />)
    openDropdown()
    fireEvent.click(screen.getByText('Download .xlsx'))

    await waitFor(() => expect(mockExportFile).toHaveBeenCalledTimes(1))
    expect(mockExportFile).toHaveBeenCalledWith(rows, 'xlsx', {
      maxPrice: 25,
      title: 'binder',
      sort: 'alpha',
      noImages: false,
      dedupe: true,
    })
  })

  it('falls back to "cards" as the export title when no tag is set', async () => {
    useAppStore.setState({ rows: [makeRow(true)] })

    render(<ExportBar />)
    openDropdown()
    fireEvent.click(screen.getByText('PDF binder'))

    await waitFor(() => expect(mockExportFile).toHaveBeenCalledTimes(1))
    expect(mockExportFile.mock.calls[0][2]).toMatchObject({ title: 'cards' })
  })

  it('does not fire exportFile when the dropdown is opened with no matched rows', async () => {
    render(<ExportBar />)
    openDropdown()
    // Item is disabled but the menuitem element still exists; clicking it
    // should be a no-op because Radix forwards data-disabled to onSelect.
    fireEvent.click(screen.getByText('Download .xlsx'))

    // Give any stray microtasks a tick to settle.
    await new Promise((r) => setTimeout(r, 0))
    expect(mockExportFile).not.toHaveBeenCalled()
  })

  it('calls downloadSetCardsPdf when Set ID cards is picked, even without matched rows', async () => {
    useAppStore.setState({
      rows: [],
      settings: {
        apiKey: 'secret-key',
        maxPrice: null,
        noImages: true,
        tag: '',
        dedupe: false,
        sort: 'number',
      },
    })

    render(<ExportBar />)
    openDropdown()
    fireEvent.click(screen.getByText('Set ID cards'))

    await waitFor(() => expect(mockDownloadSetCardsPdf).toHaveBeenCalledTimes(1))
    expect(mockDownloadSetCardsPdf).toHaveBeenCalledWith('secret-key')
  })

  it('passes undefined to downloadSetCardsPdf when no API key is configured', async () => {
    useAppStore.setState({ rows: [] })

    render(<ExportBar />)
    openDropdown()
    fireEvent.click(screen.getByText('Set ID cards'))

    await waitFor(() => expect(mockDownloadSetCardsPdf).toHaveBeenCalledTimes(1))
    expect(mockDownloadSetCardsPdf).toHaveBeenCalledWith(undefined)
  })

  it('surfaces export errors in the bar', async () => {
    mockExportFile.mockRejectedValueOnce(new Error('boom'))
    useAppStore.setState({ rows: [makeRow(true)] })

    render(<ExportBar />)
    openDropdown()
    fireEvent.click(screen.getByText('Checklist'))

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('stringifies non-Error rejections from the export client', async () => {
    mockExportFile.mockRejectedValueOnce('rate-limited')
    useAppStore.setState({ rows: [makeRow(true)] })

    render(<ExportBar />)
    openDropdown()
    fireEvent.click(screen.getByText('Condensed PDF'))

    expect(await screen.findByText('rate-limited')).toBeInTheDocument()
  })

  it('surfaces Set ID cards errors in the bar', async () => {
    mockDownloadSetCardsPdf.mockRejectedValueOnce(new Error('catalog down'))
    useAppStore.setState({ rows: [] })

    render(<ExportBar />)
    openDropdown()
    fireEvent.click(screen.getByText('Set ID cards'))

    expect(await screen.findByText('catalog down')).toBeInTheDocument()
  })
})
