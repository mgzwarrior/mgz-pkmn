import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsDrawer } from './SettingsDrawer'
import { fetchCacheStats } from '../api/client'

vi.mock('../api/client', () => ({
  fetchCacheStats: vi.fn(),
}))
const mockFetchCacheStats = vi.mocked(fetchCacheStats)

const { mockResetSettings, mockUpdateSettings } = vi.hoisted(() => ({
  mockResetSettings: vi.fn(),
  mockUpdateSettings: vi.fn(),
}))

vi.mock('../store', () => ({
  useAppStore: () => ({
    settings: {
      apiKey: '',
      maxPrice: null,
      noImages: true,
      tag: '',
      dedupe: false,
      sort: 'number',
      showTimer: false,
    },
    updateSettings: mockUpdateSettings,
    resetSettings: mockResetSettings,
  }),
}))

describe('SettingsDrawer', () => {
  beforeEach(() => {
    mockResetSettings.mockClear()
    mockUpdateSettings.mockClear()
    mockFetchCacheStats.mockReset()
    // Default cache-stats shape — most tests don't care, but the panel
    // mounts as soon as the drawer opens and would otherwise hit a real
    // fetch.
    mockFetchCacheStats.mockResolvedValue({
      root: '/tmp/cache',
      api_entry_count: 0,
      api_bytes: 0,
      api_oldest_mtime: null,
      override_count: 0,
      override_bytes: 0,
      image_entry_count: 0,
      image_bytes: 0,
      concept_warm_timestamp: null,
      concept_warm_names: 0,
      set_cards_warm_timestamp: null,
      set_cards_warm_count: 0,
    })
  })

  it('renders the settings trigger button', () => {
    render(<SettingsDrawer />)
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument()
  })

  it('"Restore defaults" button calls resetSettings', () => {
    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /restore defaults/i }))
    expect(mockResetSettings).toHaveBeenCalledOnce()
  })

  it('toggling "Show lookup timer" calls updateSettings({ showTimer: true })', () => {
    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    fireEvent.click(screen.getByLabelText(/show lookup timer/i))
    expect(mockUpdateSettings).toHaveBeenCalledWith({ showTimer: true })
  })

  it('cache-stats panel renders the values returned by /cache/stats', async () => {
    mockFetchCacheStats.mockResolvedValueOnce({
      root: '/tmp/cache',
      api_entry_count: 42,
      api_bytes: 1_500_000,
      api_oldest_mtime: null,
      override_count: 3,
      override_bytes: 800,
      image_entry_count: 173,
      image_bytes: 5_242_880,
      concept_warm_timestamp: Date.now() / 1000 - 120, // 2 min ago
      concept_warm_names: 47,
      set_cards_warm_timestamp: null,
      set_cards_warm_count: 0,
    })

    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    await waitFor(() => expect(screen.getByText(/42 ·/)).toBeInTheDocument())
    expect(screen.getByText(/173 ·/)).toBeInTheDocument()
    expect(screen.getByText(/47 ·/)).toBeInTheDocument()
    // The not-warmed branch renders for set cards.
    expect(screen.getByText(/^not warmed$/)).toBeInTheDocument()
  })

  it('refresh button re-fetches /cache/stats', async () => {
    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    await waitFor(() => expect(mockFetchCacheStats).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /refresh cache stats/i }))
    await waitFor(() => expect(mockFetchCacheStats).toHaveBeenCalledTimes(2))
  })

  it('cache-stats panel surfaces fetch errors without crashing', async () => {
    mockFetchCacheStats.mockRejectedValueOnce(new Error('boom'))
    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument())
  })
})
