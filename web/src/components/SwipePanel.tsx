/**
 * SwipePanel — Tinder-style card-at-a-time discovery surface for the
 * Swipe mode tab. Renders one candidate at a time and accepts pass /
 * save / love decisions via mouse drag, touch swipe, keyboard
 * (← → ↑), or the action buttons below the card.
 *
 * The two underlying hooks split responsibilities:
 *
 *   - {@link useSwipeProfile} owns the local-storage-backed taste profile
 *     and saved-card list.
 *   - {@link useSwipeCandidates} owns the candidate queue (which set we
 *     walk and which card is current).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Heart,
  ImageOff,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAppStore } from '../store'
import type { RarityFloor, Row, SetCard } from '../types'
import { browseCardToPayload, browseCardToRow } from './browseCard'
import { CardDetailModal } from './CardDetailModal'
import { FavoriteSetsPanel } from './FavoriteSetsPanel'
import { favoriteSpeciesBoost } from './favoriteSpeciesBoost'
import { useFavoritePokemon } from './useFavoritePokemon'
import { useFavoriteSets } from './useFavoriteSets'
import { useCardOwnership } from './useCardOwnership'
import { OwnershipBadge } from './OwnershipBadge'
import { SaveCardActions } from './SaveCardActions'
import { useSwipeProfile, type SwipeAction } from './useSwipeProfile'
import { SwipeProfilePanel } from './SwipeProfilePanel'
import { useIsMobileViewport } from './useIsMobileViewport'
import { STACK_SIZE, useSwipeCandidates } from './useSwipeCandidates'
import { useSwipeExclusions } from './useSwipeExclusions'

/** Horizontal-drag threshold (px) that commits a pass/save decision. */
const SWIPE_THRESHOLD_X = 110
/** Vertical-drag threshold (px) — up commits a "love". */
const SWIPE_THRESHOLD_Y = 110
/** Pointer movement (px) past which a gesture counts as a drag, not a tap.
 *  Below it, releasing opens the detail modal instead. */
const CLICK_SLOP = 6
/** Profile-score bonus a pinned favorite set adds to its walk weight (#713).
 *  Sized so an explicit pin outweighs an accreted lean and lands a set near
 *  the multiplier cap, without zeroing out the rest of the catalog. */
const FAVORITE_SET_BONUS = 12

interface Drag {
  startX: number
  startY: number
  dx: number
  dy: number
  pointerId: number
}

interface SwipePanelProps {
  /** Whether the Swipe tab is currently active; pauses fetching when false. */
  active: boolean
}

