import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsDrawer } from './SettingsDrawer'

const mockResetSettings = vi.fn()
const mockUpdateSettings = vi.fn()

vi.mock('../store', () => ({
  useAppStore: () => ({
    settings: {
      apiKey: '',
      maxPrice: null,
      noImages: true,
      tag: '',
      dedupe: false,
      sort: 'number',
    },
    updateSettings: mockUpdateSettings,
    resetSettings: mockResetSettings,
  }),
}))

describe('SettingsDrawer', () => {
  beforeEach(() => {
    mockResetSettings.mockClear()
    mockUpdateSettings.mockClear()
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
})
