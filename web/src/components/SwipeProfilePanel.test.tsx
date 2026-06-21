import { describe, it, expect, beforeEach } from 'vitest'
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { SwipeProfilePanel } from './SwipeProfilePanel'
import {
  useSwipeProfile,
  _resetSwipeProfileForTests,
} from './useSwipeProfile'
import type { SetCard } from '../types'

function card(overrides: Partial<SetCard> = {}): SetCard {
  return {
    id: 'neo1-1',
    name: 'Lugia',
    number: '1',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    thumb: null,
    market: 12,
    ...overrides,
  }
}

/** Seed the shared profile store, then render the panel against it. */
function seed(fn: (p: ReturnType<typeof useSwipeProfile>) => void) {
  const { result } = renderHook(() => useSwipeProfile())
  act(() => fn(result.current))
  return result
}

function expand() {
  fireEvent.click(screen.getByRole('button', { name: /your taste/i }))
}

describe('SwipeProfilePanel', () => {
  beforeEach(() => {
    _resetSwipeProfileForTests()
  })

  it('shows an empty-state hint when no signal has accrued', () => {
    render(<SwipeProfilePanel />)
    expect(screen.getByText(/nothing yet/i)).toBeInTheDocument()
    expand()
    expect(
      screen.getByText(/swipe a few cards and your taste/i),
    ).toBeInTheDocument()
  })

  it('groups the profile by set, type, era, and rarity with friendly labels', () => {
    seed((p) => p.act(card({ subtypes: ['V'] }), 'neo1', 'love'))
    render(<SwipeProfilePanel />)
    expand()

    // Set label resolves to the friendly catalog name, not the raw id.
    expect(within(screen.getByLabelText('Sets')).getByText('Neo Genesis')).toBeInTheDocument()
    // Era rolls the set up by its series.
    expect(within(screen.getByLabelText('Eras')).getByText('Neo')).toBeInTheDocument()
    // Types strip the super:/sub: prefix.
    const types = within(screen.getByLabelText('Types'))
    expect(types.getByText('Pokémon')).toBeInTheDocument()
    expect(types.getByText('V')).toBeInTheDocument()
    // Rarity passes through verbatim.
    expect(within(screen.getByLabelText('Rarity')).getByText('Rare Holo')).toBeInTheDocument()
    // A love is +2.
    expect(screen.getAllByText('+2').length).toBeGreaterThan(0)
  })

  it('nudges a weight up via the +1 control', () => {
    const result = seed((p) => p.act(card(), 'neo1', 'save')) // neo1 = +1
    render(<SwipeProfilePanel />)
    expand()
    fireEvent.click(screen.getByRole('button', { name: /more like neo genesis/i }))
    expect(result.current.profile.set['neo1']).toBe(2)
  })

  it('clears a single entry via the forget control', () => {
    const result = seed((p) => p.act(card(), 'neo1', 'love')) // neo1 = +2
    render(<SwipeProfilePanel />)
    expand()
    fireEvent.click(screen.getByRole('button', { name: /forget neo genesis/i }))
    expect('neo1' in result.current.profile.set).toBe(false)
    // The rarity signal it came in with is untouched.
    expect(result.current.profile.rarity['Rare Holo']).toBe(2)
  })
})
