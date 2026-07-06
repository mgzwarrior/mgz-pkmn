/**
 * QuickActions — one-tap `Want` / `Own` toggles (#761, ADR-0027).
 *
 * The low-friction primary action on every card surface: a single tap writes
 * the card to the user's default wishlist / collection (no picker), and tapping
 * again reverses it. Controlled by the shared ownership state (like
 * {@link OwnershipBadge}) so all three surfaces keep batching their lookups —
 * the buttons reflect `wanted` / `owned` and, after an action, bust the shared
 * cache so every surface re-reads the new state.
 *
 * The existing list/collection pickers remain as the secondary "organize"
 * affordance; the full organize flow is #762.
 */
import { useState } from 'react'
import { Book, Footprints, Loader2 } from 'lucide-react'
import {
  hasPersonalOwnership,
  ownCard,
  unownCard,
  unwantCard,
  wantCard,
  type CardOwnership,
} from '../api/client'
import { invalidateOwnership } from './useCardOwnership'
import { refreshCollectionsCache } from './useCollections'
import { refreshWishlistsCache } from './useWishlists'
import { QUICK_ACTION_TONES } from './quickActionTones'

interface Props {
  card: Record<string, unknown>
  /** The card's current occupancy, from the surface's shared lookup. */
  ownership: CardOwnership | null | undefined
  show: boolean
  variant?: 'icon' | 'primary'
  className?: string
}

export function QuickActions({ card, ownership, show, variant = 'icon', className = '' }: Props) {
  const [pending, setPending] = useState<'want' | 'own' | null>(null)
  if (!show) return null

  // `undefined` means the batched ownership lookup is still in flight (vs.
  // `null`, a known-empty result). Don't let a tap fire while it's unknown —
  // we'd pick the add path on a card the user already has, breaking the
  // tap-again-to-reverse toggle (#767 review).
  const loading = ownership === undefined
  const wanted = !!ownership && ownership.wishlists.length > 0
  const owned = hasPersonalOwnership(ownership)
  const isPrimary = variant === 'primary'

  async function run(action: 'want' | 'own', fn: () => Promise<unknown>) {
    setPending(action)
    try {
      await fn()
      // Bust the shared ownership cache so every mounted surface re-reads the
      // new state, and refresh the affected library list — a one-tap save can
      // create or re-create the default list, so its row + "default" marker
      // stay live without a remount (#762, parity with the bulk save).
      invalidateOwnership()
      await (action === 'own' ? refreshCollectionsCache() : refreshWishlistsCache())
    } finally {
      setPending(null)
    }
  }

  const layout = isPrimary ? 'grid grid-cols-2 gap-2' : 'flex items-center gap-1'
  return (
    <div className={`${layout} ${className}`}>
      <ToggleButton
        label="Want"
        icon={Footprints}
        active={wanted}
        pending={pending === 'want'}
        disabled={pending !== null || loading}
        tone="sun"
        variant={variant}
        onClick={() => run('want', () => (wanted ? unwantCard(card) : wantCard(card)))}
      />
      <ToggleButton
        label="Own"
        icon={Book}
        active={owned}
        pending={pending === 'own'}
        disabled={pending !== null || loading}
        tone="palm"
        variant={variant}
        onClick={() => run('own', () => (owned ? unownCard(card) : ownCard(card)))}
      />
    </div>
  )
}

function ToggleButton({
  label,
  icon: Icon,
  active,
  pending,
  disabled,
  tone,
  variant,
  onClick,
}: {
  label: string
  icon: typeof Book
  active: boolean
  pending: boolean
  disabled: boolean
  tone: keyof typeof QUICK_ACTION_TONES
  variant: 'icon' | 'primary'
  onClick: () => void
}) {
  const isPrimary = variant === 'primary'
  const toneClass = active ? QUICK_ACTION_TONES[tone].active : QUICK_ACTION_TONES[tone].idle
  const size = isPrimary ? 'px-3 py-1.5 text-xs' : 'px-2 py-1 text-[11px]'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={active ? `Remove from ${label.toLowerCase()}` : label}
      className={`inline-flex items-center justify-center gap-1 rounded-md border font-medium disabled:opacity-60 ${size} ${toneClass}`}
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      {/* Only the roomy detail view shows a text label (with a tense flip:
          Want → Wanted). The compact surfaces stay icon-only to save space on
          mobile and lean on the colour + the ownership chips for state (#761). */}
      {isPrimary && <span>{active ? `${label}ed` : label}</span>}
    </button>
  )
}
