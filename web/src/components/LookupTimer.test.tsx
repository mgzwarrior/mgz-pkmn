import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { LookupTimer } from './LookupTimer'
import { formatElapsed } from '../utils/format'
import { useAppStore } from '../store'
import type { Row } from '../types'

const DEFAULT_SETTINGS = {
  apiKey: '',
  maxPrice: null,
  noImages: true,
  tag: '',
  dedupe: false,
  sort: 'number' as const,
  showTimer: false,
  showEbay: false,
}

function row(name: string): Row {
  return {
    query: {
      raw: name,
      name,
      set_hint: null,
      number: null,
      variant_hint: null,
      url_hint: null,
      bulk_top: null,
      bulk_all: false,
      price_min: null,
      price_max: null,
    },
    card: null,
    pricing: { market: null, variant: null, source: null, url: null, currency: 'USD' },
    tag: '',
    matched: true,
    reason: '',
  }
}

describe('formatElapsed', () => {
  it('formats sub-second values in ms', () => {
    expect(formatElapsed(0)).toBe('0ms')
    expect(formatElapsed(150)).toBe('150ms')
    expect(formatElapsed(999)).toBe('999ms')
  })

  it('formats sub-minute values in seconds with 2 decimals', () => {
    expect(formatElapsed(1000)).toBe('1.00s')
    expect(formatElapsed(12_400)).toBe('12.40s')
  })

  it('formats >= 1 minute as MmSSs', () => {
    expect(formatElapsed(60_000)).toBe('1m00s')
    expect(formatElapsed(125_000)).toBe('2m05s')
  })

  it('rolls over to 1m00s when toFixed(2) would round up to 60.00', () => {
    // 59_999 ms is 59.999s, which `toFixed(2)` renders as "60.00"
    // (V8 floating-point rounding). Render that as `1m00s` rather
    // than the surprising boundary value `60.00s`.
    expect(formatElapsed(59_999)).toBe('1m00s')
    // Just under the rounding boundary still uses the seconds branch.
    expect(formatElapsed(59_990)).toBe('59.99s')
  })

  it('clamps negatives to 0ms', () => {
    expect(formatElapsed(-5)).toBe('0ms')
  })
})

describe('LookupTimer', () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      isRunning: false,
      runStartedAt: null,
      runEndedAt: null,
      rows: [],
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when showTimer is off', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: false },
      isRunning: true,
      runStartedAt: Date.now(),
    })
    const { container } = render(<LookupTimer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not schedule the tick interval when showTimer is off', () => {
    // Perf guard: even though the component returns null when showTimer
    // is off, an unconditional setInterval would still re-render on
    // every tick during a run. Gate the effect on the setting too.
    const setSpy = vi.spyOn(globalThis, 'setInterval')
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: false },
      isRunning: true,
      runStartedAt: 1_000_000,
    })
    render(<LookupTimer />)
    expect(setSpy).not.toHaveBeenCalled()
    setSpy.mockRestore()
  })

  it('renders nothing when no run has started', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: true },
      isRunning: false,
      runStartedAt: null,
    })
    const { container } = render(<LookupTimer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing in the brief window after click before the first SSE event', () => {
    // Between handleRun() and the first event arriving, isRunning is true
    // but runStartedAt is still null. The useEffect interval must NOT
    // start in that window — there is nothing to elapse against yet.
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: true },
      isRunning: true,
      runStartedAt: null,
    })
    const { container } = render(<LookupTimer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a live elapsed value while running, advancing as time passes', () => {
    const start = 1_000_000
    vi.setSystemTime(start)
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: true },
      isRunning: true,
      runStartedAt: start,
    })
    render(<LookupTimer />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    // advanceTimersByTime ticks the fake clock forward and fires
    // intervals scheduled during that window. After 500ms total,
    // the 100ms interval has fired enough times for the displayed
    // value to reflect 500ms elapsed.
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByText('500ms')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1900)
    })
    expect(screen.getByText('2.40s')).toBeInTheDocument()
  })

  it('renders the final summary with singular "card" at N=1', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: true },
      isRunning: false,
      runStartedAt: 1000,
      runEndedAt: 1500,
      rows: [row('Charizard')],
    })
    render(<LookupTimer />)
    expect(screen.getByText('500ms · 1 card · 500 ms/card')).toBeInTheDocument()
  })

  it('renders the final summary with plural "cards" at N>1', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: true },
      isRunning: false,
      runStartedAt: 1000,
      runEndedAt: 13_400,
      rows: [row('A'), row('B'), row('C'), row('D'), row('E')],
    })
    render(<LookupTimer />)
    expect(screen.getByText('12.40s · 5 cards · 2480 ms/card')).toBeInTheDocument()
  })

  it('clears the tick interval on unmount', () => {
    const start = 2_000_000
    vi.setSystemTime(start)
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: true },
      isRunning: true,
      runStartedAt: start,
    })
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = render(<LookupTimer />)
    unmount()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('renders just the elapsed value (no avg) when 0 rows resolved', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, showTimer: true },
      isRunning: false,
      runStartedAt: 1000,
      runEndedAt: 1500,
      rows: [],
    })
    render(<LookupTimer />)
    expect(screen.getByText('500ms')).toBeInTheDocument()
    expect(screen.queryByText(/ms\/card/)).not.toBeInTheDocument()
  })
})