export function SwipePanel({ active }: SwipePanelProps) {
  const { profile, seenSet, act, reset, scoreCard } =
    useSwipeProfile()
  const { settings, updateSettings } = useAppStore()
  const { user } = useAuth()
  const isMobile = useIsMobileViewport()
  const showSavedActions = user !== null
  // Favorite sets feed the candidate weighting; gate the fetch on a signed-in
  // user (they're per-user) so a signed-out deck isn't biased by — and doesn't
  // hit the endpoint as — the default user.
  const { isPinned } = useFavoriteSets({ enabled: showSavedActions })
  // Favorite Pokémon (#742) feed the card weighting the same way pinned sets
  // feed the set weighting; same signed-in gate.
  const { isFavorite } = useFavoritePokemon({ enabled: showSavedActions })

  // Profile-weighted candidate selection (#713). `setScore` biases which set
  // is walked next — the learned per-set lean plus a strong bonus for pinned
  // favorites; `cardScore` biases the card within it via the full taste
  // profile plus a bonus when the card is a favorite Pokémon (#742). Both fall
  // back to a flat 0 (the unbiased walk) before any signal.
  const setScore = useCallback(
    (setId: string) =>
      (profile.set[setId] ?? 0) + (isPinned(setId) ? FAVORITE_SET_BONUS : 0),
    [profile.set, isPinned],
  )
  const cardScore = useCallback(
    (card: SetCard, setId: string) =>
      scoreCard(card, setId) + favoriteSpeciesBoost(card, isFavorite),
    [scoreCard, isFavorite],
  )
  const { excludedKeys, recordSeen, resetDeck } = useSwipeExclusions({
    excludeOwned: settings.swipeExcludeOwned,
    excludeChasing: settings.swipeExcludeChasing,
  })
  const { current, upcoming, loading, exhausted, error, advance } =
    useSwipeCandidates({
      active,
      seenSet,
      excludedKeys,
      rarityFloor: settings.swipeRarityFloor,
      setScore,
      cardScore,
    })

  // Cross-collection ownership badge (#576). Prefetch the current card plus
  // the peeks beneath it so the badge is ready as each rises to the top.
  // Only signed-in users have a library to check, matching the save buttons.
  const ownershipIds = useMemo(
    () =>
      showSavedActions
        ? [current, ...upcoming]
            .filter((c): c is NonNullable<typeof c> => c != null)
            .map((c) => ({ setId: c.setId, number: c.card.number }))
        : [],
    [showSavedActions, current, upcoming],
  )
  const { lookup: lookupOwnership } = useCardOwnership(ownershipIds)

  // Reset both the local taste profile (session-local seen + saved) and the
  // server-persisted deck memory, so "reset" surfaces a genuinely fresh deck.
  const handleReset = useCallback(() => {
    reset()
    resetDeck()
  }, [reset, resetDeck])

  const [drag, setDrag] = useState<Drag | null>(null)
  const [outgoing, setOutgoing] = useState<SwipeAction | null>(null)
  // Open the detail modal for the current candidate. The modal navigates a
  // `Row[]`, so a one-element array of the current card is enough — there's
  // no queue to step through here.
  const [detailOpen, setDetailOpen] = useState(false)
  // Distinguishes a tap (opens the detail modal) from a drag (a swipe
  // decision). Set true once a pointer moves past the click slop so the
  // trailing click event after a drag doesn't pop the modal open.
  const movedRef = useRef(false)

  const detailRows = useMemo<Row[]>(
    () =>
      current
        ? [browseCardToRow(current.card, { id: current.setId, name: current.setName })]
        : [],
    [current],
  )

  const commit = useCallback(
    (action: SwipeAction) => {
      if (!current) return
      setOutgoing(action)
      // Let the exit animation play before swapping the card.
      window.setTimeout(() => {
        act(current.card, current.setId, action)
        // Persist the card as seen so it never resurfaces in a future
        // session (#581). Local `seenSet` handles the in-session no-repeat;
        // this is the durable layer.
        recordSeen(current.setId, current.card.number, action)
        setOutgoing(null)
        setDrag(null)
        advance()
      }, 180)
    },
    [current, act, recordSeen, advance],
  )

  // Keyboard shortcuts — global while the panel is mounted + active.
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (!current || outgoing || detailOpen) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        commit('pass')
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        commit('save')
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        commit('love')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, current, outgoing, detailOpen, commit])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (outgoing) return
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      movedRef.current = false
      setDrag({
        startX: e.clientX,
        startY: e.clientY,
        dx: 0,
        dy: 0,
        pointerId: e.pointerId,
      })
    },
    [outgoing],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setDrag((d) => {
        if (!d || d.pointerId !== e.pointerId) return d
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP)
          movedRef.current = true
        return { ...d, dx, dy }
      })
    },
    [],
  )

  // A pointer release that never crossed the click slop is a tap → open the
  // detail modal. A real drag (movedRef set) or an in-flight exit animation
  // suppresses it so swipes don't double as taps.
  const onCardClick = useCallback(() => {
    if (outgoing || movedRef.current) return
    setDetailOpen(true)
  }, [outgoing])

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      setDrag((d) => {
        if (!d || d.pointerId !== e.pointerId) return d
        if (-d.dy > SWIPE_THRESHOLD_Y && Math.abs(d.dy) > Math.abs(d.dx)) {
          commit('love')
        } else if (d.dx > SWIPE_THRESHOLD_X) {
          commit('save')
        } else if (-d.dx > SWIPE_THRESHOLD_X) {
          commit('pass')
        }
        return null
      })
    },
    [commit],
  )

  return (
    <section
      aria-label="Swipe mode"
      data-tour="swipe"
      className="flex flex-col gap-3 rounded-lg border border-sand-300 bg-sand-50 px-4 py-4 lg:gap-4 lg:px-5 lg:py-5 dark:border-husk-50 dark:bg-husk-200"
    >
      <SwipeHeader
        savedCount={profile.saved.length}
        onReset={handleReset}
        rarityFloor={settings.swipeRarityFloor}
        onRarityFloorChange={(swipeRarityFloor) =>
          updateSettings({ swipeRarityFloor })
        }
        showLibraryToggles={showSavedActions}
        excludeOwned={settings.swipeExcludeOwned}
        excludeChasing={settings.swipeExcludeChasing}
        onExcludeOwnedChange={(swipeExcludeOwned) =>
          updateSettings({ swipeExcludeOwned })
        }
        onExcludeChasingChange={(swipeExcludeChasing) =>
          updateSettings({ swipeExcludeChasing })
        }
      />

      {/* Favorite sets + Your taste sit in a side column beside the deck on
          desktop — the centered card leaves that width empty on a wide
          screen anyway, so pulling them out of the vertical stack (and out
          from between the header and the card) gives them a real home
          instead of pushing the deck down when a panel is opened. Phones
          keep them below the deck so the card and its actions still land in
          the first viewport (#845). Rendered conditionally (not flex
          `order`) so tab and screen-reader order match the visual order. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {!isMobile && (
          <div className="flex flex-col gap-3 lg:sticky lg:top-20 lg:w-72 lg:flex-shrink-0">
            <TuningPanels showFavoriteSets={showSavedActions} />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
          {error && (
            <p
              role="alert"
              className="w-full rounded border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-sm text-ember-400 dark:border-ember-500/50 dark:bg-ember-500/30 dark:text-ember-300"
            >
              Couldn’t load cards: {error}
            </p>
          )}

          {exhausted && !current && (
            <ExhaustedState onReset={handleReset} />
          )}

          {!current && !exhausted && (
            <LoadingCard loading={loading} />
          )}

          {current && (
            // The whole stack renders as one keyed list so the next card
            // keeps its DOM node as it's promoted from peek to top — it
            // *rises* into place rather than the old node being reused and
            // sliding back in from off-screen. `pb-4` reserves room for the
            // deepest peek, which is translated below the top card. The
            // narrower phone cap keeps the card + action row inside a
            // 375×812 first viewport (#845).
            <div className="w-full max-w-[280px] pb-4 lg:max-w-xs">
              <div className="relative">
                {[current, ...upcoming].slice(0, STACK_SIZE).map((cand, depth) =>
                  depth === 0 ? (
                    <SwipeCard
                      key={cand.card.id}
                      card={cand.card}
                      setName={cand.setName}
                      depth={0}
                      drag={drag}
                      outgoing={outgoing}
                      interactive
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerEnd}
                      onPointerCancel={onPointerEnd}
                      onClick={onCardClick}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          setDetailOpen(true)
                        }
                      }}
                    />
                  ) : (
                    <SwipeCard
                      key={cand.card.id}
                      card={cand.card}
                      setName={cand.setName}
                      depth={depth}
                      drag={null}
                      outgoing={null}
                      interactive={false}
                    />
                  ),
                )}
              </div>
            </div>
          )}

          {current && (
            <ActionRow
              onPass={() => commit('pass')}
              onSave={() => commit('save')}
              onLove={() => commit('love')}
              disabled={!!outgoing}
            />
          )}

          {current && showSavedActions && (
            <OwnershipBadge
              ownership={lookupOwnership(current.setId, current.card.number)}
              className="justify-center"
            />
          )}

          {current && (
            <SaveCardActions
              show={showSavedActions}
              card={browseCardToPayload(current.card, {
                id: current.setId,
                name: current.setName,
              })}
              ownership={lookupOwnership(current.setId, current.card.number)}
              className="justify-center"
            />
          )}

          <SwipeHint />

          {isMobile && <TuningPanels showFavoriteSets={showSavedActions} />}
        </div>
      </div>

      <CardDetailModal
        rows={detailRows}
        index={detailOpen && current ? 0 : null}
        onChangeIndex={(next) => setDetailOpen(next !== null)}
      />
    </section>
  )
}

/**
 * The Favorite sets + Your taste accordions — a sticky side column beside
 * the deck on desktop, below it on phones (#845). Favorite sets are durable
 * + per-user, so that panel is gated on a signed-in user like the other
 * user-scoped Swipe controls — an anonymous mount would otherwise read/write
 * the default user's favorites. The taste profile is browser-local, so it
 * shows for everyone.
 */
function TuningPanels({ showFavoriteSets }: { showFavoriteSets: boolean }) {
  return (
    <>
      {showFavoriteSets && <FavoriteSetsPanel />}
      <SwipeProfilePanel />
    </>
  )
}

/** Floor options for the swipe-header control, most → least selective. */
const RARITY_FLOOR_OPTIONS: { value: RarityFloor; label: string }[] = [
  { value: 'chase', label: 'Chase cards' },
  { value: 'rare', label: 'Rare and up' },
  { value: 'all', label: 'Everything' },
]

function SwipeHeader({
  savedCount,
  onReset,
  rarityFloor,
  onRarityFloorChange,
  showLibraryToggles,
  excludeOwned,
  excludeChasing,
  onExcludeOwnedChange,
  onExcludeChasingChange,
}: {
  savedCount: number
  onReset: () => void
  rarityFloor: RarityFloor
  onRarityFloorChange: (floor: RarityFloor) => void
  /** Library-aware toggles only make sense with a library — hidden when
   *  signed out (the endpoints would 401). */
  showLibraryToggles: boolean
  excludeOwned: boolean
  excludeChasing: boolean
  onExcludeOwnedChange: (next: boolean) => void
  onExcludeChasingChange: (next: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
          Swipe
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-coconut-400 dark:text-sand-300">
            <span className="sr-only sm:not-sr-only">Show</span>
            <select
              aria-label="Rarity floor"
              value={rarityFloor}
              onChange={(e) => onRarityFloorChange(e.target.value as RarityFloor)}
              className="rounded-md border border-sand-300 bg-sand-50 px-2 py-1 text-xs text-coconut-700 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:focus:ring-sun-300"
            >
              {RARITY_FLOOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-coconut-400 underline-offset-2 hover:underline dark:text-sand-300"
          >
            {savedCount > 0 ? `${savedCount} saved · reset` : 'Reset profile'}
          </button>
        </div>
      </div>
      {/* Full-width so it doesn't squeeze beside the controls; on phones the
          gesture guidance moves below the deck (see SwipeHint) so the card
          lands in the first viewport (#845). */}
      <p className="hidden text-xs text-coconut-400 lg:block dark:text-sand-300">
        One card at a time — right to save, left to pass, up for more like this.
      </p>
      {showLibraryToggles && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-coconut-400 dark:text-sand-300">
          <span className="text-coconut-400 dark:text-sand-400">Hide</span>
          <LibraryToggle
            label="owned"
            title="Don't show cards already in your collections"
            checked={excludeOwned}
            onChange={onExcludeOwnedChange}
          />
          <LibraryToggle
            label="chasing"
            title="Don't show cards already on your wishlists"
            checked={excludeChasing}
            onChange={onExcludeChasingChange}
          />
        </div>
      )}
    </div>
  )
}

/** One library-aware exclusion checkbox in the swipe header (#581). */
function LibraryToggle({
  label,
  title,
  checked,
  onChange,
}: {
  label: string
  title: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-sand-300 text-palm-500 focus:ring-palm-400 dark:border-husk-50 dark:bg-husk-100 dark:text-sun-300 dark:focus:ring-sun-300"
      />
      <span>{label}</span>
    </label>
  )
}

/**
 * Per-depth positioning for the cards peeking beneath the top card.
 * Index = stack depth (0 is the top card, styled separately). Each peek
 * sits slightly lower and smaller, edges showing like a physical deck;
 * `transition-transform` (on the card) animates the rise as it's promoted.
 */
const PEEK_CLASSES = [
  '',
  'absolute inset-0 z-10 scale-95 translate-y-2',
  'absolute inset-0 z-0 scale-90 translate-y-4',
]

/** Shared card chrome for both the interactive top card and the peeks. */
const CARD_BASE =
  'w-full rounded-xl border border-sand-300 bg-sand-50 p-3 shadow-lg shadow-coconut-700/10 dark:border-husk-50 dark:bg-husk-400 dark:shadow-coconut-900/40'

/**
 * SwipeCard — one card in the stack. The top card (`interactive`) carries
 * the drag/exit transform and all the gesture handlers; peeks are inert
 * (`pointer-events-none`, `aria-hidden`) and positioned by their depth.
 * Both branches return a `<div>` so React keeps the DOM node when a peek
 * is promoted to the top — that node persistence is what makes the rise
 * animate instead of snapping.
 */
function SwipeCard({
  card,
  setName,
  depth,
  drag,
  outgoing,
  interactive,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
  onKeyDown,
}: {
  card: SetCard
  setName: string
  depth: number
  drag: Drag | null
  outgoing: SwipeAction | null
  interactive: boolean
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel?: (e: React.PointerEvent<HTMLDivElement>) => void
  onClick?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
}) {
  if (interactive) {
    return (
      <div
        data-testid="swipe-card"
        role="button"
        tabIndex={0}
        aria-label={`View details for ${card.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
        onKeyDown={onKeyDown}
        style={cardTransformStyle(drag, outgoing)}
        className={`relative z-20 cursor-pointer touch-none select-none ${CARD_BASE}`}
      >
        <CardArtwork card={card} />
        <CardMeta card={card} setName={setName} />
        <DragHint drag={drag} outgoing={outgoing} />
      </div>
    )
  }
  return (
    <div
      aria-hidden
      className={`pointer-events-none select-none transition-transform duration-200 ease-out ${
        PEEK_CLASSES[depth] ?? PEEK_CLASSES[PEEK_CLASSES.length - 1]
      } ${CARD_BASE}`}
    >
      <CardArtwork card={card} />
      <CardMeta card={card} setName={setName} />
    </div>
  )
}

function CardArtwork({ card }: { card: SetCard }) {
  const [thumbFailed, setThumbFailed] = useState(false)
  return (
    <div className="relative aspect-[245/342] w-full overflow-hidden rounded-lg bg-sand-200 dark:bg-husk-100">
      {card.thumb && !thumbFailed ? (
        <img
          src={card.thumb}
          alt={card.name}
          className="h-full w-full object-contain"
          draggable={false}
          onError={() => setThumbFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-coconut-300 dark:text-sand-400">
          <ImageOff size={36} aria-hidden />
        </div>
      )}
    </div>
  )
}

function CardMeta({ card, setName }: { card: SetCard; setName: string }) {
  return (
    <div className="mt-3 flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="truncate text-base font-semibold text-coconut-700 dark:text-sand-50"
          title={card.name}
        >
          {card.name}
        </div>
        {card.market != null && (
          <span className="shrink-0 text-sm font-medium text-palm-500 dark:text-palm-200">
            ${card.market.toFixed(2)}
          </span>
        )}
      </div>
      <div className="text-xs text-coconut-400 dark:text-sand-300">
        {setName} · #{card.number}
        {card.rarity ? ` · ${card.rarity}` : ''}
      </div>
    </div>
  )
}

function DragHint({
  drag,
  outgoing,
}: {
  drag: Drag | null
  outgoing: SwipeAction | null
}) {
  const decision = outgoing ?? decisionFor(drag)
  if (!decision) return null
  const label =
    decision === 'pass' ? 'Pass' : decision === 'save' ? 'Save' : 'Love'
  const tone =
    decision === 'pass'
      ? 'bg-ember-500/85 text-sand-50'
      : decision === 'save'
        ? 'bg-palm-500/90 text-sand-50'
        : 'bg-sun-400/90 text-husk-500'
  return (
    <span
      aria-hidden
      className={`absolute left-1/2 top-3 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider shadow ${tone}`}
    >
      {label}
    </span>
  )
}

function decisionFor(drag: Drag | null): SwipeAction | null {
  if (!drag) return null
  if (-drag.dy > SWIPE_THRESHOLD_Y && Math.abs(drag.dy) > Math.abs(drag.dx))
    return 'love'
  if (drag.dx > SWIPE_THRESHOLD_X) return 'save'
  if (-drag.dx > SWIPE_THRESHOLD_X) return 'pass'
  return null
}

function cardTransformStyle(
  drag: Drag | null,
  outgoing: SwipeAction | null,
): React.CSSProperties {
  if (outgoing) {
    const dx = outgoing === 'pass' ? -480 : outgoing === 'save' ? 480 : 0
    const dy = outgoing === 'love' ? -540 : 0
    const rot = outgoing === 'pass' ? -16 : outgoing === 'save' ? 16 : 0
    return {
      transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
      transition: 'transform 180ms ease-out, opacity 180ms ease-out',
      opacity: 0,
    }
  }
  if (!drag) {
    return { transition: 'transform 160ms ease-out' }
  }
  const rot = Math.max(-12, Math.min(12, drag.dx / 18))
  return {
    transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${rot}deg)`,
  }
}

function ActionRow({
  onPass,
  onSave,
  onLove,
  disabled,
}: {
  onPass: () => void
  onSave: () => void
  onLove: () => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-4" role="group" aria-label="Swipe actions">
      <ActionButton
        label="Pass"
        title="Pass (←)"
        onClick={onPass}
        disabled={disabled}
        tone="pass"
      >
        <X size={22} aria-hidden />
      </ActionButton>
      <ActionButton
        label="More like this"
        title="More like this (↑)"
        onClick={onLove}
        disabled={disabled}
        tone="love"
      >
        <Sparkles size={20} aria-hidden />
      </ActionButton>
      <ActionButton
        label="Save"
        title="Save (→)"
        onClick={onSave}
        disabled={disabled}
        tone="save"
      >
        <Heart size={22} aria-hidden />
      </ActionButton>
    </div>
  )
}

function ActionButton({
  label,
  title,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string
  title: string
  onClick: () => void
  disabled: boolean
  tone: 'pass' | 'save' | 'love'
  children: React.ReactNode
}) {
  const tones: Record<'pass' | 'save' | 'love', string> = {
    pass: 'border-ember-400/50 text-ember-400 hover:bg-ember-500/10 dark:border-ember-500/60 dark:text-ember-300 dark:hover:bg-ember-500/20',
    save: 'border-palm-400 text-palm-500 hover:bg-palm-500/10 dark:border-palm-400 dark:text-palm-200 dark:hover:bg-palm-500/25',
    love: 'border-sun-400 text-sun-500 hover:bg-sun-400/15 dark:border-sun-400 dark:text-sun-300 dark:hover:bg-sun-400/25',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={`flex h-12 w-12 items-center justify-center rounded-full border-2 bg-sand-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:bg-husk-200 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

/**
 * Guidance under the action row. Phones get the gesture sentence (the
 * header hides it there to keep the card above the fold, #845); larger
 * screens get the arrow-key legend, since that's where keyboards live.
 */
function SwipeHint() {
  return (
    <>
      <p className="text-xs text-coconut-400 lg:hidden dark:text-sand-400">
        Right to save, left to pass, up for more like this.
      </p>
      <p className="hidden flex-wrap items-center justify-center gap-1.5 text-[11px] text-coconut-400 lg:flex dark:text-sand-400">
        <KeyChip>
          <ArrowLeft size={11} />
        </KeyChip>
        pass
        <KeyChip>
          <ArrowUp size={11} />
        </KeyChip>
        more like this
        <KeyChip>
          <ArrowRight size={11} />
        </KeyChip>
        save
      </p>
    </>
  )
}

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-sand-300 bg-sand-200 px-1 py-0.5 text-coconut-600 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200">
      {children}
    </span>
  )
}

function LoadingCard({ loading }: { loading: boolean }) {
  return (
    <div
      className="flex aspect-[245/342] w-full max-w-[280px] items-center justify-center rounded-xl border border-dashed border-sand-300 bg-sand-50 text-sm text-coconut-400 lg:max-w-xs dark:border-husk-50 dark:bg-husk-400 dark:text-sand-300"
      role="status"
      aria-live="polite"
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Finding a card…
        </span>
      ) : (
        <span>Loading sets…</span>
      )}
    </div>
  )
}

function ExhaustedState({ onReset }: { onReset: () => void }) {
  return (
    <div
      className="flex w-full max-w-[280px] flex-col items-center gap-3 rounded-xl border border-dashed border-sand-300 bg-sand-50 px-4 py-8 text-center text-sm text-coconut-500 lg:max-w-xs dark:border-husk-50 dark:bg-husk-400 dark:text-sand-200"
      role="status"
    >
      <p>You’ve seen every card in the recent sets.</p>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-sand-300 bg-sand-100 px-3 py-1.5 text-xs text-coconut-700 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:hover:bg-husk-50"
      >
        Reset and start over
      </button>
    </div>
  )
}
