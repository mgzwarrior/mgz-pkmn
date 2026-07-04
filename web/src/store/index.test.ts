import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAppStore, EMPTY_VIEW_STATE, RECENT_RUNS_LIMIT } from './index'

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

  it('updateLineStage records the stage and stamps stageStartedAt', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      useAppStore.setState({
        processingLines: [{ line: 'Charizard', status: 'pending' }],
      })
      useAppStore.getState().updateLineStage(0, 'looking_up')
      const line = useAppStore.getState().processingLines[0]
      expect(line.stage).toBe('looking_up')
      expect(line.stageStartedAt).toBe(1_700_000_000_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('updateLineStage resets stageStartedAt only when the stage changes', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000)
      useAppStore.setState({
        processingLines: [{ line: 'a', status: 'pending' }],
      })
      useAppStore.getState().updateLineStage(0, 'looking_up')
      vi.setSystemTime(2000)
      // Same stage again → timestamp must not move.
      useAppStore.getState().updateLineStage(0, 'looking_up')
      expect(useAppStore.getState().processingLines[0].stageStartedAt).toBe(1000)
      // New stage → timestamp advances.
      useAppStore.getState().updateLineStage(0, 'fallback')
      expect(useAppStore.getState().processingLines[0].stageStartedAt).toBe(2000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('updateLineStage ignores out-of-range indices', () => {
    useAppStore.setState({
      processingLines: [{ line: 'a', status: 'pending' }],
    })
    useAppStore.getState().updateLineStage(99, 'looking_up')
    expect(useAppStore.getState().processingLines[0].stage).toBeUndefined()
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

describe('store: appendInputLines', () => {
  beforeEach(() => useAppStore.setState({ inputText: '' }))

  it('appends a single line to an empty editor and reports 1 added', () => {
    const added = useAppStore.getState().appendInputLines(['Charizard | Base | 4'])
    expect(added).toBe(1)
    expect(useAppStore.getState().inputText).toBe('Charizard | Base | 4\n')
  })

  it('joins multiple lines with newlines and reports the total fresh count', () => {
    const added = useAppStore
      .getState()
      .appendInputLines(['Pikachu | Jungle | 60', 'Squirtle | Base | 63'])
    expect(added).toBe(2)
    expect(useAppStore.getState().inputText).toContain('Pikachu | Jungle | 60')
    expect(useAppStore.getState().inputText).toContain('Squirtle | Base | 63')
  })

  it('dedupes against existing input — re-adding the same line returns 0', () => {
    useAppStore.setState({ inputText: 'Charizard | Base | 4\n' })
    const added = useAppStore.getState().appendInputLines(['Charizard | Base | 4'])
    expect(added).toBe(0)
    expect(useAppStore.getState().inputText).toBe('Charizard | Base | 4\n')
  })

  it('partial dedupe — reports only the freshly-appended count', () => {
    useAppStore.setState({ inputText: 'Pikachu | Jungle | 60\n' })
    const added = useAppStore
      .getState()
      .appendInputLines([
        'Pikachu | Jungle | 60', // dup
        'Charizard | Base | 4', // fresh
        'Squirtle | Base | 63', // fresh
      ])
    expect(added).toBe(2)
    const lines = useAppStore.getState().inputText.trim().split('\n')
    expect(lines).toHaveLength(3)
  })

  it('ignores empty / whitespace-only inputs without bumping the count', () => {
    const added = useAppStore.getState().appendInputLines(['  ', '', '   '])
    expect(added).toBe(0)
    expect(useAppStore.getState().inputText).toBe('')
  })

  it('does not double-stamp the trailing newline when inputText already ends with \\n', () => {
    useAppStore.setState({ inputText: 'foo\n' })
    useAppStore.getState().appendInputLines(['bar'])
    expect(useAppStore.getState().inputText).toBe('foo\nbar\n')
  })

  it('preserves a missing trailing newline by inserting one before the new lines', () => {
    useAppStore.setState({ inputText: 'foo' })
    useAppStore.getState().appendInputLines(['bar'])
    expect(useAppStore.getState().inputText).toBe('foo\nbar\n')
  })

  it('trims whitespace on incoming lines before deduping', () => {
    useAppStore.setState({ inputText: 'Charizard | Base | 4\n' })
    const added = useAppStore.getState().appendInputLines(['  Charizard | Base | 4  '])
    expect(added).toBe(0)
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

describe('store: settings.swipeRarityFloor', () => {
  afterEach(() => {
    useAppStore.getState().resetSettings()
  })

  it("defaults to 'chase' and round-trips through updateSettings", () => {
    expect(useAppStore.getState().settings.swipeRarityFloor).toBe('chase')
    useAppStore.getState().updateSettings({ swipeRarityFloor: 'all' })
    expect(useAppStore.getState().settings.swipeRarityFloor).toBe('all')
  })

  it('resetSettings restores it to chase', () => {
    useAppStore.getState().updateSettings({ swipeRarityFloor: 'rare' })
    useAppStore.getState().resetSettings()
    expect(useAppStore.getState().settings.swipeRarityFloor).toBe('chase')
  })
})

describe('store: settings.density', () => {
  afterEach(() => {
    useAppStore.getState().resetSettings()
  })

  it("defaults to 'comfortable' and round-trips through updateSettings", () => {
    expect(useAppStore.getState().settings.density).toBe('comfortable')
    useAppStore.getState().updateSettings({ density: 'compact' })
    expect(useAppStore.getState().settings.density).toBe('compact')
  })

  it('resetSettings restores it to comfortable', () => {
    useAppStore.getState().updateSettings({ density: 'compact' })
    useAppStore.getState().resetSettings()
    expect(useAppStore.getState().settings.density).toBe('comfortable')
  })
})

describe('store: lastSeenChangelogVersion', () => {
  beforeEach(() => useAppStore.setState({ lastSeenChangelogVersion: null }))

  it('defaults to null', () => {
    expect(useAppStore.getState().lastSeenChangelogVersion).toBeNull()
  })

  it('setLastSeenChangelogVersion records the version', () => {
    useAppStore.getState().setLastSeenChangelogVersion('1.1.1')
    expect(useAppStore.getState().lastSeenChangelogVersion).toBe('1.1.1')
  })
})

describe('store: saved searches', () => {
  beforeEach(() => useAppStore.setState({ runs: [], currentRunId: null }))

  it('defaults to empty list and null current id', () => {
    expect(useAppStore.getState().runs).toEqual([])
    expect(useAppStore.getState().currentRunId).toBeNull()
  })

  it('setRuns replaces the list wholesale (server is source of truth)', () => {
    useAppStore.getState().setRuns([
      {
        id: 1,
        created_at: '2026-06-01T12:00:00Z',
        elapsed_seconds: 1.2,
        row_count: 3,
        summary: {
          total_rows: 3,
          matched: 2,
          missed: 1,
          priced: 2,
          totals_by_currency: { USD: 12.5 },
          tag_counts: { keep: 2 },
        },
        name: 'Show prep',
        view_state: null,
      },
    ])
    expect(useAppStore.getState().runs).toHaveLength(1)
    expect(useAppStore.getState().runs[0].name).toBe('Show prep')
    useAppStore.getState().setRuns([])
    expect(useAppStore.getState().runs).toEqual([])
  })

  it('setCurrentRunId records the loaded run', () => {
    useAppStore.getState().setCurrentRunId(42)
    expect(useAppStore.getState().currentRunId).toBe(42)
    useAppStore.getState().setCurrentRunId(null)
    expect(useAppStore.getState().currentRunId).toBeNull()
  })
})

describe('store: viewState', () => {
  beforeEach(() => {
    useAppStore.setState({
      viewState: { ...EMPTY_VIEW_STATE, filters: { ...EMPTY_VIEW_STATE.filters } },
    })
  })

  it('defaults to the empty view (no sort, no filters, filter row collapsed)', () => {
    expect(useAppStore.getState().viewState).toEqual(EMPTY_VIEW_STATE)
  })

  it('setViewState replaces the snapshot — used on saved-search load to restore', () => {
    const restored = {
      sortColumn: 'market' as const,
      sortDir: 'desc' as const,
      showFilters: true,
      filters: {
        name: '',
        set: 'Base',
        rarity: '',
        marketMin: '5',
        marketMax: '',
        source: '',
      },
    }
    useAppStore.getState().setViewState(restored)
    expect(useAppStore.getState().viewState).toEqual(restored)
  })

  it('resetViewState wipes sort + filters back to the empty view', () => {
    useAppStore.getState().setViewState({
      sortColumn: 'name',
      sortDir: 'asc',
      showFilters: true,
      filters: { ...EMPTY_VIEW_STATE.filters, name: 'pika' },
    })
    useAppStore.getState().resetViewState()
    expect(useAppStore.getState().viewState).toEqual(EMPTY_VIEW_STATE)
  })

  it('resetViewState gives back independent filter objects (mutation safety)', () => {
    useAppStore.getState().resetViewState()
    const first = useAppStore.getState().viewState.filters
    useAppStore.getState().resetViewState()
    const second = useAppStore.getState().viewState.filters
    expect(first).not.toBe(second)
  })
})
