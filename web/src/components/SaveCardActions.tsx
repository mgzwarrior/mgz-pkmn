/**
 * SaveCardActions — the per-card save affordance shared across search, browse,
 * swipe, and the detail modal. The one action everywhere is the one-tap
 * `Want` / `Own` toggle pair ({@link QuickActions}, #761), which replaced the
 * old collection / want-list pickers. Organizing into dedicated collections is
 * a separate flow (#762).
 *
 * Renders nothing when signed out, matching the row (which hides its actions
 * column for anon users).
 */
import type { CardOwnership } from '../api/client'
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
  return (
    <QuickActions card={card} ownership={ownership} show variant={variant} className={className} />
  )
}
