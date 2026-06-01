import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProcessingQueue } from './ProcessingQueue'

const baseSettings = {
  apiKey: '',
  maxPrice: null,
  noImages: true,
  tag: '',
  dedupe: false,
  sort: 'number' as const,
  showTimer: false,
}

const { mockState } = vi.hoisted(() => ({
  mockState: {
    processingLines: [
      { line: 'Charizard | Base Set | 4', status: 'resolved' as const, endedAt: 1500 },
      { line: 'Pikachu | Jungle', status: 'error' as const, endedAt: 1800 },
      { line: 'top:5 Mew ex', status: 'pending' as const },
    ] as Array<Record<string, unknown>>,
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
  beforeEach(() => {
    mockState.isRunning = true
    mockState.runStartedAt = 1000
    mockState.processingLines = [
      { line: 'Charizard | Base Set | 4', status: 'resolved' as const, endedAt: 1500 },
      { line: 'Pikachu | Jungle', status: 'error' as const, endedAt: 1800 },
      { line: 'top:5 Mew ex', status: 'pending' as const },
    ] as Array<Record<string, unknown>>
  })

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

  it('per-line badge aria-label says "Finished" — works for both resolved and error lines', () => {
    mockState.settings.showTimer = true
    render(<ProcessingQueue />)
    // Charizard resolved at 1500 → 500ms; Pikachu errored at 1800 → 800ms.
    // Both must read as "Finished" so the label is accurate for error
    // outcomes too (Copilot review feedback on #297).
    expect(screen.getByLabelText('Finished in 500 milliseconds')).toBeInTheDocument()
    expect(screen.getByLabelText('Finished in 800 milliseconds')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Resolved in/)).not.toBeInTheDocument()
  })
})

describe('ProcessingQueue stage chips', () => {
  beforeEach(() => {
    mockState.settings = { ...baseSettings }
    mockState.isRunning = true
    mockState.processingLines = [
      { line: 'Charizard | Base Set | 4', status: 'pending', stage: 'looking_up', stageStartedAt: 1000 },
      { line: 'Mew', status: 'pending', stage: 'fallback', stageStartedAt: 1000 },
      { line: 'Lugia', status: 'resolved', stage: 'resolved', stageStartedAt: 1400, endedAt: 1500 },
      { line: 'Ditto', status: 'error', stage: 'no_match', stageStartedAt: 1700, endedAt: 1800 },
    ]
  })

  it('renders the stage label for each line', () => {
    render(<ProcessingQueue />)
    expect(screen.getAllByText('Looking up').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fallback').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Resolved').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No match').length).toBeGreaterThan(0)
  })

  it('applies the matching color class to the stage label', () => {
    render(<ProcessingQueue />)
    // The looking_up label uses the sky-* palette in both themes (the
    // chip's own <span> carries the stage color class, not the legend
    // swatch). We assert the light-mode token; the `dark:` counterpart
    // ships in the same className.
    const lookingUp = screen
      .getAllByText('Looking up')
      .find((el) => el.tagName === 'SPAN' && el.className.includes('text-sky-500'))
    expect(lookingUp).toBeDefined()
    const noMatch = screen
      .getAllByText('No match')
      .find((el) => el.className.includes('text-sun-600'))
    expect(noMatch).toBeDefined()
  })

  it('exposes per-stage elapsed time via the row tooltip for finished lines', () => {
    render(<ProcessingQueue />)
    // Lugia spent 1500 - 1400 = 100ms in the resolved stage.
    expect(screen.getByTitle('Resolved · 100ms')).toBeInTheDocument()
    // Ditto spent 1800 - 1700 = 100ms in the no_match stage.
    expect(screen.getByTitle('No match · 100ms')).toBeInTheDocument()
  })

  it('legend is collapsed by default and toggles open from the header', () => {
    render(<ProcessingQueue />)
    const toggle = screen.getByRole('button', { name: /legend/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Collapsed: the unique terminal labels (URL hint) aren't shown twice.
    expect(screen.queryByText('URL hint')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // Open: the legend lists every stage, including ones no line is in.
    expect(screen.getByText('URL hint')).toBeInTheDocument()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
  })
})

describe('ProcessingQueue post-run persistence (#376)', () => {
  beforeEach(() => {
    mockState.settings = { ...baseSettings, showTimer: true }
    mockState.isRunning = false
    mockState.runStartedAt = 1000
    mockState.processingLines = [
      { line: 'Charizard', status: 'resolved', stage: 'resolved', stageStartedAt: 1400, endedAt: 1500 },
      { line: 'Pikachu', status: 'error', stage: 'error', stageStartedAt: 1700, endedAt: 1800 },
      // A mid-stage pending line — what an abandoned Stop / SSE error
      // leaves behind. Should still render (no early-return) but its
      // spinner must not animate now that the run is over.
      { line: 'Mew', status: 'pending', stage: 'looking_up', stageStartedAt: 1200 },
    ]
  })

  it('keeps the queue mounted with per-line elapsed badges after the run completes', () => {
    render(<ProcessingQueue />)
    expect(screen.getByText(/last lookup/i)).toBeInTheDocument()
    expect(screen.queryByText(/looking up cards/i)).not.toBeInTheDocument()
    expect(screen.getByText('Charizard')).toBeInTheDocument()
    expect(screen.getByText('Pikachu')).toBeInTheDocument()
    // 1500 - 1000 = 500ms, 1800 - 1000 = 800ms — the timing data that
    // the bug report needs surfaced after the run.
    expect(screen.getByText('500ms')).toBeInTheDocument()
    expect(screen.getByText('800ms')).toBeInTheDocument()
  })

  it('freezes the spinner for abandoned mid-stage lines once the run ends', () => {
    const { container } = render(<ProcessingQueue />)
    // Stage-color class `text-sky-500` belongs to `looking_up`; that
    // chip is the Mew line still spinning conceptually. After the run
    // we want the icon present but not animating.
    const spinning = container.querySelectorAll('.animate-spin')
    expect(spinning.length).toBe(0)
  })

  it('still hides the queue entirely when there are no lines to show', () => {
    mockState.processingLines = []
    const { container } = render(<ProcessingQueue />)
    expect(container.firstChild).toBeNull()
  })
})
