import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsDrawer } from './SettingsDrawer'

describe('SettingsDrawer', () => {
  it('renders the settings trigger button', () => {
    render(<SettingsDrawer />)
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument()
  })
})
