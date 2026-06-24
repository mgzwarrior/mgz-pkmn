/**
 * API client functions for the mgz-pkmn FastAPI backend.
 *
 * All functions talk to `/api/v1/*`. In development Vite proxies those paths
 * to `http://localhost:8000`; in production the SPA is served from the same
 * origin as the API.
 */

import type {
  BulkEvent,
  CacheStats,
  CardQuery,
  ChangelogRelease,
  ExportFormat,
  PokedexCard,
  Row,
  RunDetail,
  RunSummary,
  SavedViewState,
  SetCard,
  SetInfo,
  Settings,
  SortMode,
} from '../types'

const BASE = '/api/v1'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function settingsPayload(s: Settings) {
  return {
    api_key: s.apiKey || null,
    max_price: s.maxPrice,
    no_images: s.noImages,
    tag: s.tag,
  }
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

export async function parseLine(line: string): Promise<CardQuery | null> {
  const res = await fetch(`${BASE}/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line }),
  })
  if (!res.ok) throw new Error(`parse failed: ${res.status}`)
  const data = await res.json()
  return data.query as CardQuery | null
}

// ---------------------------------------------------------------------------
// lookup (single line)
// ---------------------------------------------------------------------------

export async function lookupLine(line: string, settings: Settings): Promise<Row[]> {
  const res = await fetch(`${BASE}/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line, settings: settingsPayload(settings) }),
  })
  if (!res.ok) throw new Error(`lookup failed: ${res.status}`)
  const data = await res.json()
  return data.rows as Row[]
}

// ---------------------------------------------------------------------------
// bulk (SSE stream)
// ---------------------------------------------------------------------------

/**
 * Stream bulk lookup results via Server-Sent Events.
 *
 * @param lines  Array of card-list lines to look up.
 * @param settings  Current app settings.
 * @param onEvent  Called for each resolved row event.
 * @param onDone   Called when the stream ends (success or abort).
 * @param signal   AbortController signal to cancel the stream.
 */
export async function bulkLookup(
  lines: string[],
  settings: Settings,
  onEvent: (event: BulkEvent) => void,
  onDone: (aborted: boolean) => void,
  signal: AbortSignal,
): Promise<void> {
  const nonEmpty = lines.filter((l) => l.trim() && !l.trim().startsWith('#'))

  const res = await fetch(`${BASE}/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: nonEmpty, settings: settingsPayload(settings) }),
    signal,
  })

  if (!res.ok) {
    onDone(false)
    throw new Error(`bulk failed: ${res.status}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by double newlines.
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        const line = part.startsWith('data: ') ? part.slice(6) : part
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as BulkEvent
          onEvent(event)
        } catch {
          // ignore malformed frames
        }
      }
    }
    onDone(false)
  } catch (err) {
    const aborted = signal.aborted || (err instanceof DOMException && err.name === 'AbortError')
    onDone(aborted)
    if (!aborted) throw err
  }
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

const DOWNLOAD_FILENAMES: Record<ExportFormat, string> = {
  xlsx: 'cards.xlsx',
  pdf: 'binder.pdf',
  'condensed-pdf': 'binder-condensed.pdf',
  checklist: 'checklist.pdf',
}

/**
 * Drop matched rows that share a card ID with an earlier row. Unmatched rows
 * and rows without a card ID are always preserved (we can't tell duplicates
 * apart without an ID). Mirrors the CLI's `--dedupe` and the bulk-lookup
 * client-side dedupe in `App.tsx`.
 */
export function dedupeRows(rows: Row[]): Row[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (!row.matched) return true
    const cid = (row.card?.id as string | undefined) ?? null
    if (!cid) return true
    if (seen.has(cid)) return false
    seen.add(cid)
    return true
  })
}

