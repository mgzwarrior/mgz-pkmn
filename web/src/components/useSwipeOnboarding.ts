/**
 * useSwipeOnboarding — state machine for the first-run onboarding swipe
 * pass (#714, epic #701): idle → running → summary → idle.
 *
 * Lives beside {@link useSwipeProfile} rather than inside it — the profile
 * doesn't know or care that some swipes happened during onboarding; the
 * pass just counts the normal pass / save / love commits. Dismissal is
 * browser-local (same lifetime as the profile itself): declining or
 * finishing the pass stops the offer, and resetting the profile brings it
 * back with the fresh deck.
 */
import { useCallback, useState } from 'react'
import type { SwipeProfile } from './useSwipeProfile'

/** How many swipes make a pass — enough for real signal, under a minute. */
export const ONBOARDING_PASS_LENGTH = 10

const DISMISSED_KEY = 'mgz-pkmn:swipe-onboarding:v1'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === 'done'
  } catch {
    return false
  }
}

function writeDismissed() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISSED_KEY, 'done')
  } catch {
    /* quota exceeded / private mode — the banner just re-offers next visit */
  }
}

type Stage = 'idle' | 'running' | 'summary'

interface PassState {
  stage: Stage
  count: number
  setNames: Record<string, string>
}

const IDLE: PassState = { stage: 'idle', count: 0, setNames: {} }

export interface SwipeOnboarding {
  /** Show the inline start banner (cold profile, not dismissed, not running). */
  showBanner: boolean
  /** The pass is in progress. */
  running: boolean
  /** Swipes committed so far in the pass. */
  count: number
  /** The finish summary dialog is open. */
  summaryOpen: boolean
  /** Set names captured during the pass, for the summary's set list. */
  setNames: Record<string, string>
  start: () => void
  dismiss: () => void
  /** Call once per committed swipe with the card's owning set. */
  recordSwipe: (setId: string, setName: string) => void
  closeSummary: () => void
}

export function useSwipeOnboarding(profile: SwipeProfile): SwipeOnboarding {
  const [dismissed, setDismissed] = useState(readDismissed)
  const [pass, setPass] = useState<PassState>(IDLE)

  // Cold = nothing ever swiped in this browser. `seen` also resets with the
  // deck, so "Reset profile" re-offers the pass alongside the fresh deck.
  const cold = profile.seen.length === 0

  const start = useCallback(() => {
    setPass({ stage: 'running', count: 0, setNames: {} })
  }, [])

  const dismiss = useCallback(() => {
    writeDismissed()
    setDismissed(true)
  }, [])

  // One pure functional update per swipe — the running → summary transition
  // is computed inside it, so there's no effect and no nested setState.
  const recordSwipe = useCallback((setId: string, setName: string) => {
    setPass((p) => {
      if (p.stage !== 'running') return p
      const count = p.count + 1
      return {
        stage: count >= ONBOARDING_PASS_LENGTH ? 'summary' : 'running',
        count,
        setNames: p.setNames[setId] ? p.setNames : { ...p.setNames, [setId]: setName },
      }
    })
  }, [])

  const closeSummary = useCallback(() => {
    // Finishing the pass counts as "onboarded" — don't re-offer the banner.
    writeDismissed()
    setDismissed(true)
    setPass(IDLE)
  }, [])

  return {
    showBanner: pass.stage === 'idle' && cold && !dismissed,
    running: pass.stage === 'running',
    count: pass.count,
    summaryOpen: pass.stage === 'summary',
    setNames: pass.setNames,
    start,
    dismiss,
    recordSwipe,
    closeSummary,
  }
}
