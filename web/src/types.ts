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

/** Sort modes accepted by the API (must mirror mgz_pkmn.sorting.SORT_MODES). */
export type SortMode =
  | 'number'
  | 'number-desc'
  | 'price-asc'
  | 'price-desc'
  | 'release-date'
  | 'alpha'

/** Export formats accepted by POST /api/v1/export. */
export type ExportFormat = 'xlsx' | 'pdf' | 'condensed-pdf' | 'checklist'

/** Application-level settings stored in Zustand and sent with each request. */
export interface Settings {
  apiKey: string
  maxPrice: number | null
  noImages: boolean
  tag: string
  dedupe: boolean
  sort: SortMode
  showTimer: boolean
}

/** One input line tracked through the bulk lookup lifecycle. */
export interface ProcessingLine {
  line: string
  status: 'pending' | 'resolved' | 'error'
  /**
   * Wall-clock ms (Date.now()) when the line transitioned out of
   * `pending` — i.e. when its first SSE event arrived. The status at
   * that point is either `resolved` or `error`; either way the elapsed
   * badge represents the time between the run starting and the line
   * leaving the queue.
   */
  endedAt?: number
}

export interface SetInfo {
  id: string
  name: string
  series: string
  total: number
  releaseDate: string
}

/**
 * One entry in the recent-searches history. Captured the moment the
 * user clicks **Look up** so the panel reflects what was actually
 * submitted (even if the run later errored or was stopped).
 */
export interface RecentRun {
  /** Stable id used as the React key and the delete target. */
  id: string
  /** Wall-clock ms (Date.now()) when the run was submitted. */
  savedAt: number
  /** The non-empty, non-comment lines the user submitted. */
  lines: string[]
}
