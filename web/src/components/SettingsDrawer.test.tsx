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
      api_structural_entry_count: 0,
      api_structural_bytes: 0,
      api_pricing_entry_count: 0,
      api_pricing_bytes: 0,
      api_pricing_oldest_mtime: null,
      override_count: 0,
      override_bytes: 0,
      image_entry_count: 0,
      image_bytes: 0,
      concept_warm_timestamp: null,
      concept_warm_names: 0,
      set_cards_warm_timestamp: null,
      set_cards_warm_count: 0,
      sets_warm_timestamp: null,
      sets_warm_count: 0,
      card_warm_timestamp: null,
      card_warm_count: 0,
      card_warm_failed_count: 0,
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
      api_structural_entry_count: 0,
      api_structural_bytes: 0,
      api_pricing_entry_count: 0,
      api_pricing_bytes: 0,
      api_pricing_oldest_mtime: null,
      override_count: 3,
      override_bytes: 800,
      image_entry_count: 173,
      image_bytes: 5_242_880,
      concept_warm_timestamp: Date.now() / 1000 - 120, // 2 min ago
      concept_warm_names: 47,
      set_cards_warm_timestamp: null,
      set_cards_warm_count: 0,
      sets_warm_timestamp: Date.now() / 1000 - 300, // 5 min ago
      sets_warm_count: 200,
      card_warm_timestamp: Date.now() / 1000 - 600, // 10 min ago
      card_warm_count: 18500,
      card_warm_failed_count: 0,
    })

    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    await waitFor(() => expect(screen.getByText(/42 ·/)).toBeInTheDocument())
    expect(screen.getByText(/173 ·/)).toBeInTheDocument()
    expect(screen.getByText(/47 ·/)).toBeInTheDocument()
    expect(screen.getByText(/200 ·/)).toBeInTheDocument()
    expect(screen.getByText(/18500 ·/)).toBeInTheDocument()
    // The not-warmed branch renders for set cards (the only null slice).
    expect(screen.getByText(/^not warmed$/)).toBeInTheDocument()
  })

  it('refresh button re-fetches /cache/stats', async () => {
    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    // Wait for the initial fetch to settle — the button is disabled while
    // `loading` is true, so clicking it before the finally() clears
    // loading would silently no-op and the call count would never reach
    // two. Waiting on the button's enabled state is the cleanest signal.
    const refresh = await screen.findByRole('button', { name: /refresh cache stats/i })
    await waitFor(() => expect(refresh).not.toBeDisabled())
    expect(mockFetchCacheStats).toHaveBeenCalledTimes(1)

    fireEvent.click(refresh)
    await waitFor(() => expect(mockFetchCacheStats).toHaveBeenCalledTimes(2))
  })

  it('cache-stats byte counts upcast through KB / MB / GB', async () => {
    // 17_904_440_414 is the image-warm result from the deployed instance
    // (#390) — the bug was rendering it as "17073.0 MB" instead of GB.
    mockFetchCacheStats.mockResolvedValueOnce({
      root: '/tmp/cache',
      api_entry_count: 1,
      api_bytes: 800, // < 1 KB -> "800 B"
      api_oldest_mtime: null,
      api_structural_entry_count: 0,
      api_structural_bytes: 0,
      api_pricing_entry_count: 0,
      api_pricing_bytes: 0,
      api_pricing_oldest_mtime: null,
      override_count: 1,
      override_bytes: 1536, // 1.5 KB
      image_entry_count: 40_088,
      image_bytes: 17_904_440_414, // ~16.7 GB
      concept_warm_timestamp: null,
      concept_warm_names: 0,
      set_cards_warm_timestamp: null,
      set_cards_warm_count: 0,
      sets_warm_timestamp: null,
      sets_warm_count: 0,
      card_warm_timestamp: null,
      card_warm_count: 0,
      card_warm_failed_count: 0,
    })

    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))

    await waitFor(() => expect(screen.getByText(/800 B/)).toBeInTheDocument())
    expect(screen.getByText(/1\.5 KB/)).toBeInTheDocument()
    expect(screen.getByText(/16\.7 GB/)).toBeInTheDocument()
  })

  it('cache-stats panel surfaces fetch errors without crashing', async () => {
    mockFetchCacheStats.mockRejectedValueOnce(new Error('boom'))
    render(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument())
  })
})
