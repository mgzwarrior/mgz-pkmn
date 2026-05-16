import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProcessingQueue } from './ProcessingQueue'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    processingLines: [
      { line: 'Charizard | Base Set | 4', status: 'resolved' as const },
      { line: 'Pikachu | Jungle', status: 'error' as const },
      { line: 'top:5 Mew ex', status: 'pending' as const },
    ],
    isRunning: true,
  },
}))

vi.mock('../store', () => ({
  useAppStore: () => mockState,
}))

describe('ProcessingQueue', () => {
  it('renders one entry per input line and a done/total count', () => {
    render(<ProcessingQueue />)
    expect(screen.getByText(/looking up cards/i)).toBeInTheDocument()
    expect(screen.getByText(/2 of 3 done/i)).toBeInTheDocument()
    expect(screen.getByText('Charizard | Base Set | 4')).toBeInTheDocument()
    expect(screen.getByText('Pikachu | Jungle')).toBeInTheDocument()
    expect(screen.getByText('top:5 Mew ex')).toBeInTheDocument()
  })
})
