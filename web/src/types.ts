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

/**
 * One stage in the per-line lookup pipeline, surfaced by the bulk SSE
 * stream. Mirrors `mgz_pkmn.lookup.LOOKUP_STAGES`. The first five are
 * intermediate (the line is still in flight); the last three are terminal.
 * `image` is part of the shared vocabulary (the CLI downloads thumbnails)
 * but the web app runs image-free, so it never arrives over the wire here.
 */
export type Stage =
  | 'parsed'
  | 'url_hint'
  | 'looking_up'
  | 'fallback'
  | 'pricing'
  | 'image'
  | 'resolved'
  | 'no_match'
  | 'error'

/**
 * A progress-only SSE frame: the line moved to a new stage but hasn't
 * resolved yet. Distinguished from a row event by the absence of `query` /
 * `matched`.
 */
export interface StageEvent {
  index: number
  total: number
  stage: Stage
}

/** A resolved-row SSE frame — a full {@link Row} plus its terminal stage. */
export interface RowEvent extends Row {
  index: number
  total: number
  stage: Stage
  done?: false
}

/** The single terminating SSE frame emitted once all lines are done. */
export interface DoneEvent {
  index?: undefined
  total: number
  done: true
}

/** Any frame emitted by POST /api/v1/bulk. */
export type BulkEvent = StageEvent | RowEvent | DoneEvent

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
   * The most recent pipeline stage reported for this line. Drives the
   * color-coded chip. `undefined` until the first stage frame arrives
   * (briefly, before the `parsed` frame).
   */
  stage?: Stage
  /**
   * Wall-clock ms (Date.now()) when the line entered its current
   * `stage`. Used to render the per-stage elapsed time in the chip
   * tooltip.
   */
  stageStartedAt?: number
  /**
   * Wall-clock ms (Date.now()) when the line transitioned out of
   * `pending` — i.e. when its first terminal (row) event arrived. The
   * status at that point is either `resolved` or `error`; either way the
   * elapsed badge represents the time between the run starting and the
   * line leaving the queue.
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
 * One trimmed card returned by `GET /api/v1/sets/{set_id}/cards`.
 *
 * Intentionally narrower than the full `CardData` blob — Browse only
 * needs enough to render a grid row, filter by rarity/subtype, and
 * synthesise an "add to list" line. The trim happens server-side so
 * every Browse open ships kilobytes instead of hundreds-of-kilobytes
 * over the wire.
 */
export interface SetCard {
  id: string
  name: string
  number: string
  rarity: string | null
  supertype: string | null
  subtypes: string[]
  thumb: string | null
  market: number | null
}

/**
 * One section within a release (Added / Changed / Fixed / …) as returned
 * by `GET /api/v1/changelog`. Bullet `entries` are raw Markdown — the
 * renderer formats inline links and code spans.
 */
export interface ChangelogSection {
  name: string
  entries: string[]
}

/**
 * One release block from `GET /api/v1/changelog`. The endpoint omits the
 * in-flight Unreleased section by default, so every release here is
 * shipped and carries a `date`.
 */
export interface ChangelogRelease {
  version: string
  date: string | null
  sections: ChangelogSection[]
}

/**
 * Snapshot returned by `GET /api/v1/cache/stats` — same shape as
 * `pkmn cache stats --json`. Counts are always present. Four fields
 * can be `null`:
 * - `api_oldest_mtime` when the API cache holds no entries
 * - `concept_warm_timestamp` when no concept-warm pass has been recorded
 * - `set_cards_warm_timestamp` when no set-cards-warm pass has been recorded
 * - `sets_warm_timestamp` when no sets-warm pass has been recorded
 */
export interface CacheStats {
  root: string
  api_entry_count: number
  api_bytes: number
  api_oldest_mtime: number | null
  override_count: number
  override_bytes: number
  image_entry_count: number
  image_bytes: number
  concept_warm_timestamp: number | null
  concept_warm_names: number
  set_cards_warm_timestamp: number | null
  set_cards_warm_count: number
  sets_warm_timestamp: number | null
  sets_warm_count: number
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
