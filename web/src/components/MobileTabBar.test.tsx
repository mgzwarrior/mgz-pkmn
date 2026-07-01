/**
 * MobileTabBar.test — the Discover/Backpack destination switching (#519).
 * Insights and Account are InsightsNavButton/SignInChip's own `tab` variant
 * (covered by their own test files), so they're stubbed here to keep this
 * file focused on the bar's own selection behavior.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileTabBar } from './MobileTabBar'

vi.mock('./InsightsNavButton', () => ({
  InsightsNavButton: () => <div>Insights stub</div>,
}))
vi.mock('./SignInChip', () => ({
  SignInChip: () => <div>Account stub</div>,
}))

describe('MobileTabBar (#519)', () => {
  it('renders all four destinations with icon + label', () => {
    render(<MobileTabBar section="discover" onSelectSection={vi.fn()} />)
    expect(screen.getByRole('button', { name: /discover/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /backpack/i })).toBeInTheDocument()
    expect(screen.getByText('Insights stub')).toBeInTheDocument()
    expect(screen.getByText('Account stub')).toBeInTheDocument()
  })

  it('marks the active section with aria-current and calls back on selection', () => {
    const onSelectSection = vi.fn()
    render(<MobileTabBar section="discover" onSelectSection={onSelectSection} />)
    expect(screen.getByRole('button', { name: /discover/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /backpack/i })).not.toHaveAttribute('aria-current')

    fireEvent.click(screen.getByRole('button', { name: /backpack/i }))
    expect(onSelectSection).toHaveBeenCalledWith('backpack')
  })
})
