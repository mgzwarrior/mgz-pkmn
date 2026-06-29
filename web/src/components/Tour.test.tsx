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
  // Stable references across renders so useEffect deps don't thrash and
  // re-run the seed/cleanup on every render.
  const setInputText = (v: string) => {
    storeState.inputText = v
    mockSetInputText(v)
  }
  const api = {
    setInputText,
    clearRows: mockClearRows,
    setProcessingLines: mockSetProcessingLines,
    setProgress: mockSetProgress,
    setIsRunning: mockSetIsRunning,
  }
  function getState() {
    return { inputText: storeState.inputText, ...api }
  }
  const useAppStore = ((selector?: (s: ReturnType<typeof getState>) => unknown) => {
    const state = getState()
    return selector ? selector(state) : state
  }) as unknown as { (...args: unknown[]): unknown; getState: typeof getState }
  useAppStore.getState = getState
  return { useAppStore }
})

function makeAnchors() {
  // Each step's CSS selector needs a matching DOM element so the highlight
  // effect can find a target. Tests run in jsdom — these are bare divs.
  // Order mirrors STEPS so makeAnchors()[0] is the first step's target.
  const ids = ['discovery-modes', 'input', 'run', 'results', 'exports', 'library', 'settings']
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
    render(<Tour onClose={vi.fn()} onRun={vi.fn()} onStop={vi.fn()} />)
    expect(screen.getByText(/Step 1 of 7/)).toBeInTheDocument()
    expect(screen.getByText('Find cards')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
  })

  it('seeds the input on mount when empty and highlights step 1 target', () => {
    const [firstEl] = makeAnchors()
    render(<Tour onClose={vi.fn()} onRun={vi.fn()} onStop={vi.fn()} />)
    expect(mockSetInputText).toHaveBeenCalledWith('Pikachu | Jungle')
    expect(firstEl.classList.contains('tour-highlight')).toBe(true)
  })

  it('does not seed the input when it already has user content', () => {
    storeState.inputText = 'Charizard'
    makeAnchors()
    render(<Tour onClose={vi.fn()} onRun={vi.fn()} onStop={vi.fn()} />)
    expect(mockSetInputText).not.toHaveBeenCalled()
  })

  it('Next advances steps and fires onRun once when leaving the Look-up step', () => {
    makeAnchors()
    const onRun = vi.fn()
    render(<Tour onClose={vi.fn()} onRun={onRun} onStop={vi.fn()} />)
    // Find cards -> Card list -> Look up -> Results: onRun fires on the third
    // Next, when the user advances past the Look-up step (index 2).
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).toHaveBeenCalledWith('Pikachu | Jungle')
    expect(onRun).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Back/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('Done on the last step calls onClose', () => {
    makeAnchors()
    const onClose = vi.fn()
    render(<Tour onClose={onClose} onRun={vi.fn()} onStop={vi.fn()} />)
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Next|Done/i }))
    }
    expect(screen.getByText(/Step 7 of 7/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Done/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape calls onClose; ArrowRight/ArrowLeft step navigation', () => {
    makeAnchors()
    const onClose = vi.fn()
    render(<Tour onClose={onClose} onRun={vi.fn()} onStop={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText(/Step 2 of 7/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText(/Step 1 of 7/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('arrow keys do not navigate when focus is inside a textarea', () => {
    makeAnchors()
    render(<Tour onClose={vi.fn()} onRun={vi.fn()} onStop={vi.fn()} />)
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()

    fireEvent.keyDown(ta, { key: 'ArrowRight', bubbles: true })
    expect(screen.getByText(/Step 1 of 7/)).toBeInTheDocument()
  })

  it('on unmount with seed intact and run fired: aborts request and wipes state', () => {
    const [firstEl] = makeAnchors()
    const onRun = vi.fn()
    const onStop = vi.fn()
    const { unmount } = render(<Tour onClose={vi.fn()} onRun={onRun} onStop={onStop} />)
    // Advance past the Look-up step (index 2) so the tour fires its own lookup.
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).toHaveBeenCalledOnce()

    unmount()
    expect(firstEl.classList.contains('tour-highlight')).toBe(false)
    expect(mockSetInputText).toHaveBeenLastCalledWith('')
    expect(onStop).toHaveBeenCalledOnce()
    expect(mockClearRows).toHaveBeenCalled()
    expect(mockSetProcessingLines).toHaveBeenCalledWith([])
    expect(mockSetProgress).toHaveBeenCalledWith(null)
    expect(mockSetIsRunning).toHaveBeenCalledWith(false)
  })

  it('does not wipe state or call onStop when the user typed over the seed', () => {
    makeAnchors()
    const onRun = vi.fn()
    const onStop = vi.fn()
    const { unmount } = render(<Tour onClose={vi.fn()} onRun={onRun} onStop={onStop} />)
    // Advance past the Look-up step so hasRunRef is set.
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(onRun).toHaveBeenCalledOnce()
    // Simulate the user editing the input mid-tour.
    storeState.inputText = 'My own card'

    unmount()
    // Seed no longer matches — user's input is preserved AND their lookup
    // (if any) is left alone. onStop must not fire either.
    expect(onStop).not.toHaveBeenCalled()
    expect(mockClearRows).not.toHaveBeenCalled()
    expect(mockSetProcessingLines).not.toHaveBeenCalled()
    expect(mockSetProgress).not.toHaveBeenCalled()
    expect(mockSetIsRunning).not.toHaveBeenCalled()
    expect(storeState.inputText).toBe('My own card')
  })

  it('does not clear rows/processing/progress on unmount if the tour never ran', () => {
    makeAnchors()
    const onStop = vi.fn()
    const { unmount } = render(<Tour onClose={vi.fn()} onRun={vi.fn()} onStop={onStop} />)
    unmount()
    expect(onStop).not.toHaveBeenCalled()
    expect(mockClearRows).not.toHaveBeenCalled()
    expect(mockSetProcessingLines).not.toHaveBeenCalled()
    expect(mockSetProgress).not.toHaveBeenCalled()
    expect(mockSetIsRunning).not.toHaveBeenCalled()
  })
})
