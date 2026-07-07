/**
 * Tests for the first-run swipe onboarding pass (#714): the
 * useSwipeOnboarding state machine (banner gating, dismissal persistence,
 * pass counting, the running → summary transition) and the summary dialog's
 * lean rendering + favorite-set pin gating.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SwipeOnboardingBanner, SwipeOnboardingSummary } from './SwipeOnboarding'
import { ONBOARDING_PASS_LENGTH, useSwipeOnboarding } from './useSwipeOnboarding'
import type { SwipeProfile } from './useSwipeProfile'

const DISMISSED_KEY = 'mgz-pkmn:swipe-onboarding:v1'

function profile(overrides: Partial<SwipeProfile> = {}): SwipeProfile {
  return { rarity: {}, set: {}, tag: {}, seen: [], saved: [], ...overrides }
}

/** Wires the hook to buttons so tests can drive the state machine. */
function Harness({ profile: p }: { profile: SwipeProfile }) {
  const onboarding = useSwipeOnboarding(p)
  return (
    <div>
      {onboarding.showBanner && (
        <SwipeOnboardingBanner onStart={onboarding.start} onDismiss={onboarding.dismiss} />
      )}
      {onboarding.running && <p>running · {onboarding.count}</p>}
      {onboarding.summaryOpen && <p>summary open</p>}
      <button type="button" onClick={() => onboarding.recordSwipe('sv1', 'Scarlet & Violet')}>
        swipe once
      </button>
    </div>
  )
}

beforeEach(() => {
  window.localStorage.removeItem(DISMISSED_KEY)
})

describe('useSwipeOnboarding', () => {
  it('offers the banner on a cold profile', () => {
    render(<Harness profile={profile()} />)
    expect(screen.getByText('New here? Teach Swipe your taste')).toBeInTheDocument()
  })

  it('does not offer the banner once the user has swiped before', () => {
    render(<Harness profile={profile({ seen: ['sv1-1'] })} />)
    expect(screen.queryByText('New here? Teach Swipe your taste')).not.toBeInTheDocument()
  })

  it('dismissal persists across mounts', () => {
    const { unmount } = render(<Harness profile={profile()} />)
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(screen.queryByText('New here? Teach Swipe your taste')).not.toBeInTheDocument()
    unmount()
    render(<Harness profile={profile()} />)
    expect(screen.queryByText('New here? Teach Swipe your taste')).not.toBeInTheDocument()
  })

  it('counts swipes only while running and opens the summary at the pass length', () => {
    render(<Harness profile={profile()} />)
    // Swipes before the pass starts don't count.
    fireEvent.click(screen.getByRole('button', { name: 'swipe once' }))
    expect(screen.queryByText(/running/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start the pass' }))
    expect(screen.getByText('running · 0')).toBeInTheDocument()
    for (let i = 0; i < ONBOARDING_PASS_LENGTH - 1; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'swipe once' }))
    }
    expect(screen.getByText(`running · ${ONBOARDING_PASS_LENGTH - 1}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'swipe once' }))
    expect(screen.getByText('summary open')).toBeInTheDocument()
    expect(screen.queryByText(/running/)).not.toBeInTheDocument()
  })

  it('finishing the pass marks onboarding done in storage', () => {
    render(<Harness profile={profile()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start the pass' }))
    for (let i = 0; i < ONBOARDING_PASS_LENGTH; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'swipe once' }))
    }
    // Storage write happens on closeSummary; the summary itself being open
    // hasn't dismissed yet.
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBeNull()
  })
})

describe('SwipeOnboardingSummary', () => {
  const leanProfile = profile({
    set: { sv1: 3, base1: 1 },
    rarity: { 'Rare Holo': 2, Common: -1 },
    tag: { 'super:Pokémon': 2, 'sub:VMAX': 1 },
  })
  const setNames = { sv1: 'Scarlet & Violet', base1: 'Base Set' }

  it('renders positive leans and strips tag prefixes', () => {
    render(
      <SwipeOnboardingSummary
        open
        profile={leanProfile}
        setNames={setNames}
        canPin={false}
        isPinned={() => false}
        onPin={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Scarlet & Violet')).toBeInTheDocument()
    expect(screen.getByText('Base Set')).toBeInTheDocument()
    expect(screen.getByText('Rare Holo')).toBeInTheDocument()
    // Negative weights never show.
    expect(screen.queryByText('Common')).not.toBeInTheDocument()
    expect(screen.getByText('Pokémon')).toBeInTheDocument()
    expect(screen.getByText('VMAX')).toBeInTheDocument()
    // Signed out — no pin affordance.
    expect(screen.queryByRole('button', { name: /Pin as favorite/ })).not.toBeInTheDocument()
  })

  it('offers pins only for strong set signal when signed in', () => {
    const pinned: string[] = []
    render(
      <SwipeOnboardingSummary
        open
        profile={leanProfile}
        setNames={setNames}
        canPin
        isPinned={(id) => pinned.includes(id)}
        onPin={(id) => pinned.push(id)}
        onClose={() => {}}
      />,
    )
    // sv1 (weight 3) crosses the suggestion threshold; base1 (weight 1) doesn't.
    const pinButtons = screen.getAllByRole('button', { name: /Pin as favorite/ })
    expect(pinButtons).toHaveLength(1)
    fireEvent.click(pinButtons[0])
    expect(pinned).toEqual(['sv1'])
  })

  it('shows the empty-signal copy when the pass learned nothing', () => {
    render(
      <SwipeOnboardingSummary
        open
        profile={profile()}
        setNames={{}}
        canPin={false}
        isPinned={() => false}
        onPin={() => {}}
        onClose={() => {}}
      />,
    )
    expect(
      screen.getByText(/Nothing jumped out this pass/),
    ).toBeInTheDocument()
  })
})
