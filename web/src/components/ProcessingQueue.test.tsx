import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProcessingQueue } from './ProcessingQueue'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    processingLines: [
      { line: 'Charizard | Base Set | 4', status: 'resolved' as const, endedAt: 1500 },
      { line: 'Pikachu | Jungle', status: 'error' as const, endedAt: 1800 },
      { line: 'top:5 Mew ex', status: 'pending' as const },
    ],
    isRunning: true,
    runStartedAt: 1000,
    settings: {
      apiKey: '',
      maxPrice: null,
      noImages: true,
      tag: '',
      dedupe: false,
      sort: 'number' as const,
      showTimer: false,
    },
  },
}))

vi.mock('../store', () => ({
  useAppStore: () => mockState,
}))

describe('ProcessingQueue', () => {
  it('renders one entry per input line and a done/total count', () => {
    mockState.settings.showTimer = false
    render(<ProcessingQueue />)
    expect(screen.getByText(/looking up cards/i)).toBeInTheDocument()
    expect(screen.getByText(/2 of 3 done/i)).toBeInTheDocument()
    expect(screen.getByText('Charizard | Base Set | 4')).toBeInTheDocument()
    expect(screen.getByText('Pikachu | Jungle')).toBeInTheDocument()
    expect(screen.getByText('top:5 Mew ex')).toBeInTheDocument()
  })

  it('omits per-line elapsed badges when showTimer is off', () => {
    mockState.settings.showTimer = false
    render(<ProcessingQueue />)
    expect(screen.queryByText(/500ms/)).not.toBeInTheDocument()
    expect(screen.queryByText(/800ms/)).not.toBeInTheDocument()
  })

  it('shows per-line elapsed badges when showTimer is on', () => {
    mockState.settings.showTimer = true
    render(<ProcessingQueue />)
    // 1500 - 1000 = 500ms, 1800 - 1000 = 800ms
    expect(screen.getByText('500ms')).toBeInTheDocument()
    expect(screen.getByText('800ms')).toBeInTheDocument()
  })
})
