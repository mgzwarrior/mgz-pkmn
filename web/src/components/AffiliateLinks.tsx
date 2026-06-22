/**
 * AffiliateLinks — eBay + TCGPlayer "buy" links for a resolved card (#657).
 *
 * One link per marketplace, each a keyword search to the card's exact
 * printing (see `utils/affiliateLinks`). Links open in a new tab and carry
 * `rel="sponsored noopener"` so the affiliate relationship is declared and
 * the opener is detached. Renders nothing when the card has no name to search
 * on — unmatched rows and bare cards just skip the affordance.
 *
 * Two layouts share one builder:
 *   - `inline` (default) — compact text links for the results-table row.
 *   - `pill` — bordered buttons for the card detail modal's "Buy" block.
 */
import { ExternalLink } from 'lucide-react'
import type { CardData } from '../types'
import { ebayAffiliateUrl, tcgplayerAffiliateUrl } from '../utils/affiliateLinks'

const REL = 'sponsored noopener'

const INLINE_CLASS =
  'inline-flex items-center gap-0.5 text-xs font-medium text-coconut-400 hover:text-palm-500 dark:text-sand-300 dark:hover:text-sun-300 transition-colors'

const PILL_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-sand-300 dark:border-husk-50 bg-sand-50 dark:bg-husk-400 px-2.5 py-1 text-xs font-semibold text-palm-600 hover:border-palm-400 hover:text-palm-500 dark:text-sun-300 dark:hover:border-sun-300/60 dark:hover:text-sun-200 transition-colors'

function MarketplaceLogo({ marketplace }: { marketplace: 'ebay' | 'tcgplayer' }) {
  if (marketplace === 'ebay') {
    return (
      <span aria-hidden="true" className="inline-flex items-baseline text-sm font-semibold tracking-normal">
        <span className="text-[#e53238]">e</span>
        <span className="text-[#0064d2]">B</span>
        <span className="text-[#f5af02]">a</span>
        <span className="text-[#86b817]">y</span>
      </span>
    )
  }

  return (
    <span aria-hidden="true" className="inline-flex items-baseline text-sm font-semibold tracking-normal">
      <span className="text-[#0073cf]">TCG</span>
      <span className="text-coconut-500 dark:text-sand-200">player</span>
    </span>
  )
}

export function AffiliateLinks({
  card,
  variant = 'inline',
  className = '',
}: {
  card: CardData | null
  variant?: 'inline' | 'pill'
  className?: string
}) {
  const ebay = ebayAffiliateUrl(card)
  const tcg = tcgplayerAffiliateUrl(card)
  if (!ebay && !tcg) return null

  const linkClass = variant === 'pill' ? PILL_CLASS : INLINE_CLASS

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {ebay && (
        <a
          href={ebay}
          target="_blank"
          rel={REL}
          className={linkClass}
          title="Find on eBay"
          aria-label="Find on eBay"
        >
          <MarketplaceLogo marketplace="ebay" />
          <ExternalLink size={11} />
        </a>
      )}
      {tcg && (
        <a
          href={tcg}
          target="_blank"
          rel={REL}
          className={linkClass}
          title="Find on TCGPlayer"
          aria-label="Find on TCGPlayer"
        >
          <MarketplaceLogo marketplace="tcgplayer" />
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}
