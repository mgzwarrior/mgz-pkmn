/**
 * OwnershipBadge — the inline "owned / chasing" chip on a card (#576).
 *
 * Renders nothing until ownership is known and non-empty, so it's safe to
 * drop next to any card across search / browse / swipe. Owning supersedes
 * chasing (#761): once the user owns the card it shows "owned" with a quantity
 * counter and the collections in the tooltip, and the chase chip is hidden —
 * the common case is you stop chasing once you have it. Only when the card is
 * purely chased does it show "chasing" with the want-lists in the tooltip.
 *
 * Tone follows the design system's read: palm (have it) for owned, sun
 * (want it) for chasing — the same pairing the swipe deck uses.
 */
import type { CardOwnership } from '../api/client'

export function OwnershipBadge({
  ownership,
  className = '',
}: {
  ownership: CardOwnership | null | undefined
  className?: string
}) {
  if (!ownership) return null
  const { collections, wishlists } = ownership
  if (collections.length === 0 && wishlists.length === 0) return null

  const owned = collections.length > 0
  const ownedQty = collections.reduce((sum, c) => sum + c.quantity, 0)
  const ownedTitle = collections
    .map((c) => (c.quantity > 1 ? `${c.name} (${c.quantity})` : c.name))
    .join(', ')
  const chasingTitle = wishlists.map((w) => w.name).join(', ')

  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {owned ? (
        <span
          title={`Owned in ${ownedTitle}`}
          className="inline-flex items-center rounded-full bg-palm-500/15 px-1.5 py-0.5 text-[11px] font-medium text-palm-600 dark:bg-palm-400/20 dark:text-palm-200"
        >
          owned{ownedQty > 1 ? ` ×${ownedQty}` : ''}
        </span>
      ) : (
        <span
          title={`Chasing on ${chasingTitle}`}
          className="inline-flex items-center rounded-full bg-sun-400/20 px-1.5 py-0.5 text-[11px] font-medium text-husk-500 dark:bg-sun-400/25 dark:text-sun-200"
        >
          chasing
        </span>
      )}
    </span>
  )
}
