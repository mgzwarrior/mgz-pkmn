/**
 * useAuth — minimal hook exposing the current signed-in user (or null
 * for anonymous) plus a `refresh()` callback the OAuth/magic-link
 * flows can call when they land back on `/` to re-poll `GET /me`.
 *
 * No global store on purpose: the chip is the only consumer in this
 * slice. If a second consumer lands later (the save-search nudge in
 * #412), promote to zustand then.
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchMe, logout as apiLogout, type Me } from '../api/client'

export interface UseAuthResult {
  user: Me | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe()
      setUser(me)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await apiLogout()
    setUser(null)
  }, [])

  // Fetch once on mount. Guard the `setUser` calls with a `cancelled`
  // flag so unmount during the in-flight request can't trigger a
  // post-unmount state update (and so the lint rule's "no setState in
  // effect" pattern is satisfied — the resolution is in a `.then`,
  // not in the effect body).
  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { user, loading, refresh, signOut }
}