export async function exportFile(
  rows: Row[],
  format: ExportFormat,
  options: {
    maxPrice?: number | null
    title?: string
    sort?: SortMode
    noImages?: boolean
    dedupe?: boolean
  } = {},
): Promise<void> {
  const effectiveRows = options.dedupe ? dedupeRows(rows) : rows
  const res = await fetch(`${BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rows: effectiveRows,
      format,
      sort: options.sort ?? 'number',
      max_price: options.maxPrice ?? null,
      title: options.title ?? 'cards',
      no_images: options.noImages ?? true,
    }),
  })

  if (!res.ok) {
    let detail = `export failed: ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* fall through */
    }
    throw new Error(detail)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = DOWNLOAD_FILENAMES[format]
  a.click()
  // Defer revocation: revoking synchronously can cancel the download in some
  // browsers because the click hasn't started navigation yet.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ---------------------------------------------------------------------------
// set identification cards
// ---------------------------------------------------------------------------

/**
 * Download the printable set-identification-cards PDF. Triggers a save in
 * the browser; no rows or settings are required — the server fetches the
 * full set catalog itself.
 *
 * Pass `setIds` to restrict the PDF to a subset of sets (the picker modal
 * uses this). Omit / pass an empty array for the historical "every set"
 * behavior.
 */
export async function downloadSetCardsPdf(apiKey?: string, setIds?: string[]): Promise<void> {
  const params = new URLSearchParams()
  if (apiKey) params.set('api_key', apiKey)
  if (setIds && setIds.length > 0) {
    // Repeatable query param: ?set_ids=sv8&set_ids=sv7 maps onto FastAPI's
    // `list[str] = Query()` binding on the backend.
    for (const id of setIds) params.append('set_ids', id)
  }
  const qs = params.toString()
  const res = await fetch(`${BASE}/set-cards.pdf${qs ? `?${qs}` : ''}`)
  if (!res.ok) {
    let detail = `set-cards failed: ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* fall through */
    }
    throw new Error(detail)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'set-cards.pdf'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Resolve the cached-logo URL for a given set id. The endpoint serves the
 * image straight out of the unified disk cache; missing entries return 404,
 * which the SPA renders as a soft fallback (text-only chip).
 */
export function setLogoUrl(setId: string): string {
  return `${BASE}/sets/${encodeURIComponent(setId)}/logo`
}

// PokéAPI's sprite CDN keys the standard front sprite off the same national
// dex number we already bake into the species index, so the URL derives
// directly — no extra data, no backend round-trip. Lazy-loaded per tile with
// a soft fallback, mirroring how set logos degrade on a miss.
const _POKEMON_SPRITE_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

/** Standard front sprite for a species, by national dex number (Browse's
 *  pokedex-# view). */
export function pokemonSpriteUrl(number: number): string {
  return `${_POKEMON_SPRITE_BASE}/${number}.png`
}

// ---------------------------------------------------------------------------
// sets
// ---------------------------------------------------------------------------

export async function fetchSets(apiKey?: string): Promise<SetInfo[]> {
  const params = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  const res = await fetch(`${BASE}/sets${params}`)
  if (!res.ok) throw new Error(`sets failed: ${res.status}`)
  const data = await res.json()
  return data.sets as SetInfo[]
}

/**
 * Fetch the trimmed card list for one set. The response is browser-cacheable
 * for a day (via the backend's `Cache-Control`) so repeated opens of the
 * same set in the Browse modal don't round-trip the server.
 */
export async function fetchSetCards(setId: string, apiKey?: string): Promise<SetCard[]> {
  const params = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  const res = await fetch(`${BASE}/sets/${encodeURIComponent(setId)}/cards${params}`)
  if (!res.ok) {
    let detail = `set cards failed: ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* fall through */
    }
    throw new Error(detail)
  }
  const data = await res.json()
  return data.cards as SetCard[]
}

/**
 * Fetch every printing of one species across all sets, newest-first, for
 * Browse's pokedex-# view. The backend keys off the national dex `number`
 * and returns rows pre-sorted (release date desc, set, collector number)
 * with per-card set context. Browser-cacheable for a day like
 * `fetchSetCards`.
 */
export async function fetchPokedexCards(
  number: number,
  apiKey?: string,
): Promise<PokedexCard[]> {
  const params = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  const res = await fetch(`${BASE}/pokedex/${number}/cards${params}`)
  if (!res.ok) {
    let detail = `pokedex cards failed: ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* fall through */
    }
    throw new Error(detail)
  }
  const data = await res.json()
  return data.cards as PokedexCard[]
}

// ---------------------------------------------------------------------------
// overrides
// ---------------------------------------------------------------------------

export async function addOverride(name: string, set: string | null, url: string): Promise<void> {
  const res = await fetch(`${BASE}/overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, set, url }),
  })
  if (!res.ok) throw new Error(`override failed: ${res.status}`)
}

// ---------------------------------------------------------------------------
// changelog
// ---------------------------------------------------------------------------

/**
 * Fetch parsed release notes (newest first) from the shared
 * `GET /api/v1/changelog` endpoint — the same source the marketing site
 * reads. The in-flight Unreleased section is omitted by the backend, so
 * every release returned is shipped. Response is browser-cacheable for an
 * hour via the backend's `Cache-Control`.
 */
export async function fetchChangelog(limit = 5): Promise<ChangelogRelease[]> {
  const res = await fetch(`${BASE}/changelog?limit=${limit}`)
  if (!res.ok) throw new Error(`changelog failed: ${res.status}`)
  const data = await res.json()
  return data.releases as ChangelogRelease[]
}

// ---------------------------------------------------------------------------
// runs (persisted history)
// ---------------------------------------------------------------------------

/**
 * List persisted runs, newest first. The endpoint returns the
 * lightweight `summary_json` aggregate per row so the sidebar renders
 * without loading every `run_rows` payload.
 */
export async function listRuns(limit = 50, offset = 0): Promise<{ items: RunSummary[]; total: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const res = await fetch(`${BASE}/runs?${params.toString()}`)
  if (!res.ok) throw new Error(`runs failed: ${res.status}`)
  return (await res.json()) as { items: RunSummary[]; total: number }
}

/** Fetch a full run including every persisted row. */
export async function getRun(runId: number): Promise<RunDetail> {
  const res = await fetch(`${BASE}/runs/${runId}`)
  if (!res.ok) throw new Error(`run ${runId} failed: ${res.status}`)
  return (await res.json()) as RunDetail
}

/**
 * Save (or rename) a run as a *saved search* — the listing endpoint
 * filters to runs with a non-null `name`, so this is what promotes a
 * streamed run into the sidebar. The supplied `view_state` is replayed
 * on the next click-to-load.
 */
