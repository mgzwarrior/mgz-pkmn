/**
 * useAuth.test — pins the contract `SignInChip` consumes: mount-time
 * `fetchMe` resolves into `user` + clears `loading`; `signOut` POSTs
 * logout and flips the user back to null; `refresh` re-polls. The
 * SignInChip component-level tests cover the rendered shapes already
 * — this file targets the hook's branches directly so a future
 * consumer (the #412 save-search nudge) inherits the coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth'

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
})

describe('useAuth', () => {
  it('clears loading and resolves user to null for an anonymous session', async () => {
    fetchMeMock.mockResolvedValue(null)
    const { result } = renderHook(() => useAuth())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('resolves user to the /me payload when signed in', async () => {
    const me = { id: 7, email: 'm@e.com', display_name: 'M' }
    fetchMeMock.mockResolvedValue(me)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(me)
  })

  it('treats a fetchMe rejection as anonymous (no thrown error to the consumer)', async () => {
    fetchMeMock.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('signOut still clears the user when apiLogout rejects', async () => {
    fetchMeMock.mockResolvedValue({ id: 1, email: 'x@y.z', display_name: 'X' })
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
    fetchMeMock.mockResolvedValue({ id: 1, email: 'x@y.z', display_name: 'X' })
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
    fetchMeMock.mockResolvedValueOnce(null)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    fetchMeMock.mockResolvedValueOnce({ id: 2, email: 'p@q.r', display_name: 'P' })
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.user).toEqual({ id: 2, email: 'p@q.r', display_name: 'P' })
  })

  it('refresh handles a rejection by clearing the user', async () => {
    fetchMeMock.mockResolvedValueOnce({ id: 3, email: 'a@b.c', display_name: 'A' })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.user).not.toBeNull())
    fetchMeMock.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.user).toBeNull()
  })
})
