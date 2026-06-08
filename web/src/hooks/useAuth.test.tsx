/**
 * useAuth.test — pins the contract `SignInChip` consumes: mount-time
 * `fetchMe` resolves into `user` + `authEnabled` + clears `loading`;
 * `signOut` POSTs logout and flips the user back to null; `refresh`
 * re-polls. The SignInChip component-level tests cover the rendered
 * shapes already — this file targets the hook's branches directly so a
 * future consumer (the #412 save-search nudge) inherits the coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth, _resetAuthStoreForTests } from './useAuth'

const { fetchMeMock, logoutMock } = vi.hoisted(() => ({
  fetchMeMock: vi.fn(),
  logoutMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  fetchMe: fetchMeMock,
  logout: logoutMock,
}))

beforeEach(() => {
  fetchMeMock.mockReset()
  logoutMock.mockReset()
  // The hook is backed by a module-level zustand store; reset it so
  // one test's resolved user can't leak into the next.
  _resetAuthStoreForTests()
})

describe('useAuth', () => {
  it('clears loading and resolves user to null for an anonymous auth-on session', async () => {
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
    const { result } = renderHook(() => useAuth())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(result.current.authEnabled).toBe(true)
  })

  it('resolves the user payload and authEnabled true when signed in', async () => {
    const me = { id: 7, email: 'm@e.com', display_name: 'M' }
    fetchMeMock.mockResolvedValue({ user: me, authEnabled: true })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(me)
    expect(result.current.authEnabled).toBe(true)
  })

  it('reports authEnabled false for the self-host envelope', async () => {
    // Self-host (`MGZ_PKMN_AUTH_ENABLED=0`): /me surfaces the default
    // user but the chip should know not to render a sign-in surface.
    const defaultUser = { id: 1, email: null, display_name: null }
    fetchMeMock.mockResolvedValue({ user: defaultUser, authEnabled: false })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(defaultUser)
    expect(result.current.authEnabled).toBe(false)
  })

  it('treats a fetchMe rejection as anonymous (no thrown error to the consumer)', async () => {
    fetchMeMock.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('signOut still clears the user when apiLogout rejects', async () => {
    fetchMeMock.mockResolvedValue({
      user: { id: 1, email: 'x@y.z', display_name: 'X' },
      authEnabled: true,
    })
    logoutMock.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.user).not.toBeNull())
    // Should not raise — the hook swallows the API error so callers
    // (`onSelect={() => void signOut()}`) don't leak unhandled rejections.
    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.user).toBeNull()
  })

  it('signOut calls the logout helper and clears the user', async () => {
    fetchMeMock.mockResolvedValue({
      user: { id: 1, email: 'x@y.z', display_name: 'X' },
      authEnabled: true,
    })
    logoutMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.user).not.toBeNull())
    await act(async () => {
      await result.current.signOut()
    })
    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(result.current.user).toBeNull()
  })

  it('refresh re-polls /me and updates user', async () => {
    fetchMeMock.mockResolvedValueOnce({ user: null, authEnabled: true })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const next = { id: 2, email: 'p@q.r', display_name: 'P' }
    fetchMeMock.mockResolvedValueOnce({ user: next, authEnabled: true })
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.user).toEqual(next)
  })

  it('shares user state across consumers so signOut clears every mount', async () => {
    // Pinned: the chip's signOut must propagate to the results-table
    // and saved-search-sidebar consumers, otherwise Save buttons stay
    // enabled and 401 on the next click.
    fetchMeMock.mockResolvedValue({
      user: { id: 9, email: 'a@b.c', display_name: 'A' },
      authEnabled: true,
    })
    logoutMock.mockResolvedValue(undefined)
    const { result: chip } = renderHook(() => useAuth())
    const { result: table } = renderHook(() => useAuth())
    await waitFor(() => expect(chip.current.user).not.toBeNull())
    expect(table.current.user).toEqual(chip.current.user)
    // Only one `/me` request total, regardless of mount count.
    expect(fetchMeMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await chip.current.signOut()
    })

    expect(chip.current.user).toBeNull()
    expect(table.current.user).toBeNull()
  })

  it('refresh handles a rejection by clearing the user', async () => {
    fetchMeMock.mockResolvedValueOnce({
      user: { id: 3, email: 'a@b.c', display_name: 'A' },
      authEnabled: true,
    })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.user).not.toBeNull())
    fetchMeMock.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.user).toBeNull()
  })
})