export async function saveRun(
  runId: number,
  name: string,
  viewState: SavedViewState,
): Promise<RunSummary> {
  const res = await fetch(`${BASE}/runs/${runId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, view_state: viewState }),
  })
  if (!res.ok) {
    let detail = `save failed: ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* fall through */
    }
    throw new Error(detail)
  }
  return (await res.json()) as RunSummary
}

/** Delete a saved search (run) and its rows (#698). Owner-only server-side. */
export async function deleteRun(runId: number): Promise<void> {
  const res = await fetch(`${BASE}/runs/${runId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    throw new Error(`delete run ${runId} failed: ${res.status}`)
  }
}

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------

/**
 * Fetch on-disk cache stats from `GET /api/v1/cache/stats`. Used by the
 * Settings drawer to surface whether the instance is warmed and how many
 * entries are cached. Backend serves the response with
 * `Cache-Control: no-store` so consumers don't need to bust the cache
 * themselves.
 */
export async function fetchCacheStats(): Promise<CacheStats> {
  const res = await fetch(`${BASE}/cache/stats`)
  if (!res.ok) throw new Error(`cache stats failed: ${res.status}`)
  return (await res.json()) as CacheStats
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

/**
 * Identity payload for the current request's user.
 */
export interface MeIdentity {
  id: number
  provider: string
  email: string | null
  linked_at: string
}

export interface Me {
  id: number
  email: string | null
  display_name: string | null
  identities?: MeIdentity[]
  /** Whether the user has finished (or skipped) the first-login onboarding
   *  survey (#742). Falsy (incl. absent) opens the favorite-Pokémon pop-up;
   *  `fetchMe` always populates it from the `/me` envelope. */
  onboardingCompleted?: boolean
}

/**
 * `GET /api/v1/me` envelope. Always 200. `user` is null only when auth
 * is enabled *and* the visitor isn't signed in; self-host (auth off)
 * surfaces the sentinel default user so chip-visibility ("is there a
 * user?") is a single null check across modes. `authEnabled` gates the
 * SignInChip itself — self-host has no sign-in surface to render.
 */
export interface MeEnvelope {
  user: Me | null
  authEnabled: boolean
}

interface RawMe {
  id: number
  email: string | null
  display_name: string | null
  identities?: MeIdentity[]
  onboarding_completed: boolean
}

export async function fetchMe(): Promise<MeEnvelope> {
  const res = await fetch(`${BASE}/me`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`me failed: ${res.status}`)
  const body = (await res.json()) as { user: RawMe | null; auth_enabled: boolean }
  const user: Me | null = body.user
    ? { ...body.user, onboardingCompleted: body.user.onboarding_completed }
    : null
  return { user, authEnabled: body.auth_enabled }
}

/** Mark the first-login onboarding survey done (#742) so it never re-opens. */
export async function completeOnboarding(): Promise<void> {
  const res = await fetch(`${BASE}/me/onboarding/complete`, {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`complete onboarding failed: ${res.status}`)
  }
}

export async function logout(): Promise<void> {
  const res = await fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok && res.status !== 204) throw new Error(`logout failed: ${res.status}`)
}

/**
 * Request a magic-link email. The backend always responds 202 once SMTP
 * is configured (no enumeration leak), so a successful call here means
 * "request accepted", not "address is known".
 */
export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/magic/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok && res.status !== 202) throw new Error(`magic-link failed: ${res.status}`)
}

/**
 * Request a magic-link email for attaching another email identity to
 * the currently signed-in account.
 */
export async function requestAccountMagicLink(email: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/link/magic/start`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok && res.status !== 202) throw new Error(`account magic-link failed: ${res.status}`)
}

