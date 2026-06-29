import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Tour } from './Tour'

// jsdom implements neither scrollIntoView nor requestAnimationFrame; the tour
// uses both (the latter to defer the highlight past a mode switch / tab flip).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof window.requestAnimationFrame
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

// Auth is mutable per-test so the auth-gated steps (Want/Own, collections &
// wishlists) can be exercised in both states.
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user }) }))

// The tour renders its own CardDetailModal; stub it so the unit test doesn't
// pull the modal's data/hook tree in. The `card-detail` / `quick-actions`
// highlight targets are supplied as static anchors by makeAnchors() instead.
vi.mock('./CardDetailModal', () => ({ CardDetailModal: () => null }))

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
  // Every step's CSS selector needs a matching DOM element so the highlight
  // effect can find a target. Tests run in jsdom — these are bare divs.
  const ids = [
    'discovery-modes',
    'swipe',
    'browse',
    'card-detail',
    'quick-actions',
    'input',
    'results',
    'library',
    'binders',
    'binders-tab',
    'settings',
  ]
  const map: Record<string, HTMLElement> = {}
  ids.forEach((id) => {
    const el = document.createElement(id === 'binders-tab' ? 'button' : 'div')
    el.setAttribute('data-tour', id)
    document.body.appendChild(el)
    map[id] = el
  })
  return map
}

function noopProps() {
  return { onClose: vi.fn(), onRun: vi.fn(), onStop: vi.fn(), onSetMode: vi.fn() }
}

// Click Next `n` times.
function clickNext(n: number) {
  for (let i = 0; i < n; i++) {
    fireEvent.click(screen.getByRole('button', { name: /Next|Done/i }))
  }
}

describe('Tour', () => {
  beforeEach(() => {
    mockSetInputText.mockClear()
    mockClearRows.mockClear()
    mockSetProcessingLines.mockClear()
    mockSetProgress.mockClear()
    mockSetIsRunning.mockClear()
    storeState.inputText = ''
    auth.user = null
    document.body.innerHTML = ''
  })

  it('renders the first step with a Skip control (8 steps signed out)', () => {
    makeAnchors()
    render(<Tour {...noopProps()} />)
    expect(screen.getByText(/Step 1 of 8/)).toBeInTheDocument()
    expect(screen.getByText('Find cards')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
  })

  it('drops the auth-gated steps when signed out, keeps them signed in', () => {
    makeAnchors()
    const { unmount } = render(<Tour {...noopProps()} />)
    // Signed out: no Want/Own or collections/wishlists steps.
    clickNext(10)
    expect(screen.queryByText('Want or Own')).not.toBeInTheDocument()
    expect(screen.queryByText('Collections & wishlists')).not.toBeInTheDocument()
    unmount()

    auth.user = { id: 'u1' }
    document.body.innerHTML = ''
    makeAnchors()
    render(<Tour {...noopProps()} />)
    expect(screen.getByText(/Step 1 of 10/)).toBeInTheDocument()
  })

  it('seeds the input on mount when empty and highlights the first target', async () => {
    const anchors = makeAnchors()
    render(<Tour {...noopProps()} />)
    expect(mockSetInputText).toHaveBeenCalledWith('Pikachu | Jungle')
    await waitFor(() =>
      expect(anchors['discovery-modes'].classList.contains('tour-highlight')).toBe(true),
    )
  })

  it('does not seed the input when it already has user content', () => {
    storeState.inputText = 'Charizard'
    makeAnchors()
    render(<Tour {...noopProps()} />)
    expect(mockSetInputText).not.toHaveBeenCalled()
  })

  it('drives the discovery mode as it advances through Swipe / Browse / Search', () => {
    makeAnchors()
    const props = noopProps()
    render(<Tour {...props} />)
    clickNext(1) // Swipe
    expect(props.onSetMode).toHaveBeenCalledWith('swipe')
    clickNext(1) // Browse
    expect(props.onSetMode).toHaveBeenCalledWith('browse')
    clickNext(2) // Card details (no mode) -> Card list (search)
    expect(props.onSetMode).toHaveBeenCalledWith('search')
  })

  it('fires onRun once when advancing past the Card list step', () => {
    makeAnchors()
    const props = noopProps()
    render(<Tour {...props} />)
    // Find cards -> Swipe -> Browse -> Card details -> Card list (index 4).
    clickNext(4)
    expect(props.onRun).not.toHaveBeenCalled()
    clickNext(1) // advance past Card list -> fires the seeded lookup
    expect(props.onRun).toHaveBeenCalledWith('Pikachu | Jungle')
    expect(props.onRun).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Back/i }))
    clickNext(1)
    expect(props.onRun).toHaveBeenCalledTimes(1)
  })

  it('Done on the last step calls onClose', () => {
    makeAnchors()
    const props = noopProps()
    render(<Tour {...props} />)
    clickNext(7) // reach the last step (index 7, Step 8 of 8)
    expect(screen.getByText(/Step 8 of 8/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Done/i }))
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('Escape calls onClose; ArrowRight/ArrowLeft step navigation', () => {
    makeAnchors()
    const props = noopProps()
    render(<Tour {...props} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText(/Step 2 of 8/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText(/Step 1 of 8/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('arrow keys do not navigate when focus is inside a textarea', () => {
    makeAnchors()
    render(<Tour {...noopProps()} />)
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()

    fireEvent.keyDown(ta, { key: 'ArrowRight', bubbles: true })
    expect(screen.getByText(/Step 1 of 8/)).toBeInTheDocument()
  })

  it('on unmount with seed intact and run fired: aborts request and wipes state', () => {
    makeAnchors()
    const props = noopProps()
    const { unmount } = render(<Tour {...props} />)
    clickNext(5) // advance past Card list so the tour fires its own lookup
    expect(props.onRun).toHaveBeenCalledOnce()

    unmount()
    expect(mockSetInputText).toHaveBeenLastCalledWith('')
    expect(props.onStop).toHaveBeenCalledOnce()
    expect(mockClearRows).toHaveBeenCalled()
    expect(mockSetProcessingLines).toHaveBeenCalledWith([])
    expect(mockSetProgress).toHaveBeenCalledWith(null)
    expect(mockSetIsRunning).toHaveBeenCalledWith(false)
  })

  it('does not wipe state or call onStop when the user typed over the seed', () => {
    makeAnchors()
    const props = noopProps()
    const { unmount } = render(<Tour {...props} />)
    clickNext(5) // advance past Card list so hasRunRef is set
    expect(props.onRun).toHaveBeenCalledOnce()
    // Simulate the user editing the input mid-tour.
    storeState.inputText = 'My own card'

    unmount()
    expect(props.onStop).not.toHaveBeenCalled()
    expect(mockClearRows).not.toHaveBeenCalled()
    expect(mockSetProcessingLines).not.toHaveBeenCalled()
    expect(mockSetProgress).not.toHaveBeenCalled()
    expect(mockSetIsRunning).not.toHaveBeenCalled()
    expect(storeState.inputText).toBe('My own card')
  })

  it('does not clear rows/processing/progress on unmount if the tour never ran', () => {
    makeAnchors()
    const props = noopProps()
    const { unmount } = render(<Tour {...props} />)
    unmount()
    expect(props.onStop).not.toHaveBeenCalled()
    expect(mockClearRows).not.toHaveBeenCalled()
    expect(mockSetProcessingLines).not.toHaveBeenCalled()
    expect(mockSetProgress).not.toHaveBeenCalled()
    expect(mockSetIsRunning).not.toHaveBeenCalled()
  })
})
