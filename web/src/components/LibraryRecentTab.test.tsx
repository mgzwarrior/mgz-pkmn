import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { LibraryRecentTab } from './LibraryRecentTab'
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

describe('LibraryRecentTab', () => {
  beforeEach(resetStore)

  it('renders an empty-state hint when there are no recent runs', () => {
    render(<LibraryRecentTab onRun={vi.fn()} />)
    expect(screen.getByText(/Your recent searches will land here/i)).toBeInTheDocument()
  })

  it('renders each entry with its line count and a preview summary', () => {
    useAppStore.setState({
      recentRuns: [
        makeRun('r1', ['Charizard', 'Pikachu', 'Squirtle', 'Mew', 'Bulbasaur']),
        makeRun('r2', ['Lugia']),
      ],
    })
    render(<LibraryRecentTab onRun={vi.fn()} />)

    expect(screen.getByText('5 lines')).toBeInTheDocument()
    expect(screen.getByText('Charizard, Pikachu, +3 more')).toBeInTheDocument()
    expect(screen.getByText('1 line')).toBeInTheDocument()
    expect(screen.getByText('Lugia')).toBeInTheDocument()
  })

  it('clicking an entry restores the lines and calls onRun with the joined text', () => {
    const onRun = vi.fn()
    useAppStore.setState({
      recentRuns: [makeRun('r1', ['Charizard', 'Pikachu'])],
    })
    render(<LibraryRecentTab onRun={onRun} />)

    fireEvent.click(screen.getByRole('button', { name: /Rerun search/i }))

    expect(useAppStore.getState().inputText).toBe('Charizard\nPikachu')
    expect(onRun).toHaveBeenCalledWith('Charizard\nPikachu')
  })

  it('rerun is no-op while a lookup is already running', () => {
    const onRun = vi.fn()
    useAppStore.setState({
      isRunning: true,
      recentRuns: [makeRun('r1', ['Charizard'])],
    })
    render(<LibraryRecentTab onRun={onRun} />)

    fireEvent.click(screen.getByRole('button', { name: /Rerun search/i }))

    expect(onRun).not.toHaveBeenCalled()
    expect(useAppStore.getState().inputText).toBe('')
  })

  it('per-row delete removes only that entry', () => {
    useAppStore.setState({
      recentRuns: [makeRun('r1', ['Charizard']), makeRun('r2', ['Mew'])],
    })
    render(<LibraryRecentTab onRun={vi.fn()} />)

    const items = screen.getAllByRole('listitem')
    const deleteBtn = within(items[0]).getByRole('button', { name: /Delete recent search/i })
    fireEvent.click(deleteBtn)

    expect(useAppStore.getState().recentRuns).toHaveLength(1)
    expect(useAppStore.getState().recentRuns[0].id).toBe('r2')
  })

  it('Clear all wipes the whole list', () => {
    useAppStore.setState({
      recentRuns: [makeRun('r1', ['Charizard']), makeRun('r2', ['Mew'])],
    })
    render(<LibraryRecentTab onRun={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Clear all/i }))
    expect(useAppStore.getState().recentRuns).toEqual([])
  })
})
