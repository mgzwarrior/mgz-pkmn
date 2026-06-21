/**
 * useSwipeProfile — localStorage-backed taste profile + saved-card list
 * for the Swipe discovery mode.
 *
 * Tracks three signed counters (rarity / set / supertype + subtype) that
 * accumulate from the user's swipe actions, plus the set of card IDs
 * they've already seen so we never show the same card twice. Saved
 * cards are kept verbatim — they become the prep-list payload when the
 * user hits "Build prep list".
 *
 * Persistence is intentionally synchronous + module-level: every render
 * sees the same snapshot, and reads after a `pass` / `save` / `love`
 * call observe the updated state without an effect-tick.
 *
 * Action weights:
 *
 *   pass → -1     (downweight matching attributes)
 *   save →  1     (save the card + upweight)
 *   love →  2     ("more like this" — save + double-weight)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SetCard } from '../types'

const STORAGE_KEY = 'mgz-pkmn:swipe-profile:v1'

export interface SwipeProfile {
  /** Cumulative weight per rarity bucket (e.g. "Rare Holo": 3). */
  rarity: Record<string, number>
  /** Cumulative weight per set id (e.g. "base1": -2). */
  set: Record<string, number>
  /** Cumulative weight per supertype + subtype tag. */
  tag: Record<string, number>
  /** Card IDs already shown — never resurface. */
  seen: string[]
  /** Saved cards, in save order. Becomes the prep-list payload. */
  saved: SavedCard[]
}

/** Verbatim card payload kept on save; same shape the wishlist API expects. */
export interface SavedCard {
  id: string
  name: string
  number: string
  rarity: string | null
  supertype: string | null
  subtypes: string[]
  thumb: string | null
  market: number | null
  /** Owning set id, denormalised so prep-list export doesn't re-derive it. */
  setId: string
}

export type SwipeAction = 'pass' | 'save' | 'love'

/** The three editable counters that make up the visible taste profile. */
export type ProfileBucket = 'rarity' | 'set' | 'tag'

const EMPTY_PROFILE: SwipeProfile = {
  rarity: {},
  set: {},
  tag: {},
  seen: [],
  saved: [],
}

function readStorage(): SwipeProfile {
  if (typeof window === 'undefined') return { ...EMPTY_PROFILE }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_PROFILE }
    const parsed = JSON.parse(raw) as Partial<SwipeProfile>
    return {
      rarity: parsed.rarity ?? {},
      set: parsed.set ?? {},
      tag: parsed.tag ?? {},
      seen: parsed.seen ?? [],
      saved: parsed.saved ?? [],
    }
  } catch {
    return { ...EMPTY_PROFILE }
  }
}

function writeStorage(p: SwipeProfile) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* quota exceeded / SSR / private mode — fall through */
  }
}

let state: SwipeProfile = readStorage()
const listeners = new Set<(p: SwipeProfile) => void>()

function publish(next: SwipeProfile) {
  state = next
  writeStorage(state)
  for (const fn of listeners) fn(state)
}

function bump(
  counter: Record<string, number>,
  key: string | null | undefined,
  weight: number,
): Record<string, number> {
  if (!key) return counter
  return { ...counter, [key]: (counter[key] ?? 0) + weight }
}

/**
 * Set one bucket entry to an explicit weight (manual edit, not a swipe).
 * A weight of 0 drops the key entirely so a neutralised attribute leaves
 * no trace in the profile or in `scoreCard`.
 */
function setWeight(
  profile: SwipeProfile,
  bucket: ProfileBucket,
  key: string,
  weight: number,
): SwipeProfile {
  const next = { ...profile[bucket] }
  if (weight === 0) delete next[key]
  else next[key] = weight
  return { ...profile, [bucket]: next }
}

function bumpTags(
  counter: Record<string, number>,
  card: { supertype: string | null; subtypes: string[] },
  weight: number,
): Record<string, number> {
  let next = counter
  if (card.supertype) next = bump(next, `super:${card.supertype}`, weight)
  for (const sub of card.subtypes ?? []) {
    next = bump(next, `sub:${sub}`, weight)
  }
  return next
}

function record(
  card: SetCard,
  setId: string,
  action: SwipeAction,
  prev: SwipeProfile,
): SwipeProfile {
  const weight = action === 'pass' ? -1 : action === 'save' ? 1 : 2
  const next: SwipeProfile = {
    rarity: bump(prev.rarity, card.rarity, weight),
    set: bump(prev.set, setId, weight),
    tag: bumpTags(prev.tag, card, weight),
    seen: prev.seen.includes(card.id) ? prev.seen : [...prev.seen, card.id],
    saved:
      action === 'pass'
        ? prev.saved
        : [
            ...prev.saved,
            {
              id: card.id,
              name: card.name,
              number: card.number,
              rarity: card.rarity,
              supertype: card.supertype,
              subtypes: card.subtypes,
              thumb: card.thumb,
              market: card.market,
              setId,
            },
          ],
  }
  return next
}

export function useSwipeProfile() {
  const [snapshot, setSnapshot] = useState<SwipeProfile>(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])

  const act = useCallback(
    (card: SetCard, setId: string, action: SwipeAction) => {
      publish(record(card, setId, action, state))
    },
    [],
  )

  const clearSaved = useCallback(() => {
    publish({ ...state, saved: [] })
  }, [])

  const reset = useCallback(() => {
    publish({ ...EMPTY_PROFILE })
  }, [])

  // Manual edits to the visible profile (#711). `adjustWeight` nudges one
  // entry by a delta; `clearWeight` neutralises it. Both drop the key when
  // the weight lands on 0 so the profile only carries live signal.
  const adjustWeight = useCallback(
    (bucket: ProfileBucket, key: string, delta: number) => {
      publish(setWeight(state, bucket, key, (state[bucket][key] ?? 0) + delta))
    },
    [],
  )

  const clearWeight = useCallback((bucket: ProfileBucket, key: string) => {
    publish(setWeight(state, bucket, key, 0))
  }, [])

  /** Score a candidate by current profile weights. Higher = better match. */
  const scoreCard = useCallback((card: SetCard, setId: string): number => {
    let score = 0
    if (card.rarity) score += snapshot.rarity[card.rarity] ?? 0
    score += snapshot.set[setId] ?? 0
    if (card.supertype) score += snapshot.tag[`super:${card.supertype}`] ?? 0
    for (const sub of card.subtypes ?? []) {
      score += snapshot.tag[`sub:${sub}`] ?? 0
    }
    return score
  }, [snapshot])

  // Memoize so downstream `useEffect` deps don't churn each render.
  const seenSet = useMemo(() => new Set(snapshot.seen), [snapshot.seen])

  return {
    profile: snapshot,
    seenSet,
    act,
    clearSaved,
    reset,
    scoreCard,
    adjustWeight,
    clearWeight,
  }
}

// Test-only: reset both the module-level state and any subscribed
// listeners + the storage backing it. Production code should not call
// this.
export function _resetSwipeProfileForTests() {
  state = { ...EMPTY_PROFILE }
  listeners.clear()
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
}
