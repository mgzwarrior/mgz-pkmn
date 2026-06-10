import { describe, it, expect } from 'vitest'
import { browseCardToPayload, browseCardToRow } from './browseCard'
import type { PokedexCard, SetCard } from '../types'

const POKEDEX_CARD: PokedexCard = {
  id: 'base1-4',
  name: 'Charizard',
  number: '4',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: ['Stage 2'],
  thumb: 'https://img/base1-4.png',
  market: 250,
  setId: 'base1',
  setName: 'Base',
  releaseDate: '1999/01/09',
}

// A SetCard carries no set identity of its own and, here, no optional
// metadata — the absent-field branches in the payload adapter.
const BARE_SET_CARD: SetCard = {
  id: 'sv1-1',
  name: 'Pikachu',
  number: '1',
  rarity: null,
  supertype: null,
  subtypes: [],
  thumb: null,
  market: null,
}

describe('browseCard adapters', () => {
  it('a PokedexCard carries its own set context and full payload fields', () => {
    const payload = browseCardToPayload(POKEDEX_CARD)
    expect(payload).toMatchObject({
      id: 'base1-4',
      name: 'Charizard',
      number: '4',
      rarity: 'Rare Holo',
      supertype: 'Pokémon',
      // thumb present → both image sizes stamped for the modal + saved row.
      images: { small: 'https://img/base1-4.png', large: 'https://img/base1-4.png' },
      // set sourced from the card's own setId, not external ctx.
      set: { id: 'base1', name: 'Base', releaseDate: '1999/01/09' },
      // flattened market the backend snapshot extractor reads first.
      market_price: 250,
    })
  })

  it('a SetCard borrows external set ctx and omits absent optional fields', () => {
    const payload = browseCardToPayload(BARE_SET_CARD, {
      id: 'sv1',
      name: 'Scarlet & Violet',
      series: 'SV',
      releaseDate: '2023/03/31',
    })
    expect(payload.set).toEqual({
      id: 'sv1',
      name: 'Scarlet & Violet',
      series: 'SV',
      releaseDate: '2023/03/31',
    })
    // Null rarity / supertype / thumb / market collapse to undefined so the
    // payload stays clean rather than carrying explicit nulls.
    expect(payload.rarity).toBeUndefined()
    expect(payload.supertype).toBeUndefined()
    expect(payload.images).toBeUndefined()
    expect(payload.market_price).toBeUndefined()
  })

  it('a SetCard with no ctx produces a payload without set identity', () => {
    const payload = browseCardToPayload(BARE_SET_CARD)
    expect(payload.set).toBeUndefined()
  })

  it('browseCardToRow shapes a CardDetailModal Row off the trimmed card', () => {
    const row = browseCardToRow(POKEDEX_CARD)
    expect(row.query).toMatchObject({ name: 'Charizard', number: '4', raw: 'Charizard' })
    expect(row.pricing).toMatchObject({ market: 250, currency: 'USD' })
    expect(row.card?.id).toBe('base1-4')
    expect(row.matched).toBe(true)
  })

  it('browseCardToRow carries a null market through for a price-less card', () => {
    const row = browseCardToRow(BARE_SET_CARD)
    expect(row.pricing.market).toBeNull()
  })
})
