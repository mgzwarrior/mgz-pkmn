import { describe, it, expect } from 'vitest'
import {
  cardSearchQuery,
  ebayAffiliateUrl,
  tcgplayerAffiliateUrl,
  type AffiliateConfig,
} from './affiliateLinks'
import type { CardData } from '../types'

function card(over: Partial<CardData> = {}): CardData {
  return { name: 'Charizard', set: { name: 'Base Set' }, number: '4', ...over }
}

const WITH_CODES: AffiliateConfig = {
  ebayCampaignId: '5339000000',
  tcgplayerAffiliateId: 'mgzpkmn',
}
const NO_CODES: AffiliateConfig = { ebayCampaignId: '', tcgplayerAffiliateId: '' }

describe('cardSearchQuery', () => {
  it('joins name + set + number', () => {
    expect(cardSearchQuery(card())).toBe('Charizard Base Set 4')
  })

  it('trims and skips missing parts', () => {
    expect(cardSearchQuery({ name: '  Pikachu  ' })).toBe('Pikachu')
    expect(cardSearchQuery({ name: 'Mew', number: '53' })).toBe('Mew 53')
  })

  it('returns "" for null or a nameless card', () => {
    expect(cardSearchQuery(null)).toBe('')
    expect(cardSearchQuery({ set: { name: 'Base Set' } })).toBe('')
    expect(cardSearchQuery({ name: '   ' })).toBe('')
  })
})

describe('ebayAffiliateUrl', () => {
  it('returns null when there is no query', () => {
    expect(ebayAffiliateUrl(null, NO_CODES)).toBeNull()
  })

  it('builds a plain search URL when no campaign id is set', () => {
    const url = ebayAffiliateUrl(card(), NO_CODES)!
    expect(url).toContain('https://www.ebay.com/sch/i.html')
    expect(url).toContain('_nkw=Charizard+Base+Set+4')
    expect(url).not.toContain('campid')
    expect(url).not.toContain('mkevt')
  })

  it('attaches EPN tracking params when a campaign id is set', () => {
    const url = ebayAffiliateUrl(card(), WITH_CODES)!
    expect(url).toContain('campid=5339000000')
    expect(url).toContain('mkevt=1')
    expect(url).toContain('mkcid=1')
  })
})

describe('tcgplayerAffiliateUrl', () => {
  it('returns null when there is no query', () => {
    expect(tcgplayerAffiliateUrl(null, NO_CODES)).toBeNull()
  })

  it('builds a plain search URL when no affiliate id is set', () => {
    const url = tcgplayerAffiliateUrl(card(), NO_CODES)!
    expect(url).toContain('https://www.tcgplayer.com/search/pokemon/product')
    expect(url).toContain('q=Charizard+Base+Set+4')
    expect(url).toContain('productLineName=pokemon')
    expect(url).not.toContain('partner')
  })

  it('tags the URL with the partner id when set', () => {
    const url = tcgplayerAffiliateUrl(card(), WITH_CODES)!
    expect(url).toContain('partner=mgzpkmn')
    expect(url).toContain('utm_campaign=affiliate')
  })
})
