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
import { Check, Loader2, Star } from 'lucide-react'
import {
  ownCard,
  unownCard,
  unwantCard,
  wantCard,
  type CardOwnership,
} from '../api/client'
import { invalidateOwnership } from './useCardOwnership'

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

  const wanted = !!ownership && ownership.wishlists.length > 0
  const owned = !!ownership && ownership.collections.length > 0
  const isPrimary = variant === 'primary'

  async function run(action: 'want' | 'own', fn: () => Promise<unknown>) {
    setPending(action)
    try {
      await fn()
      // Bust the shared cache so every mounted surface re-reads the new state.
      invalidateOwnership()
    } finally {
      setPending(null)
    }
  }

  const layout = isPrimary ? 'grid grid-cols-2 gap-2' : 'flex items-center gap-1'
  return (
    <div className={`${layout} ${className}`}>
      <ToggleButton
        label="Want"
        icon={Star}
        active={wanted}
        pending={pending === 'want'}
        disabled={pending !== null}
        tone="sun"
        variant={variant}
        onClick={() => run('want', () => (wanted ? unwantCard(card) : wantCard(card)))}
      />
      <ToggleButton
        label="Own"
        icon={Check}
        active={owned}
        pending={pending === 'own'}
        disabled={pending !== null}
        tone="palm"
        variant={variant}
        onClick={() => run('own', () => (owned ? unownCard(card) : ownCard(card)))}
      />
    </div>
  )
}

const TONES = {
  sun: {
    active: 'border-sun-400 bg-sun-400/20 text-husk-500 dark:bg-sun-400/25 dark:text-sun-200',
    idle: 'border-sand-300 bg-sand-100 text-coconut-500 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200 dark:hover:bg-husk-200',
  },
  palm: {
    active:
      'border-palm-500 bg-palm-500/15 text-palm-600 dark:bg-palm-400/20 dark:text-palm-200',
    idle: 'border-sand-300 bg-sand-100 text-coconut-500 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-200 dark:hover:bg-husk-200',
  },
} as const

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
  icon: typeof Star
  active: boolean
  pending: boolean
  disabled: boolean
  tone: keyof typeof TONES
  variant: 'icon' | 'primary'
  onClick: () => void
}) {
  const isPrimary = variant === 'primary'
  const toneClass = active ? TONES[tone].active : TONES[tone].idle
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
      {(isPrimary || active) && <span>{active ? `${label}ed` : label}</span>}
    </button>
  )
}
