import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileTabBar } from './MobileTabBar'

describe('MobileTabBar', () => {
  it('renders the four labeled destinations with the active one selected', () => {
    render(<MobileTabBar active="discover" onSelect={() => {}} />)

    for (const label of ['Discover', 'Backpack', 'Insights', 'Account']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: 'Discover' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Backpack' })).toHaveAttribute('aria-selected', 'false')
  })

  it('reports the tapped destination', () => {
    const onSelect = vi.fn()
    render(<MobileTabBar active="discover" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Backpack' }))
    expect(onSelect).toHaveBeenCalledWith('backpack')

    fireEvent.click(screen.getByRole('tab', { name: 'Account' }))
    expect(onSelect).toHaveBeenCalledWith('account')
  })

  it('reflects a different active tab', () => {
    render(<MobileTabBar active="insights" onSelect={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Insights' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Discover' })).toHaveAttribute('aria-selected', 'false')
  })
})
