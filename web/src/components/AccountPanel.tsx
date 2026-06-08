import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Mail, X } from 'lucide-react'
import {
  requestAccountMagicLink,
  unlinkIdentity,
  type Me,
  type MeIdentity,
} from '../api/client'

type Provider = 'github' | 'google' | 'discord' | 'magic'
type MagicMode = 'collapsed' | 'form' | 'sent' | 'error'

const PROVIDERS: { provider: Provider; label: string; connectLabel: string }[] = [
  { provider: 'github', label: 'GitHub', connectLabel: 'Connect GitHub' },
  { provider: 'google', label: 'Google', connectLabel: 'Connect Google' },
  { provider: 'discord', label: 'Discord', connectLabel: 'Connect Discord' },
  { provider: 'magic', label: 'Magic link', connectLabel: 'Connect email' },
]

const OAUTH_LINK_START: Record<Exclude<Provider, 'magic'>, string> = {
  github: '/api/v1/auth/link/github/start',
  google: '/api/v1/auth/link/google/start',
  discord: '/api/v1/auth/link/discord/start',
}

function providerIcon(provider: Provider) {
  if (provider === 'magic') return <Mail size={16} aria-hidden="true" />
  if (provider === 'github') {
    return (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    )
  }
  if (provider === 'discord') {
    return (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.3 4.4A17 17 0 0 0 16.1 3l-.2.4c-.2.4-.3.7-.5 1.1a15.8 15.8 0 0 0-6.8 0c-.2-.4-.3-.7-.5-1.1L7.9 3a17 17 0 0 0-4.2 1.4C1 8.3.3 12.1.7 15.9a17 17 0 0 0 5.2 2.6l.6-.9c.2-.3.4-.6.5-1a10.9 10.9 0 0 1-1.7-.8l.4-.3c3.3 1.5 6.9 1.5 10.2 0l.4.3c-.5.3-1.1.6-1.7.8.2.3.3.7.5 1l.6.9a17 17 0 0 0 5.2-2.6c.5-4.4-.8-8.1-2.6-11.5ZM8.3 13.6c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8a12 12 0 1 1 7.9-21l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5Z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7Z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44Z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.2-.1-2.4-.4-3.5Z" />
    </svg>
  )
}

function providerLabel(provider: string): string {
  return PROVIDERS.find((p) => p.provider === provider)?.label ?? provider
}

function initialLinkError(): { provider: Provider; message: string } | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('link_error') !== 'identity_already_linked') return null
  const provider = params.get('provider')
  if (provider !== 'github' && provider !== 'google' && provider !== 'discord' && provider !== 'magic') return null
  return {
    provider,
    message: `That ${providerLabel(provider)} account is already linked to another mgz-pkmn account.`,
  }
}

interface AccountPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Me
  refresh: () => Promise<void>
}