export async function unlinkIdentity(identityId: number): Promise<void> {
  const res = await fetch(`${BASE}/auth/identities/${identityId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok && res.status !== 204) throw new Error(`unlink identity failed: ${res.status}`)
}

// ---------------------------------------------------------------------------
// collections
// ---------------------------------------------------------------------------

/**
 * A dynamic collection's membership rule (#506). AND of predicates; every
 * field optional but a rule must carry at least one. Maps onto the promoted
 * card-identity columns the API resolves against.
 */
export interface CollectionRule {
  name?: string
  types?: string[]
  set_id?: string
  number?: string
  rarity?: string
}

/** One of `manual` (default), `set`, `dynamic`, or `binder`. */
export type CollectionKind = 'manual' | 'set' | 'dynamic' | 'binder'

/** Page pocket layout of a physical binder (#679). */
export type BinderFormat = '4-pocket' | '9-pocket' | '12-pocket'

/**
 * Curated cover-color preset (#679) — a design-token palette stem the SPA
 * maps to `bg-<color>-500`. Mirrors the server's `BINDER_COLORS` preset
 * allowlist. A binder may also store a freeform `#rrggbb` hex (#681), so the
 * stored `binder_color` field is a plain `string`, not this union.
 */
export type BinderColor = 'palm' | 'sun' | 'sky' | 'ember' | 'coconut' | 'sand' | 'husk'

/** How a binder's cards are physically stored (#681). */
export type BinderType = 'regular' | 'toploader' | 'graded' | 'other'

/**
 * For a `dynamic` collection (#631): `owned` resolves the rule against your
 * own cards (an inventory view); `catalog` resolves the full matching set
 * from the catalog and overlays ownership (a target view with progress).
 */
export type DynamicScope = 'owned' | 'catalog'

export interface CollectionSummary {
  id: number
  name: string
  description: string | null
  created_at: string
  item_count: number
  // #679 — occupied slots (sum of item quantities); a binder's capacity fill
  // counts pockets, not rows. Optional so older cached payloads type-check.
  total_quantity?: number
  // #506 — present on every response; optional here so older cached
  // payloads (and test fixtures) without them still type-check.
  kind?: CollectionKind
  source_set_id?: string | null
  rule?: CollectionRule | null
  dynamic_scope?: DynamicScope | null
  // #703 — the binder this collection is filed into, or null when unfiled.
  binder_id?: number | null
  // #679/#681 — binder identity. format/capacity are physical-only;
  // color (preset stem or #rrggbb hex) / type / master-set are shared.
  binder_format?: BinderFormat | null
  binder_color?: string | null
  binder_type?: BinderType | null
  capacity?: number | null
  is_master_set?: boolean | null
}

export interface CollectionItem {
  id: number
  card: Record<string, unknown>
  notes: string | null
  added_at: string
  // Promoted identity + snapshot fields (#574). Optional so partial fixtures
  // stay valid — the wire always carries them (null when absent).
  quantity?: number
  card_set_id?: string | null
  card_number?: string | null
  card_name?: string | null
  card_rarity?: string | null
  card_types?: string[] | null
  card_image_url?: string | null
  price_snapshot?: number | null
}

export interface Collection {
  id: number
  name: string
  description: string | null
  created_at: string
  items: CollectionItem[]
  kind?: CollectionKind
  source_set_id?: string | null
  rule?: CollectionRule | null
  dynamic_scope?: DynamicScope | null
  // #703 — the binder this collection is filed into, or null when unfiled.
  binder_id?: number | null
  // #679/#681 — binder identity (see CollectionSummary).
  binder_format?: BinderFormat | null
  binder_color?: string | null
  binder_type?: BinderType | null
  capacity?: number | null
  is_master_set?: boolean | null
}

export async function fetchCollection(collectionId: number): Promise<Collection> {
  const res = await fetch(`${BASE}/collections/${collectionId}`)
  if (!res.ok) throw new Error(`collection failed: ${res.status}`)
  return (await res.json()) as Collection
}

export async function fetchCollections(): Promise<CollectionSummary[]> {
  const res = await fetch(`${BASE}/collections`)
  if (!res.ok) throw new Error(`collections failed: ${res.status}`)
  const data = await res.json()
  return data.items as CollectionSummary[]
}

export interface CreateCollectionOptions {
  description?: string | null
  kind?: CollectionKind
  source_set_id?: string | null
  rule?: CollectionRule | null
  dynamic_scope?: DynamicScope | null
  // #703 — file the new collection into this binder (binders.id).
  binder_id?: number | null
  // #679/#681 — server keeps the fields each kind carries, drops the rest.
  binder_format?: BinderFormat | null
  binder_color?: string | null
  binder_type?: BinderType | null
  capacity?: number | null
  is_master_set?: boolean | null
}

export async function createCollection(
  name: string,
  options?: CreateCollectionOptions,
): Promise<Collection> {
  const res = await fetch(`${BASE}/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: options?.description ?? null,
      kind: options?.kind ?? 'manual',
      source_set_id: options?.source_set_id ?? null,
      rule: options?.rule ?? null,
      dynamic_scope: options?.dynamic_scope ?? null,
      binder_id: options?.binder_id ?? null,
      binder_format: options?.binder_format ?? null,
      binder_color: options?.binder_color ?? null,
      binder_type: options?.binder_type ?? null,
      capacity: options?.capacity ?? null,
      is_master_set: options?.is_master_set ?? null,
    }),
  })
  if (!res.ok) throw new Error(`create collection failed: ${res.status}`)
  return (await res.json()) as Collection
}

/**
 * Fields a PATCH may carry. Only the keys present are sent, so a partial
 * edit leaves the rest intact (the server reads `model_fields_set`). Binder
 * identity edits are rejected server-side on non-binder collections.
 */
export interface UpdateCollectionOptions {
  name?: string
  description?: string | null
  // #703 — move into a binder, or pass null to unfile. Only sent when the
  // key is present, so an identity-only PATCH leaves the filing intact.
  binder_id?: number | null
  binder_format?: BinderFormat | null
  binder_color?: string | null
  binder_type?: BinderType | null
  capacity?: number | null
  is_master_set?: boolean | null
}

export async function updateCollection(
  collectionId: number,
  patch: UpdateCollectionOptions,
): Promise<Collection> {
  const res = await fetch(`${BASE}/collections/${collectionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`update collection failed: ${res.status}`)
  return (await res.json()) as Collection
}

// ---------------------------------------------------------------------------
// #631 — catalog-backed target view + chase
// ---------------------------------------------------------------------------

/** One catalog match, annotated with the user's ownership of it. */
export interface TargetCard {
  card: Record<string, unknown>
  card_set_id: string | null
  card_number: string | null
  owned: boolean
  owned_quantity: number
}

/** Resolved catalog membership for a `catalog`-scope dynamic collection. */
export interface CollectionTarget {
  id: number
  name: string
  rule: CollectionRule | null
  total: number
  owned_count: number
  cards: TargetCard[]
}

export async function fetchCollectionTarget(
  collectionId: number,
  apiKey?: string,
): Promise<CollectionTarget> {
  const params = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  const res = await fetch(`${BASE}/collections/${collectionId}/target${params}`)
  if (!res.ok) throw new Error(`collection target failed: ${res.status}`)
  return (await res.json()) as CollectionTarget
}

export interface ChaseResult {
  wishlist_id: number
  added: number
  skipped: number
  total_missing: number
}

/**
 * Push the un-owned matches onto a want-list. Pass exactly one of
 * `wishlistName` (creates a fresh list) or `wishlistId` (an existing one).
 */
export async function chaseCollection(
  collectionId: number,
  target: { wishlistName?: string; wishlistId?: number; maxPrice?: number },
  apiKey?: string,
): Promise<ChaseResult> {
  const params = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  const res = await fetch(`${BASE}/collections/${collectionId}/chase${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wishlist_name: target.wishlistName ?? null,
      wishlist_id: target.wishlistId ?? null,
      max_price: target.maxPrice ?? null,
    }),
  })
  if (!res.ok) throw new Error(`chase failed: ${res.status}`)
  return (await res.json()) as ChaseResult
}

export async function addCardToCollection(
  collectionId: number,
  card: Record<string, unknown>,
  notes?: string | null,
): Promise<CollectionItem> {
  const res = await fetch(`${BASE}/collections/${collectionId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card, notes: notes ?? null }),
  })
  if (!res.ok) throw new Error(`add to collection failed: ${res.status}`)
  return (await res.json()) as CollectionItem
}

/** Set a card's owned quantity in a collection (#769). Floored at 1 server-side
 * — removing the last copy is a delete, not a quantity-0 update. */
export async function updateCollectionItem(
  collectionId: number,
  itemId: number,
  quantity: number,
): Promise<CollectionItem> {
  const res = await fetch(`${BASE}/collections/${collectionId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  })
  if (!res.ok) throw new Error(`update collection item failed: ${res.status}`)
  return (await res.json()) as CollectionItem
}

/** Result of a bulk add: the created rows plus their count (#268). */
export interface BulkAddResult<T> {
  added: number
  items: T[]
}

/** Add many cards to a collection in one call — the results-table
 * "add selected to binder (owned)" action (#268). */
export async function bulkAddToCollection(
  collectionId: number,
  cards: Record<string, unknown>[],
  opts?: { notes?: string | null; addedVia?: string },
): Promise<BulkAddResult<CollectionItem>> {
  const res = await fetch(`${BASE}/collections/${collectionId}/items/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cards,
      notes: opts?.notes ?? null,
      added_via: opts?.addedVia ?? null,
    }),
  })
  if (!res.ok) throw new Error(`bulk add to collection failed: ${res.status}`)
  return (await res.json()) as BulkAddResult<CollectionItem>
}

