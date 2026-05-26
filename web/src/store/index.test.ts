import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAppStore } from './index'

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
