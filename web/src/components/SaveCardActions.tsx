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
  className = '',
}: {
  card: Record<string, unknown>
  show: boolean
  className?: string
}) {
  if (!show) return null
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <AddToCollectionButton card={card} />
      <AddToWishlistButton card={card} />
    </div>
  )
}
