/**
 * SaveCardActions — the Save-to-collection + Save-to-wishlist button pair
 * the Search results row carries, reused on Browse and Swipe cards so all
 * three surfaces share one save affordance. Renders nothing when signed
 * out, matching the row (which hides its actions column for anon users).
 */
import { AddToCollectionButton } from './AddToCollectionButton'
import { AddToWishlistButton } from './AddToWishlistButton'

export function SaveCardActions({
  card,
  show,
  variant = 'icon',
  className = '',
}: {
  card: Record<string, unknown>
  show: boolean
  variant?: 'icon' | 'primary'
  className?: string
}) {
  if (!show) return null
  const layout =
    variant === 'primary' ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'flex items-center gap-1'
  return (
    <div className={`${layout} ${className}`}>
      <AddToCollectionButton card={card} variant={variant} />
      <AddToWishlistButton card={card} variant={variant} />
    </div>
  )
}
