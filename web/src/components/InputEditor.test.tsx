import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InputEditor } from './InputEditor'
import type { Row } from '../types'

vi.mock('../api/client', () => ({
  parseLine: vi.fn(),
}))

// `editorCollapsed` moved from InputEditor's own local state into the store
// (#523 follow-up, so `loadSavedRun` can re-expand it directly) — the mock
// setter mutates `storeState` synchronously so a *second* `rerender()` call
// (this mock has no real reactivity of its own) picks up the change, same
// as every other field here.
const { mockSetInputText, mockClearRows, mockSetEditorCollapsed, storeState } = vi.hoisted(() => {
  const storeState = {
    inputText: '',
    isRunning: false,
    rows: [] as unknown[],
    editorCollapsed: false,
  }
  const mockSetEditorCollapsed = vi.fn((v: boolean) => {
    storeState.editorCollapsed = v
  })
  return { mockSetInputText: vi.fn(), mockClearRows: vi.fn(), mockSetEditorCollapsed, storeState }
})

vi.mock('../store', () => ({
  useAppStore: () => ({
    inputText: storeState.inputText,
    setInputText: mockSetInputText,
    isRunning: storeState.isRunning,
    clearRows: mockClearRows,
    editorCollapsed: storeState.editorCollapsed,
    setEditorCollapsed: mockSetEditorCollapsed,
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
    mockSetEditorCollapsed.mockClear()
    storeState.inputText = ''
    storeState.isRunning = false
    storeState.rows = []
    storeState.editorCollapsed = false
  })

  it('renders the textarea and run button', () => {
    render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /look up/i })).toBeInTheDocument()
  })

  it('disables autocapitalize, autocorrect, and spellcheck on the textarea', () => {
    render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('autocapitalize', 'off')
    expect(textarea).toHaveAttribute('autocorrect', 'off')
    expect(textarea).toHaveAttribute('spellcheck', 'false')
  })

  it('gates the (⌘↵) hint behind the fine-pointer media query so it stays hidden on touch', () => {
    render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
    const hint = screen.getByText('(⌘↵)')
    expect(hint).toHaveClass('hidden', 'pointer-fine:inline')
  })

  it('pins the toolbar above the keyboard while the textarea is focused, and releases it on blur', () => {
    render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
    const textarea = screen.getByRole('textbox')
    const toolbar = screen.getByRole('button', { name: /look up/i }).closest('div')!.parentElement!

    expect(toolbar).not.toHaveClass('pointer-coarse:fixed')

    fireEvent.focus(textarea)
    expect(toolbar).toHaveClass('pointer-coarse:fixed')

    fireEvent.blur(textarea)
    expect(toolbar).not.toHaveClass('pointer-coarse:fixed')
  })

  it('blurs the textarea after submitting a lookup so the on-screen keyboard can dismiss', () => {
    storeState.inputText = 'Charizard'
    const onRun = vi.fn()
    render(<InputEditor onRun={onRun} onStop={vi.fn()} />)
    const textarea = screen.getByRole('textbox')

    textarea.focus()
    expect(document.activeElement).toBe(textarea)

    fireEvent.click(screen.getByRole('button', { name: /look up/i }))
    expect(onRun).toHaveBeenCalled()
    expect(document.activeElement).not.toBe(textarea)
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
      // First rerender: the effect sees the isRunning transition and calls
      // the mock setter, which mutates storeState — but this mock has no
      // reactivity of its own, so the render it's already mid-flight for
      // still shows the pre-collapse UI. A second rerender re-reads the
      // now-mutated storeState.
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      expect(mockSetEditorCollapsed).toHaveBeenCalledWith(true)
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
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      expect(mockSetEditorCollapsed).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('clicking the collapsed summary expands the editor again', () => {
      storeState.editorCollapsed = true
      storeState.inputText = 'Charizard'
      storeState.rows = [{} as Row]
      const { rerender } = render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: /1 card line/i }))
      expect(mockSetEditorCollapsed).toHaveBeenCalledWith(false)
      storeState.editorCollapsed = false
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('a new run re-expands a collapsed editor', () => {
      storeState.editorCollapsed = true
      storeState.inputText = 'Charizard'
      storeState.rows = [{} as Row]
      const { rerender } = render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

      // Re-running (e.g. from the Backpack's Recent tab) flips isRunning
      // back on without the user clicking the summary bar first.
      storeState.isRunning = true
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      storeState.editorCollapsed = false
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      expect(mockSetEditorCollapsed).toHaveBeenCalledWith(false)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('Clear resets a collapsed editor back to expanded', () => {
      storeState.editorCollapsed = true
      storeState.inputText = 'Charizard'
      storeState.rows = [{} as Row]
      const { rerender } = render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

      // The collapsed view hides the toolbar's own Clear button, so expand
      // first — the same path a user takes.
      fireEvent.click(screen.getByRole('button', { name: /1 card line/i }))
      storeState.editorCollapsed = false
      rerender(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: /clear/i }))

      expect(mockClearRows).toHaveBeenCalled()
      expect(mockSetInputText).toHaveBeenCalledWith('')
      expect(mockSetEditorCollapsed).toHaveBeenCalledWith(false)
    })
  })
})
