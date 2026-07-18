import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  dedupeRows,
  fetchChangelog,
  fetchMe,
  logout,
  lookupLine,
  removeCardFromCollection,
  removeCardFromWishlist,
  requestAccountMagicLink,
  requestMagicLink,
  unlinkIdentity,
  updateRunRowPricingOverride,
} from './client'
import type { Row, Settings } from '../types'
import { DEFAULT_EXPORT_FIELDS } from '../data/exportFields'

function makeRow(over: Partial<Row> = {}): Row {
  return {
    query: { raw: '', name: '' } as Row['query'],
    card: null,
    pricing: { market: null, currency: 'USD', variant: null, source: null, url: null },
    tag: '',
    matched: true,
    reason: '',
    ...over,
  }
}

function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    apiKey: '',
    maxPrice: null,
    noImages: false,
    tag: '',
    dedupe: false,
    sort: 'number',
    showTimer: false,
    showEbay: false,
    hideOwned: false,
    hidePricing: false,
    swipeRarityFloor: 'all',
    swipeExcludeOwned: false,
    swipeExcludeChasing: false,
    density: 'comfortable',
    exportFields: DEFAULT_EXPORT_FIELDS,
    leadWithIdCard: false,
    darkPdfExports: false,
    ...over,
  }
}

describe('dedupeRows', () => {
  it('removes matched rows sharing a card id, keeping the first occurrence', () => {
    const rows: Row[] = [
      makeRow({ card: { id: 'a', name: 'Charizard' } }),
      makeRow({ card: { id: 'b', name: 'Pikachu' } }),
      makeRow({ card: { id: 'a', name: 'Charizard' } }),
    ]
    const deduped = dedupeRows(rows)
    expect(deduped).toHaveLength(2)
    expect((deduped[0].card as { id: string }).id).toBe('a')
    expect((deduped[1].card as { id: string }).id).toBe('b')
  })

  it('preserves unmatched rows and rows missing a card id', () => {
    const rows: Row[] = [
      makeRow({ matched: false, card: null }),
      makeRow({ matched: false, card: null }),
      makeRow({ card: { name: 'Mystery' } }),
      makeRow({ card: { name: 'Mystery' } }),
    ]
    expect(dedupeRows(rows)).toHaveLength(4)
  })

  it('returns the same row count when there are no duplicates', () => {
    const rows: Row[] = [
      makeRow({ card: { id: 'a' } }),
      makeRow({ card: { id: 'b' } }),
      makeRow({ card: { id: 'c' } }),
    ]
    expect(dedupeRows(rows)).toHaveLength(3)
  })
})

describe('lookupLine', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the settings tag in the request payload (#365)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ rows: [] }), { status: 200 }))

    await lookupLine('Charizard', makeSettings({ tag: 'binder-a' }))

    const [, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse(init!.body as string)
    expect(body.settings.tag).toBe('binder-a')
  })
})

describe('fetchChangelog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the changelog endpoint with the limit and returns releases', async () => {
    const releases = [{ version: '1.1.1', date: '2026-05-25', sections: [] }]
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ releases }), { status: 200 }),
      )
    const result = await fetchChangelog(3)
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/changelog?limit=3')
    expect(result).toEqual(releases)
  })

  it('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    await expect(fetchChangelog()).rejects.toThrow(/changelog failed: 500/)
  })
})

describe('fetchMe', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a null-user envelope for an auth-on anonymous session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user: null, auth_enabled: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(fetchMe()).resolves.toEqual({ user: null, authEnabled: true })
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/me', { credentials: 'same-origin' })
  })

  it('returns the user envelope for a 200 signed-in response', async () => {
    const user = { id: 1, email: 'a@b.c', display_name: 'A' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user, auth_enabled: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(fetchMe()).resolves.toEqual({ user, authEnabled: true })
  })

  it('reports authEnabled false for the self-host envelope', async () => {
    const user = { id: 1, email: null, display_name: null }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user, auth_enabled: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(fetchMe()).resolves.toEqual({ user, authEnabled: false })
  })

  it('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    await expect(fetchMe()).rejects.toThrow(/me failed: 500/)
  })
})

describe('logout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to /auth/logout with same-origin credentials', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    await expect(logout()).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    })
  })

  it('throws on a non-204 / non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    await expect(logout()).rejects.toThrow(/logout failed: 500/)
  })
})

describe('requestMagicLink', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the email payload and resolves on 202', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }))
    await expect(requestMagicLink('user@example.com')).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/auth/magic/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    })
  })

  it('throws when SMTP is unconfigured (503)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))
    await expect(requestMagicLink('x@y.z')).rejects.toThrow(/magic-link failed: 503/)
  })
})

describe('requestAccountMagicLink', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the email payload to the account-link endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }))
    await expect(requestAccountMagicLink('alias@example.com')).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/auth/link/magic/start', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alias@example.com' }),
    })
  })
})

describe('unlinkIdentity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('DELETEs the identity with same-origin credentials', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    await expect(unlinkIdentity(42)).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/auth/identities/42', {
      method: 'DELETE',
      credentials: 'same-origin',
    })
  })

  it('throws on a failed unlink', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 400 }))
    await expect(unlinkIdentity(42)).rejects.toThrow(/unlink identity failed: 400/)
  })
})

describe('updateRunRowPricingOverride (#266)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('PATCHes the override value', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    await expect(updateRunRowPricingOverride(77, 0, 12)).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/runs/77/rows/0/override', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 12 }),
    })
  })

  it('PATCHes null to clear the override', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    await updateRunRowPricingOverride(77, 0, null)
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/runs/77/rows/0/override',
      expect.objectContaining({ body: JSON.stringify({ value: null }) }),
    )
  })

  it('throws sign-in required on a 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    await expect(updateRunRowPricingOverride(77, 0, 12)).rejects.toThrow('sign-in required')
  })

  it('throws a generic error on other failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    await expect(updateRunRowPricingOverride(77, 0, 12)).rejects.toThrow(
      /override update failed: 500/,
    )
  })
})

describe('removeCardFromCollection / removeCardFromWishlist (#762)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('DELETEs a collection card by its (set_id, number) identity', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    await expect(removeCardFromCollection(7, 'base1', '4')).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/collections/7/items?set_id=base1&number=4', {
      method: 'DELETE',
    })
  })

  it('treats a 404 as idempotent success so a stale chip still reconciles', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    await expect(removeCardFromCollection(7, 'base1', '4')).resolves.toBeUndefined()
    await expect(removeCardFromWishlist(9, 'base1', '4')).resolves.toBeUndefined()
  })

  it('throws on a real server error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    await expect(removeCardFromWishlist(9, 'base1', '4')).rejects.toThrow(
      /remove want-list card failed: 500/,
    )
  })
})
