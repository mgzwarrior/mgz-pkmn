/**
 * SwipeOnboarding — first-run onboarding via a bounded swipe pass (#714,
 * epic #701).
 *
 * When the taste profile is cold (nothing swiped yet), the Swipe tab offers
 * an opt-in guided pass: swipe through a small fixed number of cards and the
 * normal pass / save / love actions seed the profile — no separate deck, no
 * special write path. On finish, a summary shows what the pass learned and,
 * for signed-in users with strong set signal, offers one-tap favorite-set
 * pins.
 *
 * The entry point is an inline banner inside the Swipe panel, not a pop-up,
 * so it can't collide with the Tour or the favorite-Pokémon survey (#742) —
 * a brand-new account can meet all three without them stacking.
 *
 * The state machine lives in {@link useSwipeOnboarding}; this file is the
 * three render surfaces (banner, progress chip, finish summary).
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Sparkles, Star, X } from 'lucide-react'
import { useMemo } from 'react'
import type { SwipeProfile } from './useSwipeProfile'
import { ONBOARDING_PASS_LENGTH } from './useSwipeOnboarding'

/** Set weight at or above which the summary suggests pinning it — two
 *  saves or one love, so a single stray save doesn't read as a lean. */
const SUGGEST_PIN_WEIGHT = 2

/** How many entries each summary column shows. */
const TOP_N = 3

/** The opt-in entry point, rendered inline above the deck when cold. */
export function SwipeOnboardingBanner({
  onStart,
  onDismiss,
}: {
  onStart: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="region"
      aria-label="Swipe onboarding"
      className="flex w-full flex-col gap-2 rounded-lg border border-sun-400/50 bg-sun-400/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-sun-300/40 dark:bg-sun-300/10"
    >
      <div className="flex items-start gap-2.5">
        <Sparkles size={18} className="mt-0.5 shrink-0 text-sun-500 dark:text-sun-300" aria-hidden />
        <div>
          <p className="text-sm font-medium text-coconut-700 dark:text-sand-50">
            New here? Teach Swipe your taste
          </p>
          <p className="text-xs text-coconut-400 dark:text-sand-300">
            A quick {ONBOARDING_PASS_LENGTH}-card pass seeds your profile — every swipe counts.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2.5 py-1.5 text-xs text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
        >
          No thanks
        </button>
        <button
          type="button"
          onClick={onStart}
          className="rounded-md bg-palm-500 px-3 py-1.5 text-xs font-medium text-sand-50 hover:bg-palm-600 dark:bg-palm-400 dark:text-husk-500 dark:hover:bg-palm-300"
        >
          Start the pass
        </button>
      </div>
    </div>
  )
}

/** Progress chip shown while the pass runs. */
export function SwipeOnboardingProgress({ count }: { count: number }) {
  return (
    <p
      role="status"
      className="rounded-full border border-sun-400/50 bg-sun-400/10 px-3 py-1 text-xs font-medium text-coconut-600 dark:border-sun-300/40 dark:bg-sun-300/10 dark:text-sand-200"
    >
      Learning your taste — {Math.min(count, ONBOARDING_PASS_LENGTH)} of {ONBOARDING_PASS_LENGTH}
    </p>
  )
}

/** One positive-weight entry the summary can render. */
interface Lean {
  key: string
  label: string
  weight: number
}

function topLeans(counter: Record<string, number>, label: (key: string) => string): Lean[] {
  return Object.entries(counter)
    .filter(([, w]) => w > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_N)
    .map(([key, weight]) => ({ key, label: label(key), weight }))
}

/** `super:Pokémon` → `Pokémon`, `sub:VMAX` → `VMAX`. */
function tagLabel(key: string): string {
  return key.replace(/^(super|sub):/, '')
}

/**
 * The finish summary: what the pass learned, plus one-tap favorite-set pins
 * where the set signal is strong. `canPin` gates the pin affordance on a
 * signed-in user — favorite sets are server-side and per-user.
 */
export function SwipeOnboardingSummary({
  open,
  profile,
  setNames,
  canPin,
  isPinned,
  onPin,
  onClose,
}: {
  open: boolean
  profile: SwipeProfile
  setNames: Record<string, string>
  canPin: boolean
  isPinned: (setId: string) => boolean
  onPin: (setId: string) => void
  onClose: () => void
}) {
  const sets = useMemo(
    () => topLeans(profile.set, (id) => setNames[id] ?? id),
    [profile.set, setNames],
  )
  const rarities = useMemo(() => topLeans(profile.rarity, (k) => k), [profile.rarity])
  const tags = useMemo(() => topLeans(profile.tag, tagLabel), [profile.tag])
  const suggested = sets.filter((s) => s.weight >= SUGGEST_PIN_WEIGHT)
  const learnedNothing = sets.length === 0 && rarities.length === 0 && tags.length === 0

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 backdrop-blur-sm dark:bg-husk-500/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(480px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200">
          <header className="flex items-start justify-between gap-3 border-b border-sand-200 px-5 py-4 dark:border-husk-100">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
                Here&rsquo;s your lean
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-coconut-400 dark:text-sand-300">
                {learnedNothing
                  ? 'Nothing jumped out this pass — keep swiping and your profile will fill in.'
                  : 'Swipe keeps learning from here — you can edit any of this under Your taste.'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-1 text-coconut-500 hover:bg-sand-200 dark:text-sand-300 dark:hover:bg-husk-100"
              >
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </header>

          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            {sets.length > 0 && (
              <SummarySection title="Sets you leaned toward">
                <ul className="flex flex-col gap-1.5">
                  {sets.map((s) => (
                    <li key={s.key} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm text-coconut-700 dark:text-sand-50">
                        {s.label}
                      </span>
                      {canPin && suggested.some((g) => g.key === s.key) && (
                        <button
                          type="button"
                          onClick={() => onPin(s.key)}
                          disabled={isPinned(s.key)}
                          className="flex shrink-0 items-center gap-1 rounded-md border border-sun-400 px-2 py-1 text-xs text-sun-500 hover:bg-sun-400/15 disabled:cursor-default disabled:opacity-60 dark:border-sun-300 dark:text-sun-300 dark:hover:bg-sun-300/15"
                        >
                          <Star
                            size={12}
                            className={isPinned(s.key) ? 'fill-sun-400 dark:fill-sun-300' : ''}
                            aria-hidden
                          />
                          {isPinned(s.key) ? 'Pinned' : 'Pin as favorite'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </SummarySection>
            )}

            {rarities.length > 0 && (
              <SummarySection title="Rarities">
                <ChipRow leans={rarities} />
              </SummarySection>
            )}

            {tags.length > 0 && (
              <SummarySection title="Card types">
                <ChipRow leans={tags} />
              </SummarySection>
            )}
          </div>

          <footer className="flex items-center justify-end border-t border-sand-200 px-5 py-3 dark:border-husk-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-palm-500 px-3 py-1.5 text-sm font-medium text-sand-50 hover:bg-palm-600 dark:bg-palm-400 dark:text-husk-500 dark:hover:bg-palm-300"
            >
              Keep swiping
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-coconut-600 dark:text-sand-200">
        {title}
      </h3>
      {children}
    </section>
  )
}

function ChipRow({ leans }: { leans: Lean[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {leans.map((l) => (
        <li
          key={l.key}
          className="rounded-full border border-sand-300 bg-sand-100 px-2.5 py-0.5 text-xs text-coconut-600 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200"
        >
          {l.label}
        </li>
      ))}
    </ul>
  )
}
