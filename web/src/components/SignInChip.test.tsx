/**
 * SignInChip.test — anonymous/authenticated rendering, provider-picker
 * surface (OAuth anchors, magic-link form + confirmation), and the
 * dropdown sign-out path. Backed by a mocked `api/client` so the hook's
 * mount-time `fetchMe` resolves synchronously to the test's chosen
 * shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SignInChip } from './SignInChip'

const { fetchMeMock, logoutMock, requestMagicLinkMock } = vi.hoisted(() => ({
  fetchMeMock: vi.fn(),
  logoutMock: vi.fn(),
  requestMagicLinkMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  fetchMe: fetchMeMock,
  logout: logoutMock,
  requestMagicLink: requestMagicLinkMock,
}))

beforeEach(() => {
  fetchMeMock.mockReset()
  logoutMock.mockReset()
  requestMagicLinkMock.mockReset()
})

describe('SignInChip (anonymous)', () => {
  it('renders the Sign in button when /me returns null', async () => {
    fetchMeMock.mockResolvedValue(null)
    render(<SignInChip />)
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('opens the provider picker with GitHub, Google, and magic-link options', async () => {
    fetchMeMock.mockResolvedValue(null)
    render(<SignInChip />)
    fireEvent.click(await screen.findByRole('button', { name: /sign in/i }))
    expect(await screen.findByRole('link', { name: /continue with github/i })).toHaveAttribute(
      'href',
      '/api/v1/auth/github/login',
    )
    expect(screen.getByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      '/api/v1/auth/google/login',
    )
    expect(screen.getByRole('button', { name: /email me a magic link/i })).toBeInTheDocument()
  })

  it('expands the magic-link form and posts the email on submit', async () => {
    fetchMeMock.mockResolvedValue(null)
    requestMagicLinkMock.mockResolvedValue(undefined)
    render(<SignInChip />)
    fireEvent.click(await screen.findByRole('button', { name: /sign in/i }))
    fireEvent.click(screen.getByRole('button', { name: /email me a magic link/i }))
    const input = screen.getByLabelText(/email/i)
    fireEvent.change(input, { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => {
      expect(requestMagicLinkMock).toHaveBeenCalledWith('user@example.com')
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/check your inbox/i)
  })

  it('surfaces an error when the magic-link request fails', async () => {
    fetchMeMock.mockResolvedValue(null)
    requestMagicLinkMock.mockRejectedValue(new Error('boom'))
    render(<SignInChip />)
    fireEvent.click(await screen.findByRole('button', { name: /sign in/i }))
    fireEvent.click(screen.getByRole('button', { name: /email me a magic link/i }))
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'x@y.z' } })
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t send/i)
  })
})

describe('SignInChip (signed in)', () => {
  it('renders display_name and offers Sign out via dropdown', async () => {
    fetchMeMock.mockResolvedValue({ id: 1, email: 'jane@example.com', display_name: 'Jane Doe' })
    logoutMock.mockResolvedValue(undefined)
    render(<SignInChip />)
    const trigger = await screen.findByRole('button', { name: /account menu for jane doe/i })
    expect(trigger).toHaveTextContent(/jane doe/i)
    // Radix DropdownMenu opens on pointerdown, not click — mirror the
    // ExportBar test's keyboard-driven open sequence so jsdom reveals
    // the menu contents.
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
    const signOut = await screen.findByRole('menuitem', { name: /sign out/i })
    await act(async () => {
      fireEvent.click(signOut)
    })
    expect(logoutMock).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })
  })

  it('falls back to initials when display_name is missing', async () => {
    fetchMeMock.mockResolvedValue({ id: 2, email: 'sam@example.com', display_name: null })
    render(<SignInChip />)
    const trigger = await screen.findByRole('button', { name: /account menu for sam@example.com/i })
    expect(trigger).toHaveTextContent(/SA/)
  })
})
