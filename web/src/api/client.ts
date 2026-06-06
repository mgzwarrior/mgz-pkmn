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
 * Payload returned by `GET /api/v1/me` for a signed-in user. The endpoint
 * returns 204 (no body) for anonymous sessions; the `useAuth` hook maps
 * that to `null` so the chip can render the anonymous state without the
 * caller having to know about the status-code split.
 */
export interface Me {
  id: number
  email: string | null
  display_name: string | null
}

export async function fetchMe(): Promise<Me | null> {
  const res = await fetch(`${BASE}/me`, { credentials: 'same-origin' })
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`me failed: ${res.status}`)
  return (await res.json()) as Me
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

// ---------------------------------------------------------------------------
// collections
// ---------------------------------------------------------------------------

export interface CollectionSummary {
  id: number
  name: string
  description: string | null
  created_at: string
  item_count: number
}

export interface CollectionItem {
  id: number
  card: Record<string, unknown>
  notes: string | null
  added_at: string
}

export interface Collection {
  id: number
  name: string
  description: string | null
  created_at: string
  items: CollectionItem[]
}

export async function fetchCollections(): Promise<CollectionSummary[]> {
  const res = await fetch(`${BASE}/collections`)
  if (!res.ok) throw new Error(`collections failed: ${res.status}`)
  const data = await res.json()
  return data.items as CollectionSummary[]
}

export async function createCollection(
  name: string,
  description?: string | null,
): Promise<Collection> {
  const res = await fetch(`${BASE}/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: description ?? null }),
  })
  if (!res.ok) throw new Error(`create collection failed: ${res.status}`)
  return (await res.json()) as Collection
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

// ---------------------------------------------------------------------------
// wishlists
// ---------------------------------------------------------------------------

export interface WishlistSummary {
  id: number
  name: string
  description: string | null
  created_at: string
  item_count: number
}

export interface WishlistItem {
  id: number
  card: Record<string, unknown>
  notes: string | null
  max_price: number | null
  added_at: string
}

export interface Wishlist {
  id: number
  name: string
  description: string | null
  created_at: string
  items: WishlistItem[]
}

export async function fetchWishlists(): Promise<WishlistSummary[]> {
  const res = await fetch(`${BASE}/wishlists`)
  if (!res.ok) throw new Error(`wishlists failed: ${res.status}`)
  const data = await res.json()
  return data.items as WishlistSummary[]
}

export async function createWishlist(
  name: string,
  description?: string | null,
): Promise<Wishlist> {
  const res = await fetch(`${BASE}/wishlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: description ?? null }),
  })
  if (!res.ok) throw new Error(`create wishlist failed: ${res.status}`)
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
