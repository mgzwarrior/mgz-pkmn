/**
 * Affiliate-link builders for the eBay + TCGPlayer "buy" affordances (#657).
 *
 * Both links are keyword searches built from the card's name + set + number —
 * we don't carry a stable per-card product id for either marketplace, so a
 * search to the exact printing is the closest we get without a resolution
 * layer. When an affiliate code is configured the tracking params are
 * attached; when it's blank the link still works, it just points at a plain
 * (uncredited) search. Drop real codes into `AFFILIATE` to start earning.
 */
import type { CardData } from '../types'

export interface AffiliateConfig {
  /** eBay Partner Network campaign id — the `campid` rover param. */
  ebayCampaignId: string
  /** TCGPlayer affiliate / Impact partner id. */
  tcgplayerAffiliateId: string
}

/**
 * Affiliate codes. These are public values (they ride in every outbound URL),
 * so they live in source rather than a secret store. Both default empty so the
 * links degrade to plain searches until the real codes are filled in.
 */
export const AFFILIATE: AffiliateConfig = {
  ebayCampaignId: '5339156329',
  // Empty until the TCGPlayer (Impact) affiliate application is accepted —
  // links stay plain searches until then.
  tcgplayerAffiliateId: '',
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
 * TCGPlayer search URL for a card, tagged with the affiliate partner id when
 * one is configured. The `partner` + utm shape matches TCGPlayer's affiliate
 * program; adjust here if your Impact link uses a different format. Returns
 * null when the card has no name to search on.
 */
export function tcgplayerAffiliateUrl(
  card: CardData | null,
  config: AffiliateConfig = AFFILIATE,
): string | null {
  const query = cardSearchQuery(card)
  if (!query) return null
  const url = new URL('https://www.tcgplayer.com/search/pokemon/product')
  url.searchParams.set('q', query)
  url.searchParams.set('productLineName', 'pokemon')
  if (config.tcgplayerAffiliateId) {
    url.searchParams.set('partner', config.tcgplayerAffiliateId)
    url.searchParams.set('utm_campaign', 'affiliate')
    url.searchParams.set('utm_medium', config.tcgplayerAffiliateId)
    url.searchParams.set('utm_source', config.tcgplayerAffiliateId)
  }
  return url.toString()
}
