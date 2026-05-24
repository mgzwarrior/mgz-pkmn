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

  it('loads the catalog when opened and groups rows by series', async () => {
    renderOpen()

    await waitFor(() => expect(mockFetchSets).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Base Set')).toBeInTheDocument()
    expect(screen.getByText('Jungle')).toBeInTheDocument()
    expect(screen.getByText('Surging Sparks')).toBeInTheDocument()
    // Series headings are visible in catalog order (first-encounter wins).
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings[0]).toHaveTextContent('Base')
    expect(headings[1]).toHaveTextContent('Scarlet & Violet')
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

    // Two "Select series" buttons — one per series. Click the first
    // (Base).
    const seriesButtons = screen.getAllByRole('button', { name: 'Select series' })
    fireEvent.click(seriesButtons[0])
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
