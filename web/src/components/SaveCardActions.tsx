/**
 * SaveCardActions — the per-card save affordance shared across search, browse,
 * and swipe. The primary action is the one-tap `Want` / `Own` toggle pair
 * ({@link QuickActions}, #761); on the compact surfaces that's all it shows.
 * The detail view (`variant="primary"`) also keeps the list/collection pickers
 * as the secondary "organize" path until the full organize flow lands (#762).
 *
 * Renders nothing when signed out, matching the row (which hides its actions
 * column for anon users).
 */
import type { CardOwnership } from '../api/client'
import { AddToCollectionButton } from './AddToCollectionButton'
import { AddToWishlistButton } from './AddToWishlistButton'
import { QuickActions } from './QuickActions'

export function SaveCardActions({
  card,
  ownership,
  show,
  variant = 'icon',
  className = '',
}: {
  card: Record<string, unknown>
  ownership?: CardOwnership | null
  show: boolean
  variant?: 'icon' | 'primary'
  className?: string
}) {
  if (!show) return null
  if (variant !== 'primary') {
    return (
      <QuickActions
        card={card}
        ownership={ownership}
        show
        variant="icon"
        className={className}
      />
    )
  }
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <QuickActions card={card} ownership={ownership} show variant="primary" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <AddToCollectionButton card={card} variant="primary" />
        <AddToWishlistButton card={card} variant="primary" />
      </div>
    </div>
  )
}