/** Delete a collection and cascade-remove its items. */
export async function deleteCollection(collectionId: number): Promise<void> {
  const res = await fetch(`${BASE}/collections/${collectionId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    throw new Error(`delete collection failed: ${res.status}`)
  }
}

// ---------------------------------------------------------------------------
// Binders (#702) — physical binders that hold collections.
// ---------------------------------------------------------------------------

export interface BinderCollection {
  id: number
  name: string
  item_count: number
  total_quantity: number
}

// A want-list filed into a binder (#774).
export interface BinderWishlist {
  id: number
  name: string
  item_count: number
}

export interface BinderSummary {
  id: number
  name: string
  created_at: string
  binder_format: BinderFormat | null
  binder_color: string | null
  binder_type: BinderType | null
  capacity: number | null
  collection_count: number
  // Want-lists filed into this binder (#774).
  wishlist_count: number
  is_empty: boolean
}

export interface Binder extends BinderSummary {
  collections: BinderCollection[]
  wishlists: BinderWishlist[]
}

export interface BinderInput {
  binder_format?: BinderFormat | null
  binder_color?: string | null
  binder_type?: BinderType | null
  capacity?: number | null
}

export async function fetchBinders(): Promise<BinderSummary[]> {
  const res = await fetch(`${BASE}/binders`)
  if (!res.ok) throw new Error(`binders failed: ${res.status}`)
  const data = await res.json()
  return data.binders as BinderSummary[]
}

export async function createBinder(name: string, input?: BinderInput): Promise<Binder> {
  const res = await fetch(`${BASE}/binders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      binder_format: input?.binder_format ?? null,
      binder_color: input?.binder_color ?? null,
      binder_type: input?.binder_type ?? null,
      capacity: input?.capacity ?? null,
    }),
  })
  if (!res.ok) throw new Error(`create binder failed: ${res.status}`)
  return (await res.json()) as Binder
}

