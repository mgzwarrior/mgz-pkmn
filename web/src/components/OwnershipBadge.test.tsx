import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OwnershipBadge } from './OwnershipBadge'
import type { CardOwnership } from '../api/client'

function own(o: Partial<CardOwnership>): CardOwnership {
  return { collections: [], wishlists: [], ...o }
}

describe('OwnershipBadge', () => {
  it('renders nothing when ownership is unknown or empty', () => {
    const { container: a } = render(<OwnershipBadge ownership={undefined} />)
    expect(a).toBeEmptyDOMElement()
    const { container: b } = render(<OwnershipBadge ownership={null} />)
    expect(b).toBeEmptyDOMElement()
    const { container: c } = render(<OwnershipBadge ownership={own({})} />)
    expect(c).toBeEmptyDOMElement()
  })

  it('shows "owned" with the collections in the tooltip', () => {
    render(
      <OwnershipBadge
        ownership={own({
          collections: [{ id: 1, name: 'Show Binder', quantity: 1, purpose: 'personal' }],
        })}
      />,
    )
    const badge = screen.getByText('owned')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('title', 'Owned in Show Binder')
  })

  it('sums quantity across personal collections into "owned ×N"', () => {
    render(
      <OwnershipBadge
        ownership={own({
          collections: [
            { id: 1, name: 'Show Binder', quantity: 2, purpose: 'personal' },
            { id: 2, name: 'Trade Stock', quantity: 1, purpose: 'personal' },
          ],
        })}
      />,
    )
    const badge = screen.getByText('owned ×3')
    expect(badge).toHaveAttribute('title', 'Owned in Show Binder (2), Trade Stock')
  })

  it('shows "chasing" with the want-lists in the tooltip', () => {
    render(
      <OwnershipBadge
        ownership={own({ wishlists: [{ id: 7, name: 'Allentown Show' }] })}
      />,
    )
    const badge = screen.getByText('chasing')
    expect(badge).toHaveAttribute('title', 'Chasing on Allentown Show')
  })

  it('owned supersedes chasing — hides the chase chip when also owned (#761)', () => {
    render(
      <OwnershipBadge
        ownership={own({
          collections: [{ id: 1, name: 'Binder', quantity: 1, purpose: 'personal' }],
          wishlists: [{ id: 2, name: 'Upgrade list' }],
        })}
      />,
    )
    expect(screen.getByText('owned')).toBeInTheDocument()
    expect(screen.queryByText('chasing')).not.toBeInTheDocument()
  })

  it('a trade/bulk-only collection does not count as owned, but shows distinctly (#707)', () => {
    render(
      <OwnershipBadge
        ownership={own({
          collections: [{ id: 1, name: 'Trade Stock', quantity: 2, purpose: 'trade' }],
          wishlists: [{ id: 2, name: 'Upgrade list' }],
        })}
      />,
    )
    // Still "chasing" — the trade copy isn't a personal keeper.
    expect(screen.getByText('chasing')).toBeInTheDocument()
    expect(screen.queryByText(/^owned/)).not.toBeInTheDocument()
    expect(screen.getByText('2 for trade')).toBeInTheDocument()
  })

  it('a personal copy alongside a bulk stash counts as owned and still flags the bulk', () => {
    render(
      <OwnershipBadge
        ownership={own({
          collections: [
            { id: 1, name: 'Show Binder', quantity: 1, purpose: 'personal' },
            { id: 2, name: 'Bulk box', quantity: 20, purpose: 'bulk' },
          ],
        })}
      />,
    )
    expect(screen.getByText('owned')).toBeInTheDocument()
    expect(screen.getByText('20 bulk')).toBeInTheDocument()
  })
})