export function AccountPanel({ open, onOpenChange, user, refresh }: AccountPanelProps) {
  const [busyIdentityId, setBusyIdentityId] = useState<number | null>(null)
  const [magicMode, setMagicMode] = useState<MagicMode>('collapsed')
  const [magicEmail, setMagicEmail] = useState('')
  const [providerError, setProviderError] = useState<{ provider: Provider; message: string } | null>(
    () => initialLinkError(),
  )

  const identities = useMemo(() => user.identities ?? [], [user.identities])
  const identitiesByProvider = useMemo(() => {
    const grouped = new Map<Provider, MeIdentity[]>()
    for (const identity of identities) {
      if (
        identity.provider === 'github' ||
        identity.provider === 'google' ||
        identity.provider === 'discord' ||
        identity.provider === 'magic'
      ) {
        const provider = identity.provider
        grouped.set(provider, [...(grouped.get(provider) ?? []), identity])
      }
    }
    return grouped
  }, [identities])
  const canDisconnect = identities.length > 1

  function handleOpenChange(next: boolean) {
    if (!next) {
      setMagicMode('collapsed')
      setMagicEmail('')
      if (typeof window !== 'undefined' && window.location.pathname === '/account') {
        window.history.replaceState({}, '', '/')
      }
    }
    onOpenChange(next)
  }

  async function disconnect(identity: MeIdentity) {
    setBusyIdentityId(identity.id)
    setProviderError(null)
    try {
      await unlinkIdentity(identity.id)
      await refresh()
    } catch {
      setProviderError({
        provider: identity.provider as Provider,
        message: canDisconnect
          ? `Couldn't disconnect ${providerLabel(identity.provider)}. Try again in a moment.`
          : 'Keep at least one sign-in method connected.',
      })
    } finally {
      setBusyIdentityId(null)
    }
  }

  async function requestMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!magicEmail.trim()) return
    setProviderError(null)
    setMagicMode('form')
    try {
      await requestAccountMagicLink(magicEmail.trim())
      setMagicMode('sent')
    } catch {
      setMagicMode('error')
    }
  }

  const label = user.display_name?.trim() || user.email || 'Account'

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 dark:bg-husk-500/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-sand-300 bg-sand-50 shadow-2xl dark:border-husk-50 dark:bg-husk-200"
        >
          <div className="flex items-center justify-between border-b border-sand-300 px-5 py-4 dark:border-husk-50">
            <Dialog.Title className="text-base font-semibold text-coconut-700 dark:text-sand-50">
              Account
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded p-1 text-coconut-400 hover:bg-sand-200 hover:text-coconut-700 dark:text-sand-300 dark:hover:bg-husk-100 dark:hover:text-sand-50 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-5 overflow-y-auto px-5 py-5">
            <section className="space-y-1">
              <h2 className="text-xs font-semibold uppercase text-coconut-400 dark:text-sand-300">
                Profile
              </h2>
              <div className="text-sm font-medium text-coconut-700 dark:text-sand-50">
                {label}
              </div>
              {user.email && (
                <div className="text-sm text-coconut-500 dark:text-sand-300">{user.email}</div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase text-coconut-400 dark:text-sand-300">
                Linked sign-in methods
              </h2>

              <div className="space-y-2">
                {identities.map((identity) => (
                  <div
                    key={identity.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-sand-300 bg-sand-100 px-3 py-2 dark:border-husk-50 dark:bg-husk-100"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-coconut-700 dark:text-sand-50">
                        {providerIcon(identity.provider as Provider)}
                        <span>{providerLabel(identity.provider)}</span>
                      </div>
                      {identity.email && (
                        <div className="truncate text-xs text-coconut-500 dark:text-sand-300">
                          {identity.email}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!canDisconnect || busyIdentityId === identity.id}
                      onClick={() => void disconnect(identity)}
                      className="rounded-md border border-sand-300 px-2.5 py-1.5 text-xs font-medium text-coconut-700 hover:bg-sand-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-husk-50 dark:text-sand-50 dark:hover:bg-husk-50"
                    >
                      {busyIdentityId === identity.id ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </div>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {PROVIDERS.map(({ provider, connectLabel }) => {
                  const connected = (identitiesByProvider.get(provider) ?? []).length > 0
                  if (connected) return null
                  if (provider === 'magic') {
                    return (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => setMagicMode('form')}
                        className="flex items-center justify-center gap-2 rounded-md border border-sand-300 bg-sand-50 px-3 py-2 text-sm font-medium text-coconut-700 hover:bg-sand-100 dark:border-husk-50 dark:bg-husk-200 dark:text-sand-50 dark:hover:bg-husk-100"
                      >
                        {providerIcon(provider)}
                        {connectLabel}
                      </button>
                    )
                  }
                  return (
                    <form key={provider} method="post" action={OAUTH_LINK_START[provider]}>
                      <button
                        type="submit"
                        className="flex w-full items-center justify-center gap-2 rounded-md border border-sand-300 bg-sand-50 px-3 py-2 text-sm font-medium text-coconut-700 hover:bg-sand-100 dark:border-husk-50 dark:bg-husk-200 dark:text-sand-50 dark:hover:bg-husk-100"
                      >
                        {providerIcon(provider)}
                        {connectLabel}
                      </button>
                    </form>
                  )
                })}
              </div>

              {magicMode === 'form' || magicMode === 'error' ? (
                <form onSubmit={requestMagicLink} className="space-y-2">
                  <label
                    htmlFor="account-magic-email"
                    className="block text-xs font-medium text-coconut-600 dark:text-sand-200"
                  >
                    Email
                  </label>
                  <input
                    id="account-magic-email"
                    type="email"
                    required
                    value={magicEmail}
                    onChange={(e) => setMagicEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-md border border-sand-300 bg-sand-50 px-3 py-2 text-sm text-coconut-700 placeholder:text-coconut-400 focus:border-palm-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:placeholder:text-sand-400 dark:focus:border-sun-300 dark:focus:ring-sun-300"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-palm-500 px-3 py-2 text-sm font-medium text-sand-50 hover:bg-palm-600 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200"
                  >
                    Send link
                  </button>
                  {magicMode === 'error' && (
                    <p role="alert" className="text-xs text-red-600 dark:text-red-300">
                      Couldn&apos;t send the link. Try again in a moment.
                    </p>
                  )}
                </form>
              ) : null}

              {magicMode === 'sent' && (
                <p
                  role="status"
                  className="rounded-md border border-palm-300 bg-palm-50 px-3 py-2 text-sm text-palm-700 dark:border-palm-500 dark:bg-palm-500/15 dark:text-palm-100"
                >
                  Check your inbox to finish connecting that email.
                </p>
              )}

              {providerError && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-300">
                  {providerError.message}
                </p>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
