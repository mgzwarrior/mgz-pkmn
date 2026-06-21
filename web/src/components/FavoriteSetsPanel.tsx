/**
 * FavoriteSetsPanel — pin favorite sets and get suggestions for which to
 * pin (#712, part of the personalization epic #701).
 *
 * Two halves:
 *
 *   - **Pinned** — the durable, server-side favorite-sets list from
 *     {@link useFavoriteSets}, shown as removable chips. This is the signal
 *     other surfaces (search defaults, set ID cards, candidate weighting)
 *     will read.
 *   - **Suggestions** — sets the user might love, merging two signals: the
 *     owned-card count the server tallies from their collections, and the
 *     positive swipe lean in {@link useSwipeProfile}'s `set` counter. Each
 *     suggestion pins with one click.
 *
 * Set ids resolve to friendly names via the baked catalog. The panel hides
 * itself when there's nothing pinned and nothing to suggest, so a cold
 * account doesn't carry an empty shell.
 */
import { useMemo } from 'react'
import { Plus, Star, X } from 'lucide-react'
import { BAKED_SETS } from '../data/sets'
import { useFavoriteSets } from './useFavoriteSets'
import { useSwipeProfile } from './useSwipeProfile'

/** set id → friendly name, resolved once from the baked catalog. */
const SET_NAME = new Map(BAKED_SETS.map((s) => [s.id, s.name]))

function setName(setId: string): string {
  return SET_NAME.get(setId) ?? setId
}

/** How many suggestions to surface — enough to act on, short of a long tail. */
const MAX_SUGGESTIONS = 6

interface Suggestion {
  setId: string
  ownedCount: number
  swipeWeight: number
}

/** Plain-language reason a set is being suggested. */
function reason(s: Suggestion): string {
  const parts: string[] = []
  if (s.ownedCount > 0) {
    parts.push(`${s.ownedCount} owned`)
  }
  if (s.swipeWeight > 0) {
    parts.push('loved in swipe')
  }
  return parts.join(' · ')
}

export function FavoriteSetsPanel() {
  const { favorites, suggestions, pin, unpin } = useFavoriteSets()
  const { profile } = useSwipeProfile()

  const pinnedIds = useMemo(
    () => new Set(favorites.map((f) => f.set_id)),
    [favorites],
  )

  // Merge the server owned-signal suggestions with the client's positive
  // swipe lean, drop anything already pinned, and rank by a combined score
  // (a strong swipe lean counts as much as a couple of owned cards).
  const merged = useMemo<Suggestion[]>(() => {
    const byId = new Map<string, Suggestion>()
    for (const s of suggestions) {
      if (pinnedIds.has(s.set_id)) continue
      byId.set(s.set_id, {
        setId: s.set_id,
        ownedCount: s.owned_count,
        swipeWeight: profile.set[s.set_id] ?? 0,
      })
    }
    for (const [setId, weight] of Object.entries(profile.set)) {
      if (weight <= 0 || pinnedIds.has(setId)) continue
      const existing = byId.get(setId)
      if (existing) existing.swipeWeight = weight
      else byId.set(setId, { setId, ownedCount: 0, swipeWeight: weight })
    }
    return [...byId.values()]
      .sort(
        (a, b) =>
          b.ownedCount + b.swipeWeight - (a.ownedCount + a.swipeWeight),
      )
      .slice(0, MAX_SUGGESTIONS)
  }, [suggestions, profile.set, pinnedIds])

  // Nothing pinned and nothing worth suggesting — stay out of the way.
  if (favorites.length === 0 && merged.length === 0) return null

  return (
    <section
      aria-label="Favorite sets"
      className="flex flex-col gap-3 rounded-lg border border-sand-300 bg-sand-50 px-4 py-3 dark:border-husk-50 dark:bg-husk-100"
    >
      <div className="flex items-center gap-1.5">
        <Star
          className="h-4 w-4 text-sun-500 dark:text-sun-300"
          aria-hidden
        />
        <h3 className="text-sm font-semibold text-coconut-700 dark:text-sand-50">
          Favorite sets
        </h3>
      </div>

      {favorites.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {favorites.map((f) => (
            <li key={f.set_id}>
              <span className="inline-flex items-center gap-1 rounded-full border border-sun-500/40 bg-sun-500/10 py-1 pl-3 pr-1 text-sm text-coconut-700 dark:border-sun-300/40 dark:bg-sun-300/15 dark:text-sand-50">
                {setName(f.set_id)}
                <button
                  type="button"
                  aria-label={`Unpin ${setName(f.set_id)}`}
                  onClick={() => void unpin(f.set_id)}
                  className="rounded-full p-0.5 text-coconut-400 hover:bg-ember-500/15 hover:text-ember-400 dark:text-sand-300 dark:hover:bg-ember-500/25 dark:hover:text-ember-300"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {merged.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-coconut-400 dark:text-sand-300">
            {favorites.length > 0 ? 'More to pin' : 'You seem to love'}
          </p>
          <ul className="flex flex-col gap-1">
            {merged.map((s) => (
              <li
                key={s.setId}
                className="flex items-center justify-between gap-2 text-sm text-coconut-700 dark:text-sand-50"
              >
                <span className="min-w-0 flex-1 truncate">
                  {setName(s.setId)}
                  <span className="ml-2 text-xs text-coconut-400 dark:text-sand-300">
                    {reason(s)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Pin ${setName(s.setId)}`}
                  onClick={() => void pin(s.setId)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sand-300 px-2 py-1 text-xs text-coconut-700 hover:border-sun-500 hover:text-sun-600 dark:border-husk-50 dark:text-sand-50 dark:hover:border-sun-300 dark:hover:text-sun-300"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Pin
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