export async function updateBinder(
  binderId: number,
  patch: { name?: string } & BinderInput,
): Promise<Binder> {
  const res = await fetch(`${BASE}/binders/${binderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`update binder failed: ${res.status}`)
  return (await res.json()) as Binder
}

export async function deleteBinder(binderId: number): Promise<void> {
  const res = await fetch(`${BASE}/binders/${binderId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    throw new Error(`delete binder failed: ${res.status}`)
  }
}

// ---------------------------------------------------------------------------
// Favorite sets (#712) — durable per-user pinned sets for personalization.
// ---------------------------------------------------------------------------

export interface FavoriteSet {
  set_id: string
  pinned_at: string
}

/** A set the user might want to pin, with the owned-card count behind it. */
export interface FavoriteSetSuggestion {
  set_id: string
  owned_count: number
}

export async function fetchFavoriteSets(): Promise<FavoriteSet[]> {
  const res = await fetch(`${BASE}/favorite-sets`)
  if (!res.ok) throw new Error(`favorite sets failed: ${res.status}`)
  const data = await res.json()
  return data.sets as FavoriteSet[]
}

export async function pinFavoriteSet(setId: string): Promise<void> {
  const res = await fetch(`${BASE}/favorite-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set_id: setId }),
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`pin favorite set failed: ${res.status}`)
  }
}

export async function unpinFavoriteSet(setId: string): Promise<void> {
  const res = await fetch(`${BASE}/favorite-sets/${encodeURIComponent(setId)}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`unpin favorite set failed: ${res.status}`)
  }
}

export async function fetchFavoriteSetSuggestions(): Promise<FavoriteSetSuggestion[]> {
  const res = await fetch(`${BASE}/favorite-sets/suggestions`)
  if (!res.ok) throw new Error(`favorite set suggestions failed: ${res.status}`)
  const data = await res.json()
  return data.suggestions as FavoriteSetSuggestion[]
}

// ---------------------------------------------------------------------------
// Favorite Pokémon (#742) — durable per-user pinned species, keyed by national
// Pokédex number. The species-level sibling of favorite sets.
// ---------------------------------------------------------------------------

export interface FavoritePokemon {
  dex_number: number
  pinned_at: string
}

export async function fetchFavoritePokemon(): Promise<FavoritePokemon[]> {
  const res = await fetch(`${BASE}/favorite-pokemon`)
  if (!res.ok) throw new Error(`favorite pokemon failed: ${res.status}`)
  const data = await res.json()
  return data.pokemon as FavoritePokemon[]
}

export async function pinFavoritePokemon(dexNumber: number): Promise<void> {
  const res = await fetch(`${BASE}/favorite-pokemon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dex_number: dexNumber }),
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`pin favorite pokemon failed: ${res.status}`)
  }
}

export async function unpinFavoritePokemon(dexNumber: number): Promise<void> {
  const res = await fetch(`${BASE}/favorite-pokemon/${dexNumber}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`unpin favorite pokemon failed: ${res.status}`)
  }
}

/**
 * Download the printable collection ID card PDF (#507) — the cover cutout for
 * the top-left binder pocket (title, a representative card photo, owned/total).
 * Triggers a browser save; mirrors `downloadSetCardsPdf`.
 */
