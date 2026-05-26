import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { RecentRuns } from './RecentRuns'
import { useAppStore } from '../store'
import type { RecentRun } from '../types'

function makeRun(id: string, lines: string[], savedAt = 1_700_000_000_000): RecentRun {
  return { id, savedAt, lines }
}

function resetStore() {
  useAppStore.setState({
    recentRuns: [],
    inputText: '',
    isRunning: false,
  })
}

describe('RecentRuns', () => {
  beforeEach(resetStore)

  it('renders nothing when there are no recent runs', () => {
    const { container } = render(<RecentRuns onRun={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders each entry with its line count and a preview summary', () => {
    useAppStore.setState({
      recentRuns: [
        makeRun('r1', ['Charizard', 'Pikachu', 'Squirtle', 'Mew', 'Bulbasaur']),
        makeRun('r2', ['Lugia']),
      ],
    })
    render(<RecentRuns onRun={vi.fn()} />)

    expect(screen.getByText('5 lines')).toBeInTheDocument()
    expect(screen.getByText('Charizard, Pikachu, +3 more')).toBeInTheDocument()

    // Singular for one-line runs; no "+N more" tail.
    expect(screen.getByText('1 line')).toBeInTheDocument()
    expect(screen.getByText('Lugia')).toBeInTheDocument()
  })

  it('clicking an entry restores the lines and calls onRun with the joined text', () => {
    const onRun = vi.fn()
    useAppStore.setState({
      recentRuns: [makeRun('r1', ['Charizard', 'Pikachu'])],
    })
    render(<RecentRuns onRun={onRun} />)

    fireEvent.click(screen.getByRole('button', { name: /Rerun search/i }))

    expect(useAppStore.getState().inputText).toBe('Charizard\nPikachu')
    expect(onRun).toHaveBeenCalledWith('Charizard\nPikachu')
  })

  it('rerun is a no-op while a run is already in flight', () => {
    const onRun = vi.fn()
    useAppStore.setState({
      isRunning: true,
      recentRuns: [makeRun('r1', ['Charizard'])],
    })
    render(<RecentRuns onRun={onRun} />)

    fireEvent.click(screen.getByRole('button', { name: /Rerun search/i }))
    expect(onRun).not.toHaveBeenCalled()
    expect(useAppStore.getState().inputText).toBe('')
  })

  it('per-row delete drops just that entry', () => {
    useAppStore.setState({
      recentRuns: [
        makeRun('r1', ['Charizard']),
        makeRun('r2', ['Pikachu']),
      ],
    })
    render(<RecentRuns onRun={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Delete recent search: Charizard'))

    const remaining = useAppStore.getState().recentRuns.map((r) => r.id)
    expect(remaining).toEqual(['r2'])
  })

  it('Clear all wipes the whole list', () => {
    useAppStore.setState({
      recentRuns: [
        makeRun('r1', ['Charizard']),
        makeRun('r2', ['Pikachu']),
      ],
    })
    render(<RecentRuns onRun={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(useAppStore.getState().recentRuns).toHaveLength(0)
  })

  it('collapse toggle hides the entries but keeps the header counter', () => {
    useAppStore.setState({
      recentRuns: [makeRun('r1', ['Charizard'])],
    })
    render(<RecentRuns onRun={vi.fn()} />)
    const region = screen.getByRole('region', { name: /Recent searches/i })

    expect(within(region).getByText('Charizard')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Recent searches/i }))
    expect(within(region).queryByText('Charizard')).not.toBeInTheDocument()
    // Header counter is still rendered.
    expect(within(region).getByText('(1)')).toBeInTheDocument()
  })
})
