import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import {
  requestAccountMagicLink,
  unlinkIdentity,
  type Me,
  type MeIdentity,
} from '../api/client'
import { providerIcon, type AuthProvider } from './providerIcons'
import { detailDialogContentClass } from './responsiveDialog'

type Provider = AuthProvider
type MagicMode = 'collapsed' | 'form' | 'sent' | 'error'

const PROVIDERS: { provider: Provider; label: string; connectLabel: string }[] = [
  { provider: 'github', label: 'GitHub', connectLabel: 'Connect GitHub' },
  { provider: 'google', label: 'Google', connectLabel: 'Connect Google' },
  { provider: 'discord', label: 'Discord', connectLabel: 'Connect Discord' },
  { provider: 'apple', label: 'Apple', connectLabel: 'Connect Apple' },
  { provider: 'magic', label: 'Magic link', connectLabel: 'Connect email' },
]

const OAUTH_LINK_START: Record<Exclude<Provider, 'magic'>, string> = {
  github: '/api/v1/auth/link/github/start',
  google: '/api/v1/auth/link/google/start',
  discord: '/api/v1/auth/link/discord/start',
  apple: '/api/v1/auth/link/apple/start',
}

function providerLabel(provider: string): string {
  return PROVIDERS.find((p) => p.provider === provider)?.label ?? provider
}

function initialLinkError(): { provider: Provider; message: string } | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('link_error') !== 'identity_already_linked') return null
  const provider = params.get('provider')
  if (
    provider !== 'github' &&
    provider !== 'google' &&
    provider !== 'discord' &&
    provider !== 'apple' &&
    provider !== 'magic'
  ) {
    return null
  }
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
        identity.provider === 'apple' ||
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
          className={detailDialogContentClass('lg:max-h-[88vh] lg:w-[min(520px,94vw)]')}
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