export async function downloadCollectionIdCardPdf(
  collectionId: number,
  apiKey?: string,
): Promise<void> {
  const params = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  const res = await fetch(`${BASE}/collections/${collectionId}/id-card.pdf${params}`)
  if (!res.ok) {
    let detail = `id card failed: ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* fall through */
    }
    throw new Error(detail)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `collection-${collectionId}-id-card.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ---------------------------------------------------------------------------
// #575 — aggregate insights dashboard
// ---------------------------------------------------------------------------

export interface InsightsTotals {
  collections: number
  unique_cards: number
  total_quantity: number
  estimated_value: number
}

/** One bar in a top-N breakdown — a label and its distinct-card count. */
export interface LabeledCount {
  label: string
  count: number
}

export interface DuplicateCard {
  card_name: string | null
  card_set_id: string | null
  card_number: string | null
  quantity: number
  collection_name: string
}

export interface CrossCollectionCard {
  card_name: string | null
  card_set_id: string | null
  card_number: string | null
  total_quantity: number
  collections: string[]
}

export interface AlreadyOwnedChase {
  card_name: string | null
  card_set_id: string | null
  card_number: string | null
  wishlist_id: number
  wishlist_name: string
  collections: string[]
}

/** One owned card identity ranked by its per-copy price snapshot. */
export interface ValueCard {
  card_name: string | null
  card_set_id: string | null
  card_number: string | null
  price: number
}

/** One bar in a value breakdown — a label and its summed estimated value. */
export interface LabeledValue {
  label: string
  value: number
}

/** Aggregate "your collection at a glance" across all of the user's
 * collections (#575). */
export interface CollectionInsights {
  totals: InsightsTotals
  top_types: LabeledCount[]
  top_rarities: LabeledCount[]
  top_sets: LabeledCount[]
  top_value_cards: ValueCard[]
  value_by_set: LabeledValue[]
  value_by_collection: LabeledValue[]
  duplicate_multiples: DuplicateCard[]
  cross_collection: CrossCollectionCard[]
  already_owned_chasing: AlreadyOwnedChase[]
}

export async function fetchCollectionInsights(): Promise<CollectionInsights> {
  const res = await fetch(`${BASE}/collections/insights`)
  if (!res.ok) throw new Error(`collection insights failed: ${res.status}`)
  return (await res.json()) as CollectionInsights
}

// ---------------------------------------------------------------------------
// wishlists
// ---------------------------------------------------------------------------

export interface WishlistSummary {
  id: number
  name: string
  description: string | null
  created_at: string
  item_count: number
  // The binder this want-list is filed into, or null when loose (#774).
  binder_id: number | null
}

export interface WishlistItem {
  id: number
  card: Record<string, unknown>
  notes: string | null
  max_price: number | null
  added_at: string
  // Promoted identity + lifecycle fields (#574/#504). Optional so partial
  // fixtures stay valid — the wire always carries them (null when absent).
  card_set_id?: string | null
  card_number?: string | null
  card_name?: string | null
  card_rarity?: string | null
  card_types?: string[] | null
  card_image_url?: string | null
  price_snapshot?: number | null
  priced_at?: string | null
  // Non-null once the chase is closed and the card is owned (#504).
  acquired_at?: string | null
  acquired_collection_item_id?: number | null
}

export interface Wishlist {
  id: number
  name: string
  description: string | null
  created_at: string
  // The binder this want-list is filed into, or null when loose (#774).
  binder_id: number | null
  items: WishlistItem[]
}

export async function fetchWishlists(): Promise<WishlistSummary[]> {
  const res = await fetch(`${BASE}/wishlists`)
  if (!res.ok) throw new Error(`wishlists failed: ${res.status}`)
  const data = await res.json()
  return data.items as WishlistSummary[]
}

export async function fetchWishlist(wishlistId: number): Promise<Wishlist> {
  const res = await fetch(`${BASE}/wishlists/${wishlistId}`)
  if (!res.ok) throw new Error(`wishlist failed: ${res.status}`)
  return (await res.json()) as Wishlist
}

/** The wishlist row (now acquired) plus the collection row it produced. */
export interface PromoteResult {
  wishlist_item: WishlistItem
  collection_item: CollectionItem
}

/**
 * Close a chase: mark a wishlist item acquired and land it in a collection
 * (#504). The wishlist row survives — stamped `acquired_at` — so the list
 * doubles as a show retrospective.
 */
export async function promoteWishlistItem(
  wishlistId: number,
  itemId: number,
  opts: { collectionId: number; quantity?: number; notes?: string | null },
): Promise<PromoteResult> {
  const res = await fetch(
    `${BASE}/wishlists/${wishlistId}/items/${itemId}/promote`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection_id: opts.collectionId,
        quantity: opts.quantity ?? 1,
        notes: opts.notes ?? null,
      }),
    },
  )
  if (!res.ok) throw new Error(`promote failed: ${res.status}`)
  return (await res.json()) as PromoteResult
}

export interface CreateWishlistOptions {
  description?: string | null
  // #774 — file the new want-list into this binder (binders.id).
  binder_id?: number | null
}

export async function createWishlist(
  name: string,
  options?: CreateWishlistOptions,
): Promise<Wishlist> {
  const res = await fetch(`${BASE}/wishlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: options?.description ?? null,
      binder_id: options?.binder_id ?? null,
    }),
  })
  if (!res.ok) throw new Error(`create wishlist failed: ${res.status}`)
  return (await res.json()) as Wishlist
}

/**
 * PATCH a want-list. Only the keys present are sent, so a filing-only edit
 * (`binder_id`) leaves name/description intact — the server reads
 * `model_fields_set`. Pass `binder_id: null` to unfile (#774).
 */
export interface UpdateWishlistOptions {
  name?: string
  description?: string | null
  binder_id?: number | null
}

export async function updateWishlist(
  wishlistId: number,
  patch: UpdateWishlistOptions,
): Promise<Wishlist> {
  const res = await fetch(`${BASE}/wishlists/${wishlistId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`update wishlist failed: ${res.status}`)
  return (await res.json()) as Wishlist
}

export async function addCardToWishlist(
  wishlistId: number,
  card: Record<string, unknown>,
  opts?: { notes?: string | null; maxPrice?: number | null },
): Promise<WishlistItem> {
  const res = await fetch(`${BASE}/wishlists/${wishlistId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card,
      notes: opts?.notes ?? null,
      max_price: opts?.maxPrice ?? null,
    }),
  })
  if (!res.ok) throw new Error(`add to wishlist failed: ${res.status}`)
  return (await res.json()) as WishlistItem
}

/** Add many cards to a want-list in one call — the results-table
 * "add selected to binder (chasing)" action (#268). */
export async function bulkAddToWishlist(
  wishlistId: number,
  cards: Record<string, unknown>[],
  opts?: { notes?: string | null; maxPrice?: number | null },
): Promise<BulkAddResult<WishlistItem>> {
  const res = await fetch(`${BASE}/wishlists/${wishlistId}/items/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cards,
      notes: opts?.notes ?? null,
      max_price: opts?.maxPrice ?? null,
    }),
  })
  if (!res.ok) throw new Error(`bulk add to want-list failed: ${res.status}`)
  return (await res.json()) as BulkAddResult<WishlistItem>
}

