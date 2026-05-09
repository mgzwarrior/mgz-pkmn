/** Shared TypeScript types mirroring the FastAPI response shapes. */

export interface CardQuery {
  raw: string
  name: string
  set_hint: string | null
  number: string | null
  variant_hint: string | null
  url_hint: string | null
  bulk_top: number | null
  bulk_all: boolean
  price_min: number | null
  price_max: number | null
}

export interface Pricing {
  market: number | null
  variant: string | null
  source: string | null
  url: string | null
  currency: string
}

export interface CardSet {
  id?: string
  name?: string
  series?: string
  total?: number
  releaseDate?: string
}

export interface CardImages {
  small?: string
  large?: string
}

/** A raw card object as returned by pokemontcg.io / TCGdex. */
export type CardData = Record<string, unknown> & {
  id?: string
  name?: string
  number?: string
  rarity?: string
  set?: CardSet
  images?: CardImages
  _database?: string
}

/** One resolved row — the unit emitted by the SSE stream and accumulated in state. */
export interface Row {
  query: CardQuery
  card: CardData | null
  pricing: Pricing
  tag: string
  matched: boolean
  reason: string
}

/** SSE event payload emitted by POST /api/v1/bulk. */
export interface BulkEvent extends Row {
  index: number
  total: number
  done?: boolean
}

/** Application-level settings stored in Zustand and sent with each request. */
export interface Settings {
  apiKey: string
  maxPrice: number | null
  noImages: boolean
  tag: string
  dedupe: boolean
}

export interface SetInfo {
  id: string
  name: string
  series: string
  total: number
  releaseDate: string
}
