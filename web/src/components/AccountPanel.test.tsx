/**
 * AccountPanel.test — covers the AC bullets from #491 slice 3:
 * identity rendering, Disconnect call + last-identity guard, Connect
 * form actions for GitHub/Google/Discord, magic-link form, and the 409
 * (`identity_already_linked`) inline error surfaced from the OAuth
 * callback redirect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { AccountPanel } from './AccountPanel'
import type { Me, MeIdentity } from '../api/client'

const { requestAccountMagicLinkMock, unlinkIdentityMock } = vi.hoisted(() => ({
  requestAccountMagicLinkMock: vi.fn(),
  unlinkIdentityMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  requestAccountMagicLink: requestAccountMagicLinkMock,
  unlinkIdentity: unlinkIdentityMock,
}))

function makeIdentity(over: Partial<MeIdentity> = {}): MeIdentity {
  return {
    id: 1,
    provider: 'github',
    email: 'alice@personal.com',
    linked_at: '2026-06-01T00:00:00Z',
    ...over,
  }
}

function makeUser(identities: MeIdentity[]): Me {
  return {
    id: 1,
    email: 'alice@personal.com',
    display_name: 'Alice',
    identities,
  }
}

beforeEach(() => {
  requestAccountMagicLinkMock.mockReset()
  unlinkIdentityMock.mockReset()
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('AccountPanel', () => {
  it('lists each linked identity with its provider label and email', async () => {
    const user = makeUser([
      makeIdentity({ id: 1, provider: 'github', email: 'alice@personal.com' }),
      makeIdentity({ id: 2, provider: 'google', email: 'alice@work.com' }),
      makeIdentity({ id: 3, provider: 'discord', email: 'alice@community.com' }),
    ])
    render(
      <AccountPanel open onOpenChange={() => {}} user={user} refresh={async () => {}} />,
    )
    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Google')).toBeInTheDocument()
    expect(screen.getByText('Discord')).toBeInTheDocument()
    // Primary email shows in the profile section; the per-identity email
    // shows alongside the provider chip below.
    expect(screen.getAllByText('alice@personal.com').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('alice@work.com')).toBeInTheDocument()
    expect(screen.getByText('alice@community.com')).toBeInTheDocument()
  })

  it('calls unlinkIdentity and refreshes when a non-last identity disconnects', async () => {
    const user = makeUser([
      makeIdentity({ id: 1, provider: 'github' }),
      makeIdentity({ id: 2, provider: 'google', email: 'alice@work.com' }),
    ])
    unlinkIdentityMock.mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<AccountPanel open onOpenChange={() => {}} user={user} refresh={refresh} />)

    const disconnectButtons = await screen.findAllByRole('button', { name: /^disconnect$/i })
    await act(async () => {
      fireEvent.click(disconnectButtons[1])
    })
    await waitFor(() => {
      expect(unlinkIdentityMock).toHaveBeenCalledWith(2)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('disables Disconnect when only one identity remains', async () => {
    const user = makeUser([makeIdentity({ id: 1, provider: 'github' })])
    render(<AccountPanel open onOpenChange={() => {}} user={user} refresh={async () => {}} />)
    const disconnect = await screen.findByRole('button', { name: /^disconnect$/i })
    expect(disconnect).toBeDisabled()
  })

  it('renders Connect forms posting to the right link-start endpoint for unconnected OAuth providers', async () => {
    const user = makeUser([makeIdentity({ id: 1, provider: 'magic', email: 'alice@personal.com' })])
    render(<AccountPanel open onOpenChange={() => {}} user={user} refresh={async () => {}} />)
    const githubBtn = await screen.findByRole('button', { name: /connect github/i })
    const googleBtn = screen.getByRole('button', { name: /connect google/i })
    const discordBtn = screen.getByRole('button', { name: /connect discord/i })
    const appleBtn = screen.getByRole('button', { name: /connect apple/i })
    const githubForm = githubBtn.closest('form')
    const googleForm = googleBtn.closest('form')
    const discordForm = discordBtn.closest('form')
    const appleForm = appleBtn.closest('form')
    expect(githubForm).not.toBeNull()
    expect(githubForm).toHaveAttribute('action', '/api/v1/auth/link/github/start')
    expect(githubForm).toHaveAttribute('method', 'post')
    expect(googleForm).toHaveAttribute('action', '/api/v1/auth/link/google/start')
    expect(googleForm).toHaveAttribute('method', 'post')
    expect(discordForm).toHaveAttribute('action', '/api/v1/auth/link/discord/start')
    expect(discordForm).toHaveAttribute('method', 'post')
    expect(appleForm).toHaveAttribute('action', '/api/v1/auth/link/apple/start')
    expect(appleForm).toHaveAttribute('method', 'post')
  })

  it('renders an Apple identity returned by /me with its own label and chip', async () => {
    // Pins the Codex finding from PR #532: before the fix, an Apple
    // identity returned by `/me` was filtered out of `identitiesByProvider`
    // and never rendered. The Connect Apple action stays hidden on the
    // happy path where Apple is already linked.
    const user = makeUser([
      makeIdentity({ id: 1, provider: 'apple', email: 'alice@privaterelay.appleid.com' }),
    ])
    render(<AccountPanel open onOpenChange={() => {}} user={user} refresh={async () => {}} />)
    expect(await screen.findByText('Apple')).toBeInTheDocument()
    expect(screen.getByText('alice@privaterelay.appleid.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /connect apple/i })).not.toBeInTheDocument()
  })

  it('surfaces a 409 conflict from the Apple link callback redirect', async () => {
    window.history.replaceState(
      {},
      '',
      '/account?link_error=identity_already_linked&provider=apple',
    )
    const user = makeUser([makeIdentity({ id: 1, provider: 'github' })])
    render(<AccountPanel open onOpenChange={() => {}} user={user} refresh={async () => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /apple account is already linked/i,
    )
  })

  it('submits the magic-link email and shows the inbox confirmation', async () => {
    const user = makeUser([makeIdentity({ id: 1, provider: 'github' })])
    requestAccountMagicLinkMock.mockResolvedValue(undefined)
    render(<AccountPanel open onOpenChange={() => {}} user={user} refresh={async () => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /connect email/i }))
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'alice@work.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send link/i }))
    await waitFor(() => {
      expect(requestAccountMagicLinkMock).toHaveBeenCalledWith('alice@work.com')
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/check your inbox/i)
  })

  it('surfaces a 409 conflict from the OAuth callback redirect', async () => {
    window.history.replaceState(
      {},
      '',
      '/account?link_error=identity_already_linked&provider=google',
    )
    const user = makeUser([makeIdentity({ id: 1, provider: 'github' })])
    render(<AccountPanel open onOpenChange={() => {}} user={user} refresh={async () => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /google account is already linked/i,
    )
  })

  it('does not surface a conflict error for an unrelated query string', async () => {
    window.history.replaceState({}, '', '/account?ref=email')
    const user = makeUser([makeIdentity({ id: 1, provider: 'github' })])
    render(<AccountPanel open onOpenChange={() => {}} user={user} refresh={async () => {}} />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /linked sign-in methods/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
