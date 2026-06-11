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

/**
 * One raw eBay sold comp surfaced in the card detail popup (#425). The
 * lookup pipeline's eBay source (epic #416) emits these; until that wiring
 * lands they're absent and the UI degrades to "no eBay data".
 */
export interface EbaySoldComp {
  price: number
  /** ISO date of the sale, or null when the source didn't report one. */
  date: string | null
  condition: string | null
  url: string | null
}

export interface Pricing {
  market: number | null
  variant: string | null
  source: string | null
  url: string | null
  currency: string
  /**
   * eBay comp signals (#423/#425). Optional: the scalars are absent on runs
   * persisted before #423, and the raw comps list isn't on the wire until
   * the eBay source is wired into the lookup pipeline (epic #416).
   */
  ebay_sold_median?: number | null
  ebay_active_floor?: number | null
  /** Recent raw sold comps, newest-first as the source returns them. */
  ebay_sold_comps?: EbaySoldComp[] | null
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

/** The single terminating SSE frame emitted once all lines are done.
 *
 * `run_id` carries the id of the run the backend just persisted, or
 * `null` if persistence fell through. The SPA reads it so a "Save this
 * search" action can target the just-completed run without re-listing. */
export interface DoneEvent {
  index?: undefined
  total: number
  done: true
  run_id: number | null
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

/**
 * Swipe-mode rarity floor — how aggressively the candidate pool is trimmed
 * toward chase cards. `all` keeps every rarity, `rare` drops Common +
 * Uncommon, and `chase` keeps only each set's top rarity tier (age-scaled:
 * Base Set → Rare Holo, modern sets → Special Illustration Rare / Hyper).
 */
export type RarityFloor = 'all' | 'rare' | 'chase'

/** Application-level settings stored in Zustand and sent with each request. */
export interface Settings {
  apiKey: string
  maxPrice: number | null
  noImages: boolean
  tag: string
  dedupe: boolean
  sort: SortMode
  showTimer: boolean
  /** Show the eBay comps column (median sold + sparkline) in the results table. */
  showEbay: boolean
  /** Swipe-mode rarity floor (swipe-header control; not in the settings drawer). */
  swipeRarityFloor: RarityFloor
  /**
   * Swipe-mode library-aware exclusion (#581). Opt-in: when on, the deck
   * stops serving cards already in any of your collections (`Owned`) or on
   * any of your wishlists (`Chasing`). Both default off; the no-repeat
   * memory that excludes already-*seen* cards is always on and isn't a
   * setting.
   */
  swipeExcludeOwned: boolean
  swipeExcludeChasing: boolean
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
 * One species in the national Pokédex, as baked into `data/pokedex.json`
 * and rendered by Browse's pokedex-# view. `number` is the national dex
 * number Browse keys the printings fetch off of.
 */
export interface PokedexEntry {
  number: number
  name: string
}

/**
 * One printing returned by `GET /api/v1/pokedex/{number}/cards` — every
 * card of a given species across every set.
 *
 * A superset of `SetCard`: because printings span sets, each row carries
 * its own set id / name / release date (the set context that's implicit
 * in set view's single-set grid) so the pokedex grid can label and sort
 * by set, and synthesise an "add to list" line without an active set.
 */
export interface PokedexCard extends SetCard {
  setId: string
  setName: string
  releaseDate: string
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
 * `pkmn cache stats --json`. Counts are always present. Five fields
 * can be `null`:
 * - `api_oldest_mtime` when the API cache holds no entries
 * - `concept_warm_timestamp` when no concept-warm pass has been recorded
 * - `set_cards_warm_timestamp` when no set-cards-warm pass has been recorded
 * - `sets_warm_timestamp` when no sets-warm pass has been recorded
 * - `card_warm_timestamp` when no per-card-warm pass has been recorded
 */
export interface CacheStats {
  root: string
  api_entry_count: number
  api_bytes: number
  api_oldest_mtime: number | null
  /** Structural-slice fields, post-#372 split. Indefinite TTL — no oldest. */
  api_structural_entry_count: number
  api_structural_bytes: number
  /** Pricing-slice fields, post-#372 split. 24h SWR; oldest mtime surfaces freshness. */
  api_pricing_entry_count: number
  api_pricing_bytes: number
  api_pricing_oldest_mtime: number | null
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
  card_warm_timestamp: number | null
  card_warm_count: number
  card_warm_failed_count: number
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

/**
 * Lightweight aggregate persisted on `runs.summary_json`. Mirrors
 * `api/db/serialize.build_run_summary`. Cheap to render in the sidebar
 * without loading the full row payload.
 */
export interface RunSummaryAggregate {
  total_rows: number
  matched: number
  missed: number
  priced: number
  totals_by_currency: Record<string, number>
  tag_counts: Record<string, number>
}

/** Columns the ResultsTable can sort on. */
export type ResultsSortColumn = 'name' | 'set' | 'rarity' | 'market' | 'source'

/** Sort direction on the active sort column. */
export type ResultsSortDir = 'asc' | 'desc'

/** Per-column filter values bound to the ResultsTable filter row. Empty
 *  string means "no filter on this column". */
export interface ResultsFilters {
  name: string
  set: string
  rarity: string
  marketMin: string
  marketMax: string
  source: string
}

/**
 * Snapshot of the ResultsTable column-sort + column-filter state, stored
 * server-side on a saved run so click-to-load can replay the exact view
 * the user was looking at when they saved.
 *
 * Schema lives in the SPA — the API treats `view_state` as opaque JSON.
 */
export interface SavedViewState {
  sortColumn: ResultsSortColumn | null
  sortDir: ResultsSortDir | null
  showFilters: boolean
  filters: ResultsFilters
}

/**
 * One entry from `GET /api/v1/runs` — the saved-searches sidebar listing
 * shape. The endpoint filters to runs the user has explicitly *saved*
 * (named); unnamed streamed runs persist server-side but don't surface
 * here. The full row payload lives on `GET /api/v1/runs/{id}`.
 */
export interface RunSummary {
  id: number
  created_at: string
  elapsed_seconds: number | null
  summary: RunSummaryAggregate
  row_count: number
  /** Display label set by the user when saving. Never null for entries
   * returned by `/runs` (the listing is filtered to saved rows). */
  name: string | null
  /** ResultsTable view-state snapshot taken at save time. Null when the
   * user saved before the field landed, or omitted view_state. */
  view_state: SavedViewState | null
}

/** Persisted-row shape returned by `GET /api/v1/runs/{id}`. */
export interface RunRowDetail {
  position: number
  tag: string
  market_price: number | null
  currency: string | null
  query: CardQuery
  card: CardData | null
  pricing: Pricing
}

/** Full run record returned by `GET /api/v1/runs/{id}`. */
export interface RunDetail {
  id: number
  created_at: string
  elapsed_seconds: number | null
  input_text: string
  summary: RunSummaryAggregate
  rows: RunRowDetail[]
  /** Display label, or null for runs that haven't been saved yet. */
  name: string | null
  /** ResultsTable view-state snapshot, or null if none was stored. */
  view_state: SavedViewState | null
}
