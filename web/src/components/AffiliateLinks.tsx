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
import type { CardData } from '../types'
import { ebayAffiliateUrl, tcgplayerAffiliateUrl } from '../utils/affiliateLinks'
import ebayLogoUrl from '../../../assets/marketplaces/ebay.svg'
import tcgplayerLogoUrl from '../../../assets/marketplaces/tcgplayer.svg'

const REL = 'sponsored noopener'

// The marketplace wordmarks are full-color and TCGplayer's is near-black, so
// each chip keeps a warm off-white plate (--sand-50) in both themes — the
// logos need a light backing to stay legible on the dark husk surface. Using
// the page tone (not pure white) plus a hairline border and soft shadow lets
// the chip read as part of the tropical UI rather than a pasted sticker.
const CHIP_CLASS =
  'inline-flex items-center rounded-md bg-sand-50 border border-sand-200 shadow-sm transition-all hover:border-palm-400 hover:shadow'

const INLINE_CLASS = `${CHIP_CLASS} px-1.5 py-1`
const PILL_CLASS = `${CHIP_CLASS} px-2.5 py-1.5`

function MarketplaceLogo({ marketplace }: { marketplace: 'ebay' | 'tcgplayer' }) {
  const isEbay = marketplace === 'ebay'
  const src = isEbay ? ebayLogoUrl : tcgplayerLogoUrl
  const alt = isEbay ? 'eBay' : 'TCGplayer'

  // Optically match the two marks: eBay is square-ish, TCGplayer's wordmark is
  // wider, so we pin a shared cap-height and let width follow.
  const sizeClass = isEbay ? 'h-3 w-auto' : 'h-3.5 w-auto'

  return <img src={src} alt={alt} className={sizeClass} loading="lazy" />
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
        </a>
      )}
    </div>
  )
}
