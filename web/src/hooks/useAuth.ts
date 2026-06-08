/**
 * useAuth — exposes the current user (or null for signed-out) plus the
 * `authEnabled` deploy-mode flag and a `refresh()` callback the OAuth /
 * magic-link flows can call when they land back on `/` to re-poll
 * `GET /api/v1/me`.
 *
 * `user != null` is the single check for "is there an identified user
 * behind this request" — works identically in production (signed-in
 * user) and self-host (sentinel default user). `authEnabled` is only
 * used by the SignInChip to hide itself entirely on self-host.
 *
 * Backed by a module-level zustand store so every consumer (header
 * chip, saved-search sidebar, results-table save buttons, the App
 * shell) shares the same `user` reference. `signOut()` in one mount
 * point clears the state for all of them — without that, the chip
 * would flip to "Sign in" while the table kept enabling Save buttons
 * for the just-signed-out user and would 401 on the next click.
 *
 * The initial `/me` fetch fires once on first mount across the whole
 * app; subsequent mounts inherit the cached store state instead of
 * re-polling, which is what self-host expects (one source of truth for
 * the default user) and what the SPA's existing single-page contract
 * requires.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { fetchMe, logout as apiLogout, type Me } from '../api/client'

export interface UseAuthResult {
  user: Me | null
  /** True when `MGZ_PKMN_AUTH_ENABLED=1` on the API. Self-host (false)
   * has no sign-in surface to render — the SignInChip hides itself.
   * Collections / wishlists chips key off `user != null` and ignore
   * this flag (so self-host's default-user shape still lights them up). */
  authEnabled: boolean
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

interface AuthStore {
  user: Me | null
  authEnabled: boolean
  loading: boolean
  /** Tracks the in-flight `/me` request so a burst of simultaneous
   * mounts doesn't fan out into N parallel network calls. */
  inflight: Promise<void> | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  // Optimistic default: assume auth is on so a transient /me failure
  // doesn't accidentally hide the SignInChip in production. Self-host
  // flips this false on the first successful /me read.
  authEnabled: true,
  loading: true,
  inflight: null,
  refresh: async () => {
    const existing = get().inflight
    if (existing) {
      await existing
      return
    }
    const p = (async () => {
      try {
        const envelope = await fetchMe()
        set({ user: envelope.user, authEnabled: envelope.authEnabled })
      } catch {
        set({ user: null })
      } finally {
        set({ loading: false, inflight: null })
      }
    })()
    set({ inflight: p })
    await p
  },
  // Always clear the local user, even when the server-side logout call
  // rejects (network error, transient 5xx). The user's intent is "sign
  // me out"; preserving the signed-in shape after the click would
  // surface a confusing state. The server cookie may still be live
  // until its TTL expires, but clicking Sign in / refreshing recovers.
  // Swallowing the error also keeps `void signOut()` callers from
  // emitting unhandled-rejection noise in the console / tests.
  signOut: async () => {
    try {
      await apiLogout()
    } catch {
      // intentionally ignored — see comment above.
    }
    set({ user: null })
  },
}))

/** Test-only: reset the module-level store between renderHook cases so
 * one test's signed-in state doesn't leak into the next. Production
 * callers never need this — the store lives for the page's lifetime. */
export function _resetAuthStoreForTests(): void {
  useAuthStore.setState({
    user: null,
    authEnabled: true,
    loading: true,
    inflight: null,
  })
}

export function useAuth(): UseAuthResult {
  const user = useAuthStore((s) => s.user)
  const authEnabled = useAuthStore((s) => s.authEnabled)
  const loading = useAuthStore((s) => s.loading)
  const refresh = useAuthStore((s) => s.refresh)
  const signOut = useAuthStore((s) => s.signOut)

  // First consumer to mount kicks the shared `/me` fetch; later
  // consumers inherit the store's resolved state without re-polling.
  // `refresh()` itself dedupes concurrent calls via the `inflight`
  // promise, so it's safe to invoke from every mounting consumer.
  useEffect(() => {
    if (useAuthStore.getState().loading && !useAuthStore.getState().inflight) {
      void refresh()
    }
  }, [refresh])

  return { user, authEnabled, loading, refresh, signOut }
}
