import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InputEditor } from './InputEditor'
import type { Row } from '../types'

vi.mock('../api/client', () => ({
  parseLine: vi.fn(),
}))

const { mockSetInputText, mockClearRows, storeState } = vi.hoisted(() => ({
  mockSetInputText: vi.fn(),
  mockClearRows: vi.fn(),
  storeState: {
    inputText: '',
    isRunning: false,
    rows: [] as unknown[],
  },
}))

vi.mock('../store', () => ({
  useAppStore: () => ({
    inputText: storeState.inputText,
    setInputText: mockSetInputText,
    isRunning: storeState.isRunning,
    clearRows: mockClearRows,
    // LookupTimer (rendered under the toolbar) reads these fields.
    settings: {
      apiKey: '',
      maxPrice: null,
      noImages: true,
      tag: '',
      dedupe: false,
      sort: 'number',
      showTimer: false,
    },
    runStartedAt: null,
    runEndedAt: null,
    rows: storeState.rows,
  }),
}))

describe('InputEditor', () => {
  beforeEach(() => {
    mockSetInputText.mockClear()
    mockClearRows.mockClear()
    storeState.inputText = ''
    storeState.isRunning = false
    storeState.rows = []
  })

  it('renders the textarea and run button', () => {
    render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /look up/i })).toBeInTheDocument()
  })

  describe('example chips', () => {
    it('renders the chip panel when inputText is empty', () => {
      render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.getByText('Try one of these')).toBeInTheDocument()
      // At least one of the known chip examples is present.
      expect(screen.getByRole('button', { name: 'Pikachu | Jungle' })).toBeInTheDocument()
    })

    it('hides the chip panel when inputText has content', () => {
      storeState.inputText = 'Charizard'
      render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.queryByText('Try one of these')).not.toBeInTheDocument()
    })

    it('treats whitespace-only input as empty and still renders chips', () => {
      storeState.inputText = '   \n  '
      render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.getByText('Try one of these')).toBeInTheDocument()
    })

    it('hides the chip panel while a lookup is running', () => {
      storeState.isRunning = true
      render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.queryByText('Try one of these')).not.toBeInTheDocument()
    })

    it('clicking a chip populates the input and calls onRun with the example', () => {
      const onRun = vi.fn()
      render(<InputEditor onRun={onRun} onStop={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Pikachu | Jungle' }))
      expect(mockSetInputText).toHaveBeenCalledWith('Pikachu | Jungle')
      expect(onRun).toHaveBeenCalledWith('Pikachu | Jungle')
    })
  })

  describe('post-lookup collapse (#523)', () => {
    it('collapses to a one-line summary once a run finishes with rows', () => {
      storeState.inputText = 'Charizard'
      storeState.isRunning = true
      const { rerender } = render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()

      storeState.isRunning = false
      storeState.rows = [{} as Row]
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /1 card line/i })).toBeInTheDocument()
    })

    it('does not collapse when the run finished with zero rows', () => {
      storeState.inputText = 'top:5 Charizard cards'
      storeState.isRunning = true
      const { rerender } = render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      storeState.isRunning = false
      storeState.rows = []
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('clicking the collapsed summary expands the editor again', () => {
      storeState.inputText = 'Charizard'
      storeState.isRunning = true
      const { rerender } = render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      storeState.isRunning = false
      storeState.rows = [{} as Row]
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: /1 card line/i }))

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('a new run re-expands a collapsed editor', () => {
      storeState.inputText = 'Charizard'
      storeState.isRunning = true
      const { rerender } = render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      storeState.isRunning = false
      storeState.rows = [{} as Row]
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

      // Re-running (e.g. from the Backpack's Recent tab) flips isRunning
      // back on without the user clicking the summary bar first.
      storeState.isRunning = true
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('Clear resets a collapsed editor back to expanded', () => {
      storeState.inputText = 'Charizard'
      storeState.isRunning = true
      const { rerender } = render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      storeState.isRunning = false
      storeState.rows = [{} as Row]
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

      // The collapsed view hides the toolbar's own Clear button, so expand
      // first — the same path a user takes.
      fireEvent.click(screen.getByRole('button', { name: /1 card line/i }))
      fireEvent.click(screen.getByRole('button', { name: /clear/i }))

      expect(mockClearRows).toHaveBeenCalled()
      expect(mockSetInputText).toHaveBeenCalledWith('')
    })
  })
})
