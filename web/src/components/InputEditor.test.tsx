import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InputEditor } from './InputEditor'

vi.mock('../api/client', () => ({
  parseLine: vi.fn(),
}))

const { mockSetInputText, mockClearRows, storeState } = vi.hoisted(() => ({
  mockSetInputText: vi.fn(),
  mockClearRows: vi.fn(),
  storeState: {
    inputText: '',
    isRunning: false,
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
    rows: [],
  }),
}))

describe('InputEditor', () => {
  beforeEach(() => {
    mockSetInputText.mockClear()
    mockClearRows.mockClear()
    storeState.inputText = ''
    storeState.isRunning = false
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
})
