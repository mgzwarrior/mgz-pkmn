/**
 * SwipeProfilePanel — the visible, editable taste profile for Swipe mode
 * (#711, part of the personalization epic #701).
 *
 * Surfaces the counters {@link useSwipeProfile} accretes from every pass /
 * save / love, grouped four ways:
 *
 *   - **Sets** — the per-set lean (`profile.set`), labelled with the
 *     friendly set name from the baked catalog.
 *   - **Types** — supertype + subtype tags (`profile.tag`).
 *   - **Rarity** — the per-rarity lean (`profile.rarity`).
 *   - **Eras** — a read-only rollup of the set lean grouped by the set's
 *     `series` (the canonical TCG era). Derived, so it isn't edited
 *     directly — adjust the underlying sets and the era moves with them.
 *
 * The first three are stored counters, so each entry gets inline controls
 * to nudge (−/+) or clear (×) its weight. Persistence stays local for now
 * (the hook is localStorage-backed); server durability arrives with the
 * favorite-set work (#712).
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Minus, Plus, X } from 'lucide-react'
import { BAKED_SETS } from '../data/sets'
import {
  useSwipeProfile,
  type ProfileBucket,
  type SwipeProfile,
} from './useSwipeProfile'

/** set id → friendly name + series, resolved once from the baked catalog. */
const SET_META = new Map(
  BAKED_SETS.map((s) => [s.id, { name: s.name, series: s.series }]),
)

/** One displayable profile entry: a stored key, its weight, and its label. */
interface Entry {
  key: string
  weight: number
  label: string
}

/** Most-loved first; passes sink to the bottom. */
function byWeightDesc(a: Entry, b: Entry): number {
  return b.weight - a.weight
}

function toEntries(
  counter: Record<string, number>,
  label: (key: string) => string,
): Entry[] {
  return Object.entries(counter)
    .map(([key, weight]) => ({ key, weight, label: label(key) }))
    .sort(byWeightDesc)
}

/** Strip the `super:` / `sub:` prefix off a tag key for display. */
function tagLabel(key: string): string {
  return key.replace(/^(super|sub):/, '')
}

/** Roll the per-set lean up into eras via each set's `series`. */
function eraEntries(setCounter: Record<string, number>): Entry[] {
  const byEra: Record<string, number> = {}
  for (const [setId, weight] of Object.entries(setCounter)) {
    const era = SET_META.get(setId)?.series
    if (!era) continue // can't place an unknown set into an era
    byEra[era] = (byEra[era] ?? 0) + weight
  }
  return toEntries(byEra, (era) => era)
}

function isEmpty(profile: SwipeProfile): boolean {
  return (
    Object.keys(profile.rarity).length === 0 &&
    Object.keys(profile.set).length === 0 &&
    Object.keys(profile.tag).length === 0
  )
}

export function SwipeProfilePanel() {
  const { profile, adjustWeight, clearWeight } = useSwipeProfile()
  const [open, setOpen] = useState(false)

  const sets = useMemo(
    () =>
      toEntries(profile.set, (id) => SET_META.get(id)?.name ?? id),
    [profile.set],
  )
  const types = useMemo(() => toEntries(profile.tag, tagLabel), [profile.tag])
  const rarity = useMemo(
    () => toEntries(profile.rarity, (r) => r),
    [profile.rarity],
  )
  const eras = useMemo(() => eraEntries(profile.set), [profile.set])

  const signalCount = sets.length + types.length + rarity.length
  const empty = isEmpty(profile)

  return (
    <div className="rounded-lg border border-sand-300 bg-sand-50 dark:border-husk-50 dark:bg-husk-100">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-coconut-700 dark:text-sand-50">
            Your taste
          </span>
          <span className="text-xs text-coconut-400 dark:text-sand-300">
            {empty
              ? 'nothing yet'
              : `${signalCount} ${signalCount === 1 ? 'signal' : 'signals'}`}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-coconut-400 transition-transform dark:text-sand-300 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-sand-300 px-4 py-3 dark:border-husk-50">
          {empty ? (
            <p className="text-xs text-coconut-400 dark:text-sand-300">
              Swipe a few cards and your taste starts showing up here — the sets,
              types, eras, and rarities you lean toward.
            </p>
          ) : (
            <>
              <ProfileGroup
                title="Sets"
                bucket="set"
                entries={sets}
                onAdjust={adjustWeight}
                onClear={clearWeight}
              />
              <ProfileGroup
                title="Types"
                bucket="tag"
                entries={types}
                onAdjust={adjustWeight}
                onClear={clearWeight}
              />
              <EraSummary entries={eras} />
              <ProfileGroup
                title="Rarity"
                bucket="rarity"
                entries={rarity}
                onAdjust={adjustWeight}
                onClear={clearWeight}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ProfileGroup({
  title,
  bucket,
  entries,
  onAdjust,
  onClear,
}: {
  title: string
  bucket: ProfileBucket
  entries: Entry[]
  onAdjust: (bucket: ProfileBucket, key: string, delta: number) => void
  onClear: (bucket: ProfileBucket, key: string) => void
}) {
  if (entries.length === 0) return null
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-coconut-300 dark:text-sand-400">
        {title}
      </h3>
      <ul className="flex flex-col gap-1">
        {entries.map((e) => (
          <li
            key={e.key}
            className="flex items-center justify-between gap-2 text-sm text-coconut-700 dark:text-sand-50"
          >
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              <WeightPill weight={e.weight} />
              <button
                type="button"
                aria-label={`Less like ${e.label}`}
                onClick={() => onAdjust(bucket, e.key, -1)}
                className="rounded p-0.5 text-coconut-400 hover:bg-sand-200 hover:text-coconut-700 dark:text-sand-300 dark:hover:bg-husk-200 dark:hover:text-sand-50"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`More like ${e.label}`}
                onClick={() => onAdjust(bucket, e.key, 1)}
                className="rounded p-0.5 text-coconut-400 hover:bg-sand-200 hover:text-coconut-700 dark:text-sand-300 dark:hover:bg-husk-200 dark:hover:text-sand-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Forget ${e.label}`}
                onClick={() => onClear(bucket, e.key)}
                className="rounded p-0.5 text-coconut-400 hover:bg-ember-500/10 hover:text-ember-400 dark:text-sand-300 dark:hover:bg-ember-500/20 dark:hover:text-ember-300"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Read-only era rollup — eras are derived from sets, not edited directly. */
function EraSummary({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return null
  return (
    <section aria-label="Eras" className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-coconut-300 dark:text-sand-400">
        Eras
      </h3>
      <ul className="flex flex-col gap-1">
        {entries.map((e) => (
          <li
            key={e.key}
            className="flex items-center justify-between gap-2 text-sm text-coconut-700 dark:text-sand-50"
          >
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            <WeightPill weight={e.weight} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Signed-weight chip: warm palm for a lean toward, muted for against. */
function WeightPill({ weight }: { weight: number }) {
  const positive = weight > 0
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${
        positive
          ? 'bg-palm-500/15 text-palm-600 dark:bg-palm-500/25 dark:text-palm-300'
          : 'bg-coconut-700/10 text-coconut-400 dark:bg-husk-200 dark:text-sand-300'
      }`}
    >
      {positive ? `+${weight}` : weight}
    </span>
  )
}
