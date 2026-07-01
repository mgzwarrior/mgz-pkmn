import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileTabBar } from './MobileTabBar'

describe('MobileTabBar', () => {
  it('renders the four labeled destinations as a nav, marking the active one', () => {
    render(<MobileTabBar active="discover" onSelect={() => {}} />)

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    for (const label of ['Discover', 'Backpack', 'Insights', 'Account']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    // Navigation semantics: the current section carries aria-current, not aria-selected.
    expect(screen.getByRole('button', { name: 'Discover' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Backpack' })).not.toHaveAttribute('aria-current')
  })

  it('reports the tapped destination', () => {
    const onSelect = vi.fn()
    render(<MobileTabBar active="discover" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Backpack' }))
    expect(onSelect).toHaveBeenCalledWith('backpack')

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(onSelect).toHaveBeenCalledWith('account')
  })

  it('reflects a different active destination', () => {
    render(<MobileTabBar active="insights" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Insights' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Discover' })).not.toHaveAttribute('aria-current')
  })
})
