/**
 * InsightsNavButton — the top-nav entry point into the Collection insights
 * dashboard (#741). Hidden until the user has a meaningful library so it
 * doesn't clutter the header for newcomers; it surfaces once 25+ cards are
 * collected.
 *
 * The collected count reuses the already-loaded `useCollections` cache (sum
 * of vendor multiples), so the gate costs no extra round-trip. Dynamic
 * collections are excluded — they own no rows, and their resolved membership
 * either double-counts owned cards or reflects an un-owned catalog, so
 * counting them would misrepresent how much you actually hold.
 */
import { BarChart3 } from 'lucide-react'
import { useState } from 'react'
import { useCollections } from './useCollections'
import { CollectionInsights } from './CollectionInsights'

/** How many collected cards before the insights entry point appears. */
export const INSIGHTS_NAV_THRESHOLD = 25

export function InsightsNavButton() {
  const { collections } = useCollections()
  const [open, setOpen] = useState(false)

  const collected = collections
    .filter((c) => c.kind !== 'dynamic')
    .reduce((n, c) => n + (c.total_quantity ?? c.item_count), 0)

  if (collected < INSIGHTS_NAV_THRESHOLD) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Collection insights"
        className="flex items-center gap-1.5 rounded-md border border-sand-300 bg-sand-100 px-3 py-1.5 text-sm text-coconut-700 hover:bg-sand-200 hover:border-sand-400 dark:border-husk-50 dark:bg-husk-200 dark:text-sand-50 dark:hover:bg-husk-100 dark:hover:border-coconut-400 transition-colors"
      >
        <BarChart3 size={14} />
        Insights
      </button>
      <CollectionInsights open={open} onOpenChange={setOpen} />
    </>
  )
}
