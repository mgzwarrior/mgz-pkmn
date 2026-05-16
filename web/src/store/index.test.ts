import { describe, it, expect, beforeEach } from 'vitest'
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
})
