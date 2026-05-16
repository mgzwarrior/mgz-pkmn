import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultsTable } from './ResultsTable'

vi.mock('../api/client', () => ({
  addOverride: vi.fn(),
}))

describe('ResultsTable', () => {
  it('shows empty-state message when there are no rows', () => {
    render(<ResultsTable />)
    expect(screen.getByText(/results will appear here/i)).toBeInTheDocument()
  })
})
