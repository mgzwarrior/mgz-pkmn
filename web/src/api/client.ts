/**
 * API client functions for the mgz-pkmn FastAPI backend.
 *
 * All functions talk to `/api/v1/*`. In development Vite proxies those paths
 * to `http://localhost:8000`; in production the SPA is served from the same
 * origin as the API.
 */

import type { BulkEvent, CardQuery, ExportFormat, Row, SetInfo, Settings, SortMode } from '../types'

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

export async function exportFile(
  rows: Row[],
  format: ExportFormat,
  options: {
    maxPrice?: number | null
    title?: string
    sort?: SortMode
    noImages?: boolean
  } = {},
): Promise<void> {
  const res = await fetch(`${BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rows,
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
 */
export async function downloadSetCardsPdf(apiKey?: string): Promise<void> {
  const params = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  const res = await fetch(`${BASE}/set-cards.pdf${params}`)
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
