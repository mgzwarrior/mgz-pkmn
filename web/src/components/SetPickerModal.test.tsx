import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SetPickerModal } from './SetPickerModal'
import { useAppStore } from '../store'
import {
  fetchSets,
  downloadSetCardsPdf,
  setLogoUrl,
} from '../api/client'
import type { SetInfo } from '../types'

vi.mock('../api/client', () => ({
  fetchSets: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
  setLogoUrl: vi.fn((id: string) => `/api/v1/sets/${id}/logo`),
}))

const mockFetchSets = vi.mocked(fetchSets)
const mockDownload = vi.mocked(downloadSetCardsPdf)
const mockLogoUrl = vi.mocked(setLogoUrl)

const SETS: SetInfo[] = [
  {
    id: 'base1',
    name: 'Base Set',
    series: 'Base',
    total: 102,
    releaseDate: '1998/01/09',
  },
  {
    id: 'jungle',
    name: 'Jungle',
    series: 'Base',
    total: 64,
    releaseDate: '1999/06/16',
  },
  {
    id: 'sv8',
    name: 'Surging Sparks',
    series: 'Scarlet & Violet',
    total: 252,
    releaseDate: '2024/11/08',
  },
]

describe('SetPickerModal', () => {
  beforeEach(() => {
    useAppStore.setState({ selectedSetIds: [] })
    mockFetchSets.mockReset()
    mockDownload.mockReset()
    mockLogoUrl.mockClear()
    mockFetchSets.mockResolvedValue(SETS)
    mockDownload.mockResolvedValue(undefined)
  })

  function renderOpen() {
    const onOpenChange = vi.fn()
    const result = render(<SetPickerModal open onOpenChange={onOpenChange} />)
    return { onOpenChange, ...result }
  }

  it('loads the catalog when opened and renders series newest-first', async () => {
    renderOpen()

    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Base Set')).toBeInTheDocument()
    expect(screen.getByText('Jungle')).toBeInTheDocument()
    expect(screen.getByText('Surging Sparks')).toBeInTheDocument()
    // Series headers are now collapse toggles (buttons with
    // aria-expanded). Modern sets come first since most prep biases
    // toward current blocks, so Scarlet & Violet sits above Base.
    const headers = screen
      .getAllByRole('button')
      .filter((el) => el.hasAttribute('aria-expanded'))
    expect(headers[0]).toHaveTextContent('Scarlet & Violet')
    expect(headers[1]).toHaveTextContent('Base')
  })

  it('does not download when nothing is selected — surfaces a warning', async () => {
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    expect(mockDownload).not.toHaveBeenCalled()
    // The disabled-button state is the safety rail; the warning text
    // only appears when the user clicks despite that, which we can't
    // simulate cleanly because the button is disabled. Verify the
    // disabled state is in place.
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  })

  it('select-all checks every box and Download PDF posts every id', async () => {
    const { onOpenChange } = renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1))
    const [apiKey, ids] = mockDownload.mock.calls[0]
    expect(apiKey).toBeUndefined()
    expect(new Set(ids)).toEqual(new Set(['base1', 'jungle', 'sv8']))
    // Successful submit closes the modal and persists the selection.
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(useAppStore.getState().selectedSetIds).toEqual(ids)
  })

  it('select-none clears the draft after a select-all', async () => {
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }))
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  })

  it('select-series picks every set in that series only', async () => {
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    // With newest-first ordering, the second "Select series" button is
    // the Base group (Scarlet & Violet is index 0). Picking it should
    // check both Base-era sets and leave Surging Sparks untouched.
    const seriesButtons = screen.getAllByRole('button', { name: 'Select series' })
    fireEvent.click(seriesButtons[1])
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1))
    const [, ids] = mockDownload.mock.calls[0]
    expect(new Set(ids)).toEqual(new Set(['base1', 'jungle']))
  })

  it('toggling a row checkbox flips its selection', async () => {
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    const checkbox = screen.getByRole('checkbox', { name: 'Include Surging Sparks' })
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
  })

  it('seeds the draft from selectedSetIds when reopening', async () => {
    useAppStore.setState({ selectedSetIds: ['jungle'] })
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    expect(
      screen.getByRole('checkbox', { name: 'Include Jungle' })
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'Include Base Set' })
    ).not.toBeChecked()
  })

  it('surfaces a load error when the catalog fetch fails', async () => {
    mockFetchSets.mockRejectedValueOnce(new Error('upstream down'))
    renderOpen()

    expect(
      await screen.findByText(/Couldn’t load sets: upstream down/)
    ).toBeInTheDocument()
  })

  it('surfaces a submit error and keeps the modal open', async () => {
    mockDownload.mockRejectedValueOnce(new Error('rate-limited'))
    const { onOpenChange } = renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    expect(await screen.findByText('rate-limited')).toBeInTheDocument()
    // The failure path must NOT close the modal — the user should be
    // able to retry without re-checking everything.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('collapsing a series hides its rows; expanding restores them', async () => {
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    // The "Base" series header (newest-first ordering puts S&V first,
    // Base second).
    const baseHeader = screen
      .getAllByRole('button')
      .filter((el) => el.hasAttribute('aria-expanded'))[1]
    expect(baseHeader).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Base Set')).toBeInTheDocument()
    expect(screen.getByText('Jungle')).toBeInTheDocument()

    fireEvent.click(baseHeader)
    expect(baseHeader).toHaveAttribute('aria-expanded', 'false')
    // Set rows are gone from the DOM.
    expect(screen.queryByText('Base Set')).not.toBeInTheDocument()
    expect(screen.queryByText('Jungle')).not.toBeInTheDocument()
    // But Surging Sparks (in the other series) is still visible.
    expect(screen.getByText('Surging Sparks')).toBeInTheDocument()

    fireEvent.click(baseHeader)
    expect(baseHeader).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Base Set')).toBeInTheDocument()
  })

  it('Collapse all hides every series; Expand all restores them', async () => {
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('Surging Sparks')).not.toBeInTheDocument()
    expect(screen.queryByText('Base Set')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('Surging Sparks')).toBeInTheDocument()
    expect(screen.getByText('Base Set')).toBeInTheDocument()
  })

  it('series header shows N/total counter when at least one set is selected', async () => {
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Jungle' }))
    // The Base series (2 sets) now shows "(1/2)" in its header; the
    // unselected S&V series still shows the plain "(1)" count.
    const baseHeader = screen
      .getAllByRole('button')
      .filter((el) => el.hasAttribute('aria-expanded'))[1]
    expect(baseHeader).toHaveTextContent('(1/2)')
    const svHeader = screen
      .getAllByRole('button')
      .filter((el) => el.hasAttribute('aria-expanded'))[0]
    expect(svHeader).toHaveTextContent('(1)')
  })

  it('logo thumbnails fall back to an icon when the image errors', async () => {
    renderOpen()
    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))

    // The thumbnail is an `<img>` with empty alt (decorative — the row's
    // accessible name lives on the checkbox), so query by tag inside the
    // row label.
    const label = screen
      .getByRole('checkbox', { name: 'Include Base Set' })
      .closest('label')!
    const img = label.querySelector('img')
    expect(img).not.toBeNull()
    // Simulate a 404 from the cached-logo endpoint.
    fireEvent.error(img!)

    // After the error, the row swaps the broken <img> for the ImageOff
    // glyph. The img element should no longer be in the DOM.
    expect(label.querySelector('img')).toBeNull()
  })
})
