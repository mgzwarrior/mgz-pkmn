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
 *
 * The "Build prep list" CTA appears once the user has saved at least
 * one card. It opens an inline form that creates a new wishlist via
 * [useWishlists](./useWishlists.ts) and adds every saved card, then
 * clears the local saved list so the next session starts fresh.
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
import type { Row, SetCard } from '../types'
import { browseCardToPayload, browseCardToRow } from './browseCard'
import { CardDetailModal } from './CardDetailModal'
import { SaveCardActions } from './SaveCardActions'
import {
  useSwipeProfile,
  type SavedCard,
  type SwipeAction,
} from './useSwipeProfile'
import { STACK_SIZE, useSwipeCandidates } from './useSwipeCandidates'
import { useWishlists } from './useWishlists'

/** Horizontal-drag threshold (px) that commits a pass/save decision. */
const SWIPE_THRESHOLD_X = 110
/** Vertical-drag threshold (px) — up commits a "love". */
const SWIPE_THRESHOLD_Y = 110
/** Pointer movement (px) past which a gesture counts as a drag, not a tap.
 *  Below it, releasing opens the detail modal instead. */
const CLICK_SLOP = 6

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
  const { profile, seenSet, act, clearSaved, reset } = useSwipeProfile()
  const { current, upcoming, loading, exhausted, error, advance } =
    useSwipeCandidates({
      active,
      seenSet,
    })
  const { user } = useAuth()
  const showSavedActions = user !== null

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
        setOutgoing(null)
        setDrag(null)
        advance()
      }, 180)
    },
    [current, act, advance],
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
      className="flex flex-col gap-4 rounded-lg border border-sand-300 bg-sand-50 px-5 py-5 dark:border-husk-50 dark:bg-husk-200"
    >
      <SwipeHeader savedCount={profile.saved.length} onReset={reset} />

      <div className="flex flex-col items-center gap-3">
        {error && (
          <p
            role="alert"
            className="w-full rounded border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-sm text-ember-400 dark:border-ember-500/50 dark:bg-ember-500/30 dark:text-ember-300"
          >
            Couldn’t load cards: {error}
          </p>
        )}

        {exhausted && !current && (
          <ExhaustedState onReset={reset} />
        )}

        {!current && !exhausted && (
          <LoadingCard loading={loading} />
        )}

        {current && (
          // The whole stack renders as one keyed list so the next card
          // keeps its DOM node as it's promoted from peek to top — it
          // *rises* into place rather than the old node being reused and
          // sliding back in from off-screen. `pb-4` reserves room for the
          // deepest peek, which is translated below the top card.
          <div className="w-full max-w-xs pb-4">
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

        {current && (
          <SaveCardActions
            show={showSavedActions}
            card={browseCardToPayload(current.card, {
              id: current.setId,
              name: current.setName,
            })}
            className="justify-center"
          />
        )}

        <KeyboardHint />
      </div>

      {profile.saved.length > 0 && (
        <BuildPrepList saved={profile.saved} onCleared={clearSaved} />
      )}

      <CardDetailModal
        rows={detailRows}
        index={detailOpen && current ? 0 : null}
        onChangeIndex={(next) => setDetailOpen(next !== null)}
      />
    </section>
  )
}

function SwipeHeader({
  savedCount,
  onReset,
}: {
  savedCount: number
  onReset: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-coconut-700 dark:text-sand-50">
          Swipe
        </h2>
        <p className="text-xs text-coconut-400 dark:text-sand-300">
          One card at a time — right to save, left to pass, up for more like this.
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="text-xs text-coconut-400 underline-offset-2 hover:underline dark:text-sand-300"
      >
        {savedCount > 0 ? `${savedCount} saved · reset` : 'Reset profile'}
      </button>
    </div>
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

function KeyboardHint() {
  return (
    <p className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-coconut-400 dark:text-sand-400">
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
      className="flex aspect-[245/342] w-full max-w-xs items-center justify-center rounded-xl border border-dashed border-sand-300 bg-sand-50 text-sm text-coconut-400 dark:border-husk-50 dark:bg-husk-400 dark:text-sand-300"
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
      className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-dashed border-sand-300 bg-sand-50 px-4 py-8 text-center text-sm text-coconut-500 dark:border-husk-50 dark:bg-husk-400 dark:text-sand-200"
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

/**
 * BuildPrepList — bottom-of-panel CTA. Inline form that creates a new
 * wishlist from the user's saved cards and adds each one in order. On
 * success it clears the local saved list so the user starts fresh on
 * the next swipe session; the new wishlist is visible immediately in
 * the Library because both surfaces share the
 * [useWishlists](./useWishlists.ts) cache.
 */
function BuildPrepList({
  saved,
  onCleared,
}: {
  saved: SavedCard[]
  onCleared: () => void
}) {
  const { create, addCard } = useWishlists()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const defaultName = `Swipe picks · ${new Date().toLocaleDateString()}`

  async function handleBuild() {
    const finalName = (name.trim() || defaultName).slice(0, 80)
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const wishlist = await create(finalName)
      for (const card of saved) {
        await addCard(wishlist.id, savedCardToPayload(card))
      }
      setSuccess(`Saved ${saved.length} card${saved.length === 1 ? '' : 's'} to “${finalName}”.`)
      setName('')
      onCleared()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-sand-200 bg-sand-100 px-4 py-3 dark:border-husk-100 dark:bg-husk-400/60">
      <h3 className="text-sm font-semibold text-coconut-700 dark:text-sand-50">
        Build a prep list
      </h3>
      <p className="mt-0.5 text-xs text-coconut-400 dark:text-sand-300">
        Turn your {saved.length} saved card{saved.length === 1 ? '' : 's'} into
        a wishlist you can take to the next show.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName}
          aria-label="Prep list name"
          className="flex-1 min-w-[180px] rounded border border-sand-300 bg-sand-50 px-2 py-1.5 text-sm text-coconut-700 placeholder:text-coconut-300 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-coconut-500 dark:bg-husk-100 dark:text-sand-50 dark:placeholder:text-sand-500 dark:focus:ring-sun-300"
        />
        <button
          type="button"
          onClick={() => void handleBuild()}
          disabled={busy || saved.length === 0}
          className="rounded bg-palm-400 px-3 py-1.5 text-sm font-medium text-sand-50 hover:bg-palm-300 disabled:opacity-50 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200"
        >
          {busy ? (
            <span className="flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Building…
            </span>
          ) : (
            'Build prep list'
          )}
        </button>
      </div>
      {success && (
        <p
          role="status"
          className="mt-2 text-xs text-palm-500 dark:text-palm-200"
        >
          {success}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-2 text-xs text-ember-400 dark:text-ember-300"
        >
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Reshape a SavedCard into the verbatim card payload the wishlist API
 * accepts. Mirrors the trimmed shape used elsewhere in the SPA so the
 * wishlist row can re-render with thumbnail + price without another
 * lookup.
 */
function savedCardToPayload(card: SavedCard): Record<string, unknown> {
  return {
    id: card.id,
    name: card.name,
    number: card.number,
    rarity: card.rarity,
    supertype: card.supertype,
    subtypes: card.subtypes,
    images: card.thumb ? { small: card.thumb } : undefined,
    set: { id: card.setId },
    _swipe_market: card.market,
  }
}