/** Delete a want-list and cascade-remove its items. */
export async function deleteWishlist(wishlistId: number): Promise<void> {
  const res = await fetch(`${BASE}/wishlists/${wishlistId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    throw new Error(`delete want-list failed: ${res.status}`)
  }
}

/** Remove a single card from a want-list. */
export async function deleteWishlistItem(
  wishlistId: number,
  itemId: number,
): Promise<void> {
  const res = await fetch(`${BASE}/wishlists/${wishlistId}/items/${itemId}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`remove want-list card failed: ${res.status}`)
  }
}

/** Remove a card from a specific collection / want-list by its (set_id,
 *  number) identity — the card-detail "remove from this list" affordance
 *  (#762). The occupancy payload carries list ids but no item ids, so removal
 *  targets the card itself; the server drops every matching row. */
export async function removeCardFromCollection(
  collectionId: number,
  setId: string,
  number: string,
): Promise<void> {
  const params = new URLSearchParams({ set_id: setId, number })
  const res = await fetch(`${BASE}/collections/${collectionId}/items?${params}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`remove collection card failed: ${res.status}`)
  }
}

export async function removeCardFromWishlist(
  wishlistId: number,
  setId: string,
  number: string,
): Promise<void> {
  const params = new URLSearchParams({ set_id: setId, number })
  const res = await fetch(`${BASE}/wishlists/${wishlistId}/items?${params}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`remove want-list card failed: ${res.status}`)
  }
}

// ---------------------------------------------------------------------------
// swipe (library-aware deck memory + exclusion, #581)
// ---------------------------------------------------------------------------

/** The promoted `(set_id, number)` identity the swipe deck excludes on. */
export interface SwipeCardIdentity {
  set_id: string
  number: string
}

/**
 * Identities the swipe deck should skip for the current user. Always
 * includes the persisted "already seen" set; `owned` / `chasing` fold in
 * the user's collection / wishlist cards respectively. The SPA keys its
 * candidate filter on `${set_id}-${number}` so this composes directly with
 * the client-side sampler.
 */
export async function fetchSwipeExcluded(opts?: {
  owned?: boolean
  chasing?: boolean
}): Promise<SwipeCardIdentity[]> {
  const params = new URLSearchParams()
  if (opts?.owned) params.set('owned', 'true')
  if (opts?.chasing) params.set('chasing', 'true')
  const qs = params.toString()
  const res = await fetch(`${BASE}/swipe/excluded${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(`swipe excluded failed: ${res.status}`)
  const data = await res.json()
  return data.cards as SwipeCardIdentity[]
}

/** Record one shown card so it never resurfaces across sessions. Idempotent. */
export async function recordSwipeSeen(
  setId: string,
  number: string,
  dir?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/swipe/seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set_id: setId, number, dir: dir ?? null }),
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`record swipe seen failed: ${res.status}`)
  }
}

/** Reset the deck — clear the user's seen memory, or just one set's. */
export async function resetSwipeSeen(setId?: string): Promise<void> {
  const qs = setId ? `?set_id=${encodeURIComponent(setId)}` : ''
  const res = await fetch(`${BASE}/swipe/seen${qs}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    throw new Error(`reset swipe seen failed: ${res.status}`)
  }
}

// ---------------------------------------------------------------------------
// card ownership (cross-collection badges, #576)
// ---------------------------------------------------------------------------

export interface CollectionOccupancy {
  id: number
  name: string
  quantity: number
}

export interface WishlistOccupancy {
  id: number
  name: string
}

export interface CardOwnership {
  collections: CollectionOccupancy[]
  wishlists: WishlistOccupancy[]
}

/**
 * Per-card occupancy across the user's collections + wishlists, for a batch
 * of `(set_id, number)` identities. The response is a sparse map keyed by
 * `${set_id}::${number}` — only cards the user owns or is chasing appear, so
 * the SPA renders a badge exactly when the key is present.
 */
export async function fetchCardOwnership(
  cards: { set_id: string; number: string }[],
): Promise<Record<string, CardOwnership>> {
  const res = await fetch(`${BASE}/cards/ownership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards }),
  })
  if (!res.ok) throw new Error(`card ownership failed: ${res.status}`)
  const data = await res.json()
  return data.ownership as Record<string, CardOwnership>
}

/**
 * A card's derived library state after a quick action (#760) — the `wanted` /
 * `owned` view flags plus the named lists/collections it sits in.
 */
export interface CardState {
  set_id: string | null
  number: string | null
  wanted: boolean
  owned: boolean
  collections: CollectionOccupancy[]
  wishlists: WishlistOccupancy[]
}

/** One-tap quick actions against the user's default wishlist / collection
 *  (#761, ADR-0027). Each writes to the default and returns the card's derived
 *  state; all are idempotent server-side. */
async function cardAction(path: string, card: Record<string, unknown>): Promise<CardState> {
  const res = await fetch(`${BASE}/cards/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card }),
  })
  if (!res.ok) throw new Error(`card ${path} failed: ${res.status}`)
  return (await res.json()) as CardState
}

export const wantCard = (card: Record<string, unknown>) => cardAction('want', card)
export const unwantCard = (card: Record<string, unknown>) => cardAction('unwant', card)
export const ownCard = (card: Record<string, unknown>) => cardAction('own', card)
export const unownCard = (card: Record<string, unknown>) => cardAction('unown', card)
