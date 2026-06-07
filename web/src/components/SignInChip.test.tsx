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
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
    render(<SignInChip />)
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('opens the provider picker with GitHub, Google, and magic-link options', async () => {
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
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
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
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

  it('resets the magic-link form state when the picker is closed and re-opened', async () => {
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
    requestMagicLinkMock.mockResolvedValue(undefined)
    render(<SignInChip />)
    const open = await screen.findByRole('button', { name: /sign in/i })
    fireEvent.click(open)
    fireEvent.click(screen.getByRole('button', { name: /email me a magic link/i }))
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    fireEvent.click(open)
    // Picker re-opens in collapsed state — the magic-link button is
    // back, the form is gone, and the previously-typed email is cleared.
    expect(await screen.findByRole('button', { name: /email me a magic link/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  it('drops a magic-link resolution that lands after the picker is closed', async () => {
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
    let resolveRequest!: () => void
    requestMagicLinkMock.mockReturnValue(new Promise<void>((resolve) => { resolveRequest = resolve }))
    render(<SignInChip />)
    const openButton = await screen.findByRole('button', { name: /sign in/i })
    fireEvent.click(openButton)
    fireEvent.click(screen.getByRole('button', { name: /email me a magic link/i }))
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'late@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    // Close mid-request — bumps the request-generation guard.
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    // Late resolution lands; the guard discards it.
    await act(async () => {
      resolveRequest()
    })
    // Re-open: form is collapsed back to the initial state, no stale
    // "Check your inbox" leaking from the prior generation.
    fireEvent.click(openButton)
    expect(await screen.findByRole('button', { name: /email me a magic link/i })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('surfaces an error when the magic-link request fails', async () => {
    fetchMeMock.mockResolvedValue({ user: null, authEnabled: true })
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
  it('renders an icon-only trigger and surfaces display_name + email inside the dropdown', async () => {
    fetchMeMock.mockResolvedValue({
      user: { id: 1, email: 'jane@example.com', display_name: 'Jane Doe' },
      authEnabled: true,
    })
    logoutMock.mockResolvedValue(undefined)
    render(<SignInChip />)
    const trigger = await screen.findByRole('button', { name: /account menu for jane doe/i })
    // Icon-only trigger: the visible glyph is the initials avatar, the
    // display name lives in the dropdown content rather than next to
    // the avatar.
    expect(trigger).toHaveTextContent(/JD/)
    expect(trigger).not.toHaveTextContent(/jane doe/i)
    // Radix DropdownMenu opens on pointerdown, not click — mirror the
    // ExportBar test's keyboard-driven open sequence so jsdom reveals
    // the menu contents.
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
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
    fetchMeMock.mockResolvedValue({
      user: { id: 2, email: 'sam@example.com', display_name: null },
      authEnabled: true,
    })
    render(<SignInChip />)
    const trigger = await screen.findByRole('button', { name: /account menu for sam@example.com/i })
    expect(trigger).toHaveTextContent(/SA/)
  })
})

describe('SignInChip (loading)', () => {
  it('renders an aria-busy placeholder until /me resolves', async () => {
    let resolveMe!: (v: { user: null; authEnabled: boolean }) => void
    fetchMeMock.mockReturnValue(
      new Promise<{ user: null; authEnabled: boolean }>((resolve) => {
        resolveMe = resolve
      }),
    )
    render(<SignInChip />)
    const placeholder = await screen.findByLabelText(/loading sign-in state/i)
    expect(placeholder).toHaveAttribute('aria-busy', 'true')
    await act(async () => {
      resolveMe({ user: null, authEnabled: true })
    })
    await waitFor(() => {
      expect(screen.queryByLabelText(/loading sign-in state/i)).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('falls back to anonymous when fetchMe rejects', async () => {
    fetchMeMock.mockRejectedValue(new Error('network'))
    render(<SignInChip />)
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})

describe('SignInChip (self-host)', () => {
  it('renders nothing when auth is disabled on the deploy', async () => {
    // Self-host: /me returns the default user but auth_enabled is false.
    // The chip has no sign-in surface to render, so it hides entirely.
    fetchMeMock.mockResolvedValue({
      user: { id: 1, email: null, display_name: null },
      authEnabled: false,
    })
    const { container } = render(<SignInChip />)
    await waitFor(() => {
      expect(screen.queryByLabelText(/loading sign-in state/i)).not.toBeInTheDocument()
    })
    expect(container.firstChild).toBeNull()
  })
})
