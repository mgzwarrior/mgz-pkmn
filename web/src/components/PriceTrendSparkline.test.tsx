import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceTrendSparkline } from './PriceTrendSparkline'

describe('PriceTrendSparkline', () => {
  it('renders nothing for fewer than two points', () => {
    const { container } = render(<PriceTrendSparkline points={null} />)
    expect(container.querySelector('svg')).toBeNull()

    const { container: empty } = render(<PriceTrendSparkline points={[]} />)
    expect(empty.querySelector('svg')).toBeNull()

    const { container: one } = render(
      <PriceTrendSparkline points={[{ ts: '2026-07-01', price: 10 }]} />,
    )
    expect(one.querySelector('svg')).toBeNull()
  })

  it('renders an accessible polyline summarising an upward trend', () => {
    render(
      <PriceTrendSparkline
        points={[
          { ts: '2026-06-23', price: 10 },
          { ts: '2026-07-10', price: 25 },
          { ts: '2026-07-22', price: 30 },
        ]}
      />,
    )
    const svg = screen.getByRole('img', { name: /30-day price trend/i })
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('up'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('$10.00'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('$30.00'))
    expect(svg.querySelector('polyline')).not.toBeNull()
    // Native hover tooltip mirrors the aria summary.
    expect(svg.querySelector('title')?.textContent).toContain('up')
  })

  it('summarises a downward trend', () => {
    render(
      <PriceTrendSparkline
        points={[
          { ts: '2026-07-01', price: 50 },
          { ts: '2026-07-22', price: 20 },
        ]}
      />,
    )
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('down'))
  })

  it('uses the currency symbol in the summary', () => {
    render(
      <PriceTrendSparkline
        points={[
          { ts: '2026-07-01', price: 1 },
          { ts: '2026-07-02', price: 2 },
        ]}
        currency="EUR"
      />,
    )
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('€'))
  })
})
