/**
 * browseCard — adapt a trimmed Browse / Swipe card (`SetCard` /
 * `PokedexCard`) into the shapes the Search surfaces already speak: a
 * full-ish `CardData` payload for the collection / wishlist save path, and
 * a `Row` for the `CardDetailModal`.
 *
 * The trimmed cards (see [types](../types.ts)) carry only what a grid needs
 * — id, name, number, rarity, supertype, subtypes, thumb, market — plus set
 * context (`PokedexCard` carries its own; `SetCard` borrows the active
 * set). That's enough to round-trip both: the modal renders identity +
 * pricing comps off `market`, and the backend's `extract_card_identity` /
 * `extract_price_snapshot` (api/db/card_payload.py) read `set.id`,
 * `images.small`, and the flattened `market_price` stamped here.
 */
import type { CardData, PokedexCard, Row, SetCard } from '../types'

/** Set identity stamped onto a `SetCard`, which (unlike `PokedexCard`)
 *  doesn't carry its own. Sourced from the active set in Browse / the
 *  candidate's set in Swipe. */
export interface BrowseSetContext {
  id: string
  name: string
  series?: string
  releaseDate?: string
}

function setContext(
  card: SetCard | PokedexCard,
  ctx?: BrowseSetContext,
): BrowseSetContext | undefined {
  if ('setId' in card) {
    return { id: card.setId, name: card.setName, releaseDate: card.releaseDate }
  }
  return ctx
}

/** Verbatim card payload (pokemontcg.io-ish shape) the collection /
 *  wishlist endpoints persist and the detail modal renders. */
export function browseCardToPayload(
  card: SetCard | PokedexCard,
  ctx?: BrowseSetContext,
): CardData {
  const set = setContext(card, ctx)
  return {
    id: card.id,
    name: card.name,
    number: card.number,
    rarity: card.rarity ?? undefined,
    supertype: card.supertype ?? undefined,
    subtypes: card.subtypes,
    images: card.thumb ? { small: card.thumb, large: card.thumb } : undefined,
    set: set
      ? {
          id: set.id,
          name: set.name,
          series: set.series,
          releaseDate: set.releaseDate,
        }
      : undefined,
    // The trimmed card only has `market`; the backend's snapshot extractor
    // reads this flattened field first, so stamping it lets a card saved
    // from Browse / Swipe land with the same price snapshot a Search row
    // gets from its richer payload.
    market_price: card.market ?? undefined,
  }
}

/** A single `Row` for `CardDetailModal`. `pricing.market` drives the
 *  modal's comp tiers; `deriveSource` falls back to a pokemontcg.io card
 *  link off `card.id` since the trimmed card carries no listing URL. */
export function browseCardToRow(
  card: SetCard | PokedexCard,
  ctx?: BrowseSetContext,
): Row {
  return {
    query: {
      raw: card.name,
      name: card.name,
      set_hint: null,
      number: card.number,
      variant_hint: null,
      url_hint: null,
      bulk_top: null,
      bulk_all: false,
      price_min: null,
      price_max: null,
    },
    card: browseCardToPayload(card, ctx),
    pricing: {
      market: card.market,
      variant: null,
      source: null,
      url: null,
      currency: 'USD',
    },
    tag: '',
    matched: true,
    reason: '',
  }
}
