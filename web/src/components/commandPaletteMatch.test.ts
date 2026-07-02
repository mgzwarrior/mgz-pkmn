import { describe, it, expect, beforeEach } from 'vitest'
import {
  fuzzyScore,
  readRecentCommandIds,
  recordRecentCommandId,
  RECENT_COMMANDS_LIMIT,
} from './commandPaletteMatch'

describe('fuzzyScore', () => {
  it('matches an ordered subsequence case-insensitively', () => {
    expect(fuzzyScore('swp', 'Switch mode: Swipe')).not.toBeNull()
    expect(fuzzyScore('SWP', 'switch mode: swipe')).not.toBeNull()
  })

  it('returns null when the query characters are not all present in order', () => {
    expect(fuzzyScore('zzz', 'Open Settings')).toBeNull()
    expect(fuzzyScore('gnis', 'Open Settings')).toBeNull() // reversed order
  })

  it('treats an empty query as matching everything with score 0', () => {
    expect(fuzzyScore('', 'Open Settings')).toBe(0)
    expect(fuzzyScore('   ', 'Open Settings')).toBe(0)
  })

  it('scores an earlier, more compact match higher than a scattered one', () => {
    const compact = fuzzyScore('open', 'Open Settings')
    const scattered = fuzzyScore('open', 'On the Pilot Extraction Notes')
    expect(compact).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(compact as number).toBeGreaterThan(scattered as number)
  })
})

describe('recent command persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns an empty list when nothing has been recorded', () => {
    expect(readRecentCommandIds()).toEqual([])
  })

  it('moves a re-recorded id to the front instead of duplicating it', () => {
    recordRecentCommandId('open:help')
    recordRecentCommandId('mode:search')
    const result = recordRecentCommandId('open:help')
    expect(result).toEqual(['open:help', 'mode:search'])
    expect(readRecentCommandIds()).toEqual(['open:help', 'mode:search'])
  })

  it('caps the list at RECENT_COMMANDS_LIMIT, dropping the oldest', () => {
    for (let i = 0; i < RECENT_COMMANDS_LIMIT + 3; i++) {
      recordRecentCommandId(`cmd:${i}`)
    }
    const ids = readRecentCommandIds()
    expect(ids).toHaveLength(RECENT_COMMANDS_LIMIT)
    expect(ids[0]).toBe(`cmd:${RECENT_COMMANDS_LIMIT + 2}`)
  })
})
