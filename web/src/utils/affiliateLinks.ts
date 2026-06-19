/**
 * Affiliate-link builders for the eBay + TCGPlayer "buy" affordances (#657).
 *
 * Both links are keyword searches built from the card's name + set + number —
 * we don't carry a stable per-card product id for either marketplace, so a
 * search to the exact printing is the closest we get without a resolution
 * layer. eBay attaches EPN tracking params; TCGPlayer wraps the search in its
 * Impact tracking redirect. When the code is configured the link carries
 * credit; when it's blank the link still works, it just points at a plain
 * (uncredited) search. Drop real codes into `AFFILIATE` to start earning.
 */
import type { CardData } from '../types'

export interface AffiliateConfig {
  /** eBay Partner Network campaign id — the `campid` rover param. */
  ebayCampaignId: string
  /**
   * TCGPlayer Impact tracking link base — `partner.tcgplayer.com/c/.../.../...`.
   * Deep links append the destination as a percent-encoded `u` param. Blank
   * falls back to a plain (uncredited) search.
   */
  tcgplayerPartnerLink: string
}

/**
 * Affiliate codes. These are public values (they ride in every outbound URL),
 * so they live in source rather than a secret store. Both default empty so the
 * links degrade to plain searches until the real codes are filled in.
 */
export const AFFILIATE: AffiliateConfig = {
  ebayCampaignId: '5339156329',
  tcgplayerPartnerLink: 'https://partner.tcgplayer.com/c/7402525/1780961/21018',
}

// eBay Partner Network rover constants for the US marketplace. Stable across
// partners — only `campid` changes — so they stay literals here.
const EBAY_ROTATION_ID = '711-53200-19255-0'

/** Keyword query for a card: name + set name + collector number. */
export function cardSearchQuery(card: CardData | null): string {
  if (!card) return ''
  const name = (card.name ?? '').trim()
  if (!name) return ''
  const setName = (card.set?.name ?? '').trim()
  const number = String(card.number ?? '').trim()
  return [name, setName, number].filter(Boolean).join(' ')
}

/**
 * eBay search URL for a card, with EPN tracking params when a campaign id is
 * configured. Returns null when the card has no name to search on.
 */
export function ebayAffiliateUrl(
  card: CardData | null,
  config: AffiliateConfig = AFFILIATE,
): string | null {
  const query = cardSearchQuery(card)
  if (!query) return null
  const url = new URL('https://www.ebay.com/sch/i.html')
  url.searchParams.set('_nkw', query)
  if (config.ebayCampaignId) {
    url.searchParams.set('mkcid', '1')
    url.searchParams.set('mkrid', EBAY_ROTATION_ID)
    url.searchParams.set('siteid', '0')
    url.searchParams.set('campid', config.ebayCampaignId)
    url.searchParams.set('toolid', '10001')
    url.searchParams.set('mkevt', '1')
  }
  return url.toString()
}

/**
 * TCGPlayer search URL for a card. When a partner link is configured the
 * search is wrapped in TCGPlayer's Impact tracking redirect — the destination
 * rides as a percent-encoded `u` param on `partner.tcgplayer.com/c/...`, which
 * is how Impact deep links carry credit (see
 * https://help.impact.com/partner — "Param Parameters Explained"). With no
 * partner link it returns the plain (uncredited) search. Returns null when the
 * card has no name to search on.
 */
export function tcgplayerAffiliateUrl(
  card: CardData | null,
  config: AffiliateConfig = AFFILIATE,
): string | null {
  const query = cardSearchQuery(card)
  if (!query) return null
  const search = new URL('https://www.tcgplayer.com/search/pokemon/product')
  search.searchParams.set('q', query)
  search.searchParams.set('productLineName', 'pokemon')
  if (!config.tcgplayerPartnerLink) return search.toString()
  const tracked = new URL(config.tcgplayerPartnerLink)
  tracked.searchParams.set('u', search.toString())
  return tracked.toString()
}
