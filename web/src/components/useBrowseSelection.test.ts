import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBrowseSelection } from './useBrowseSelection'
import type { CardData } from '../types'

const CHARIZARD: CardData = { id: 'base1-4', name: 'Charizard', number: '4', set: { id: 'base1' } }
const BLASTOISE: CardData = { id: 'base1-2', name: 'Blastoise', number: '2', set: { id: 'base1' } }

describe('useBrowseSelection (#913)', () => {
  it('starts out of select mode with nothing selected', () => {
    const { result } = renderHook(() => useBrowseSelection())
    expect(result.current.selectMode).toBe(false)
    expect(result.current.selected).toEqual([])
    expect(result.current.isSelected(CHARIZARD)).toBe(false)
  })

  it('toggles select mode and clears any selection when leaving it', () => {
    const { result } = renderHook(() => useBrowseSelection())
    act(() => result.current.toggleSelectMode())
    expect(result.current.selectMode).toBe(true)

    act(() => result.current.toggle(CHARIZARD))
    expect(result.current.selected).toEqual([CHARIZARD])

    act(() => result.current.toggleSelectMode())
    expect(result.current.selectMode).toBe(false)
    expect(result.current.selected).toEqual([])
  })

  it('toggles individual cards in and out of the selection by identity', () => {
    const { result } = renderHook(() => useBrowseSelection())
    act(() => result.current.toggle(CHARIZARD))
    act(() => result.current.toggle(BLASTOISE))
    expect(result.current.selected).toHaveLength(2)
    expect(result.current.isSelected(CHARIZARD)).toBe(true)

    act(() => result.current.toggle(CHARIZARD))
    expect(result.current.selected).toEqual([BLASTOISE])
    expect(result.current.isSelected(CHARIZARD)).toBe(false)
  })

  it('clear empties the selection without leaving select mode', () => {
    const { result } = renderHook(() => useBrowseSelection())
    act(() => result.current.toggleSelectMode())
    act(() => result.current.toggle(CHARIZARD))
    act(() => result.current.clear())
    expect(result.current.selectMode).toBe(true)
    expect(result.current.selected).toEqual([])
  })
})
