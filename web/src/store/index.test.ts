import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAppStore, RECENT_RUNS_LIMIT } from './index'

describe('store: processingLines', () => {
  beforeEach(() => useAppStore.setState({ processingLines: [] }))

  it('markLineStatus transitions a pending line to resolved', () => {
    useAppStore.setState({
      processingLines: [{ line: 'Charizard', status: 'pending' }],
    })
    useAppStore.getState().markLineStatus(0, 'resolved')
    expect(useAppStore.getState().processingLines[0].status).toBe('resolved')
  })

  it('markLineStatus is idempotent for already-resolved lines (top:N expansions)', () => {
    useAppStore.setState({
      processingLines: [{ line: 'top:5 Mew', status: 'resolved' }],
    })
    useAppStore.getState().markLineStatus(0, 'error')
    expect(useAppStore.getState().processingLines[0].status).toBe('resolved')
  })

  it('markLineStatus ignores out-of-range indices', () => {
    useAppStore.setState({
      processingLines: [{ line: 'a', status: 'pending' }],
    })
    useAppStore.getState().markLineStatus(99, 'resolved')
    expect(useAppStore.getState().processingLines).toHaveLength(1)
    expect(useAppStore.getState().processingLines[0].status).toBe('pending')
  })

  it('markLineStatus stamps endedAt with the wall-clock time of the transition', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      useAppStore.setState({
        processingLines: [{ line: 'Charizard', status: 'pending' }],
      })
      useAppStore.getState().markLineStatus(0, 'resolved')
      expect(useAppStore.getState().processingLines[0].endedAt).toBe(1_700_000_000_000)
    } finally {
      // try/finally so a failing assertion above doesn't strand the
      // suite in fake-timer mode and cascade into later tests.
      vi.useRealTimers()
    }
  })
})

describe('store: run timestamps', () => {
  beforeEach(() => {
    useAppStore.setState({ runStartedAt: null, runEndedAt: null })
  })

  it('setRunStartedAt / setRunEndedAt update and clear the timestamps', () => {
    const s = useAppStore.getState()
    s.setRunStartedAt(1234)
    s.setRunEndedAt(5678)
    expect(useAppStore.getState().runStartedAt).toBe(1234)
    expect(useAppStore.getState().runEndedAt).toBe(5678)
    s.setRunStartedAt(null)
    s.setRunEndedAt(null)
    expect(useAppStore.getState().runStartedAt).toBeNull()
    expect(useAppStore.getState().runEndedAt).toBeNull()
  })
})

describe('store: recentRuns', () => {
  beforeEach(() => useAppStore.setState({ recentRuns: [] }))

  it('pushRecentRun prepends a new entry with an id, savedAt, and the lines', () => {
    useAppStore.getState().pushRecentRun(['Charizard', 'Pikachu'])
    const [first] = useAppStore.getState().recentRuns
    expect(first.lines).toEqual(['Charizard', 'Pikachu'])
    expect(typeof first.id).toBe('string')
    expect(first.id.length).toBeGreaterThan(0)
    expect(typeof first.savedAt).toBe('number')
  })

  it('pushRecentRun ignores an empty submission', () => {
    useAppStore.getState().pushRecentRun([])
    expect(useAppStore.getState().recentRuns).toHaveLength(0)
  })

  it('pushRecentRun collapses consecutive duplicates by refreshing savedAt', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      useAppStore.getState().pushRecentRun(['Charizard', 'Pikachu'])
      const original = useAppStore.getState().recentRuns[0]

      vi.setSystemTime(2_000)
      useAppStore.getState().pushRecentRun(['Charizard', 'Pikachu'])

      const runs = useAppStore.getState().recentRuns
      expect(runs).toHaveLength(1)
      expect(runs[0].id).toBe(original.id)
      expect(runs[0].savedAt).toBe(2_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it(`pushRecentRun caps history at RECENT_RUNS_LIMIT (${RECENT_RUNS_LIMIT})`, () => {
    const push = useAppStore.getState().pushRecentRun
    for (let i = 0; i < RECENT_RUNS_LIMIT + 5; i++) {
      push([`card-${i}`])
    }
    const runs = useAppStore.getState().recentRuns
    expect(runs).toHaveLength(RECENT_RUNS_LIMIT)
    // Newest first; the most-recently-pushed entry sits at the head.
    expect(runs[0].lines).toEqual([`card-${RECENT_RUNS_LIMIT + 4}`])
    // The oldest entries got evicted, so card-0..card-4 are gone.
    const surviving = new Set(runs.map((r) => r.lines[0]))
    for (let i = 0; i < 5; i++) {
      expect(surviving.has(`card-${i}`)).toBe(false)
    }
  })

  it('removeRecentRun drops the entry by id', () => {
    const push = useAppStore.getState().pushRecentRun
    push(['a'])
    push(['b'])
    push(['c'])
    const target = useAppStore.getState().recentRuns[1]
    useAppStore.getState().removeRecentRun(target.id)
    const lines = useAppStore.getState().recentRuns.map((r) => r.lines[0])
    expect(lines).not.toContain(target.lines[0])
    expect(lines).toHaveLength(2)
  })

  it('clearRecentRuns empties the list', () => {
    const push = useAppStore.getState().pushRecentRun
    push(['a'])
    push(['b'])
    useAppStore.getState().clearRecentRuns()
    expect(useAppStore.getState().recentRuns).toHaveLength(0)
  })
})

describe('store: settings.showTimer', () => {
  afterEach(() => {
    useAppStore.getState().resetSettings()
  })

  it('defaults to false and round-trips through updateSettings', () => {
    expect(useAppStore.getState().settings.showTimer).toBe(false)
    useAppStore.getState().updateSettings({ showTimer: true })
    expect(useAppStore.getState().settings.showTimer).toBe(true)
  })

  it('resetSettings restores showTimer to false', () => {
    useAppStore.getState().updateSettings({ showTimer: true })
    useAppStore.getState().resetSettings()
    expect(useAppStore.getState().settings.showTimer).toBe(false)
  })
})
