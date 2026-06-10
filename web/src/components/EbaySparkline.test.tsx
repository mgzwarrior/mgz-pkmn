import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EbaySparkline } from './EbaySparkline'

describe('EbaySparkline', () => {
  it('renders nothing for fewer than two points', () => {
    const { container } = render(<EbaySparkline values={[]} />)
    expect(container.querySelector('svg')).toBeNull()
    const { container: one } = render(<EbaySparkline values={[5]} />)
    expect(one.querySelector('svg')).toBeNull()
  })

  it('renders an accessible polyline summarising the range', () => {
    render(<EbaySparkline values={[10, 30, 20]} />)
    const svg = screen.getByRole('img', { name: /recent ebay sold prices/i })
    expect(svg).toBeInTheDocument()
    // aria summary names the count + low/high.
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('3 sales'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('$10.00'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('$30.00'))
    expect(svg.querySelector('polyline')).not.toBeNull()
  })

  it('uses the currency symbol in the summary', () => {
    render(<EbaySparkline values={[1, 2]} currency="EUR" />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('€'))
  })
})
