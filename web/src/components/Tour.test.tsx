import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Tour } from './Tour'

// jsdom doesn't implement scrollIntoView; the tour uses it on every step.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

const { mockSetInputText, mockClearRows, mockSetProcessingLines, mockSetProgress, mockSetIsRunning, storeState } =
  vi.hoisted(() => ({
    mockSetInputText: vi.fn(),
    mockClearRows: vi.fn(),
    mockSetProcessingLines: vi.fn(),
    mockSetProgress: vi.fn(),
    mockSetIsRunning: vi.fn(),
    storeState: { inputText: '' },
  }))

vi.mock('../store', () => {
  const useAppStore = ((selector?: (s: ReturnType<typeof getState>) => unknown) => {
    const state = getState()
    return selector ? selector(state) : state
  }) as unknown as { (...args: unknown[]): unknown; getState: typeof getState }

  function getState() {
    return {
      inputText: storeState.inputText,
      setInputText: (v: string) => {
        storeState.inputText = v
        mockSetInputText(v)
      },
      clearRows: mockClearRows,
      setProcessingLines: mockSetProcessingLines,
      setProgress: mockSetProgress,
      setIsRunning: mockSetIsRunning,
    }
  }
  useAppStore.getState = getState
  return { useAppStore }
})

function makeAnchors() {
  // Each step's CSS selector needs a matching DOM element so the highlight
  // effect can find a target. Tests run in jsdom — these are bare divs.
  const ids = ['input', 'run', 'settings', 'results', 'exports']
  return ids.map((id) => {
    const el = document.createElement('div')
    el.setAttribute('data-tour', id)
    document.body.appendChild(el)
    return el
  })
}

describe('Tour', () => {
  beforeEach(() => {
    mockSetInputText.mockClear()
    mockClearRows.mockClear()
    mockSetProcessingLines.mockClear()
    mockSetProgress.mockClear()
    mockSetIsRunning.mockClear()
    storeState.inputText = ''
    document.body.innerHTML = ''
  })

  it('renders the first step with a Skip control', () => {
    makeAnchors()
    render(<Tour onClose={vi.fn()} onRun={vi.fn()} />)
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument()
    expect(screen.getByText('Card list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
  })

  it('seeds the input on mount when empty and highlights step 1 target', () => {
    const [inputEl] = makeAnchors()
    render(<Tour onClose={vi.fn()} onRun={vi.fn()} />)
    expect(mockSetInputText).toHaveBeenCalledWith('Pikachu | Jungle')
    expect(inputEl.classList.contains('tour-highlight')).toBe(true)
  })

  it('does not seed the input when it already has user content', () => {
    storeState.inputText = 'Charizard'
    makeAnchors()
    render(<Tour onClose={vi.fn()} onRun={vi.fn()} />)
    expect(mockSetInputText).not.toHaveBeenCalled()
  })

  it('Next advances steps and fires onRun once when leaving the Look-up step', () => {
    makeAnchors()
    const onRun = vi.fn()
    render(<Tour onClose={vi.fn()} onRun={onRun} />)
    // Step 1 → Step 2 (no run yet)
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).not.toHaveBeenCalled()
    // Step 2 → Step 3 (run fires)
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).toHaveBeenCalledWith('Pikachu | Jungle')
    expect(onRun).toHaveBeenCalledTimes(1)
    // Going Back + Next again does not re-trigger
    fireEvent.click(screen.getByRole('button', { name: /Back/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('Done on the last step calls onClose', () => {
    makeAnchors()
    const onClose = vi.fn()
    render(<Tour onClose={onClose} onRun={vi.fn()} />)
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Next|Done/i }))
    }
    expect(screen.getByText(/Step 5 of 5/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Done/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape calls onClose; ArrowRight/ArrowLeft step navigation', () => {
    makeAnchors()
    const onClose = vi.fn()
    render(<Tour onClose={onClose} onRun={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText(/Step 2 of 5/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('arrow keys do not navigate when focus is inside a textarea', () => {
    makeAnchors()
    render(<Tour onClose={vi.fn()} onRun={vi.fn()} />)
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()

    fireEvent.keyDown(ta, { key: 'ArrowRight', bubbles: true })
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument()
  })

  it('cleans up highlight class and (when run fired) the tour-owned state on unmount', () => {
    const [inputEl] = makeAnchors()
    const onRun = vi.fn()
    const { unmount } = render(<Tour onClose={vi.fn()} onRun={onRun} />)
    // Advance past the Look-up step so the run is recorded.
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).toHaveBeenCalledOnce()

    unmount()
    // Highlight class removed from every anchor.
    expect(inputEl.classList.contains('tour-highlight')).toBe(false)
    // Tour-owned state wiped — only because hasRunRef was set.
    expect(mockSetInputText).toHaveBeenLastCalledWith('')
    expect(mockClearRows).toHaveBeenCalled()
    expect(mockSetProcessingLines).toHaveBeenCalledWith([])
    expect(mockSetProgress).toHaveBeenCalledWith(null)
    expect(mockSetIsRunning).toHaveBeenCalledWith(false)
  })

  it('does not clear rows/processing/progress on unmount if the tour never ran', () => {
    makeAnchors()
    const { unmount } = render(<Tour onClose={vi.fn()} onRun={vi.fn()} />)
    unmount()
    expect(mockClearRows).not.toHaveBeenCalled()
    expect(mockSetProcessingLines).not.toHaveBeenCalled()
    expect(mockSetProgress).not.toHaveBeenCalled()
    expect(mockSetIsRunning).not.toHaveBeenCalled()
  })
})
