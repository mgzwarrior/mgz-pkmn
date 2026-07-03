/**
 * SignInChip — the header's authentication surface.
 *
 * Anonymous → renders a "Sign in" button that opens the provider picker
 * (GitHub / Google / magic link). The OAuth providers are anchor-style
 * full-page redirects to `/api/v1/auth/{provider}/login`; the magic-
 * link button expands inline into an email field that POSTs to
 * `/api/v1/auth/magic/request` and then shows a "check your email"
 * confirmation.
 *
 * Signed in → renders the user's `display_name` (or initials avatar
 * fallback) inside a dropdown that exposes a "Sign out" item, which
 * POSTs to `/api/v1/auth/logout` and refreshes the local state.
 *
 * Backed by the `useAuth` hook so the chip's state survives the
 * OAuth round-trip — when the provider's callback 302s back to `/`,
 * the hook's mount-time `fetchMe()` flips the chip to the signed-in
 * shape without the SPA having to thread anything through the URL.
 */
import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LogIn, LogOut, UserRound, X } from 'lucide-react'
import { requestMagicLink, type Me } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { AccountPanel } from './AccountPanel'
import { providerIcon } from './providerIcons'
import { detailDialogContentClass } from './responsiveDialog'

const GITHUB_LOGIN_URL = '/api/v1/auth/github/login'
const GOOGLE_LOGIN_URL = '/api/v1/auth/google/login'
const DISCORD_LOGIN_URL = '/api/v1/auth/discord/login'
const APPLE_LOGIN_URL = '/api/v1/auth/apple/login'

function initialsFor(user: Me): string {
  const source = (user.display_name || user.email || '').trim()
  if (!source) return '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export function SignInChip() {
  const { user, authEnabled, loading, refresh, signOut } = useAuth()
  const [pickerOpen, setPickerOpen] = useState(false)
  // The link-callback redirects to `/account` so the SPA can land the
  // user back on the linked-providers list; open the panel on first
  // render when we see that path.
  const [accountOpen, setAccountOpen] = useState(
    () => typeof window !== 'undefined' && window.location.pathname === '/account',
  )

  // Self-host (auth off) has no sign-in surface to render — `/me`
  // already attaches the sentinel default user so collections /
  // wishlists work without a chip. Hide entirely rather than show a
  // disabled chip the user can't act on.
  if (!loading && !authEnabled) {
    return null
  }

  if (loading) {
    // Reserve the icon-button footprint so the header doesn't reflow
    // when /me resolves. Aria-busy lets screen readers skip the placeholder.
    return (
      <div
        aria-busy="true"
        aria-label="Loading sign-in state"
        className="h-9 w-9 animate-pulse rounded-md bg-sand-200 dark:bg-husk-100"
      />
    )
  }

  if (user) {
    const label = user.display_name?.trim() || user.email || 'Account'
    return (
      <>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-coconut-500 hover:bg-sand-100 hover:text-coconut-700 dark:text-sand-200 dark:hover:bg-husk-100 dark:hover:text-sand-50 transition"
              aria-label={`Account menu for ${label}`}
              title={label}
              data-tour="account"
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-palm-300 text-[10px] font-semibold text-coconut-700 dark:bg-palm-500 dark:text-sand-50"
              >
                {initialsFor(user)}
              </span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-[10rem] rounded-md border border-sand-300 bg-sand-50 p-1 text-sm text-coconut-700 shadow-lg dark:border-husk-50 dark:bg-husk-200 dark:text-sand-50"
            >
              {(user.display_name || user.email) && (
                <div className="px-3 py-1.5">
                  {user.display_name && (
                    <div className="truncate text-sm font-medium text-coconut-700 dark:text-sand-50">
                      {user.display_name}
                    </div>
                  )}
                  {user.email && (
                    <div className="truncate text-xs text-coconut-400 dark:text-sand-300">
                      {user.email}
                    </div>
                  )}
                </div>
              )}
              <DropdownMenu.Separator className="my-1 h-px bg-sand-200 dark:bg-husk-100" />
              <DropdownMenu.Item
                onSelect={() => setAccountOpen(true)}
                className="flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 outline-none data-[highlighted]:bg-sand-200 data-[highlighted]:text-coconut-700 dark:data-[highlighted]:bg-husk-100 dark:data-[highlighted]:text-sand-50"
              >
                <UserRound size={14} />
                <span>Account</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => void signOut()}
                className="flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 outline-none data-[highlighted]:bg-sand-200 data-[highlighted]:text-coconut-700 dark:data-[highlighted]:bg-husk-100 dark:data-[highlighted]:text-sand-50"
              >
                <LogOut size={14} />
                <span>Sign out</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <AccountPanel
          open={accountOpen}
          onOpenChange={setAccountOpen}
          user={user}
          refresh={refresh}
        />
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-coconut-500 hover:bg-sand-100 hover:text-coconut-700 dark:text-sand-200 dark:hover:bg-husk-100 dark:hover:text-sand-50 transition"
        aria-label="Sign in"
        title="Sign in"
        data-tour="signin"
      >
        <LogIn size={18} />
      </button>
      <ProviderPickerModal open={pickerOpen} onOpenChange={setPickerOpen} />
    </>
  )
}

interface ProviderPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  intent?: 'default' | 'save-search'
}

export function ProviderPickerModal({
  open,
  onOpenChange,
  intent = 'default',
}: ProviderPickerProps) {
  const [magicMode, setMagicMode] = useState<'collapsed' | 'form' | 'sent' | 'error'>('collapsed')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Request-generation guard. Closing the picker mid-request (or
  // starting a second submit) bumps the ref; the in-flight resolution
  // handlers compare their captured generation against the current one
  // and no-op when stale, so a late "sent"/"error" can't leak into a
  // later picker session.
  const requestGenRef = useRef(0)

  function reset() {
    requestGenRef.current += 1
    setMagicMode('collapsed')
    setEmail('')
    setSubmitting(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function handleMagicSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || submitting) return
    const myGen = ++requestGenRef.current
    setSubmitting(true)
    try {
      await requestMagicLink(email.trim())
      if (requestGenRef.current === myGen) setMagicMode('sent')
    } catch {
      if (requestGenRef.current === myGen) setMagicMode('error')
    } finally {
      if (requestGenRef.current === myGen) setSubmitting(false)
    }
  }

  const title =
    intent === 'save-search' ? 'Sign in to save this search' : 'Sign in to mgz-pkmn'
  const description =
    intent === 'save-search'
      ? 'Saved searches are tied to your account. Lookups and exports stay available without signing in.'
      : 'Sign in to keep saved searches across sessions. Lookups and exports don\'t require an account.'

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-coconut-700/50 dark:bg-husk-500/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className={detailDialogContentClass('lg:w-[min(420px,92vw)]')}
        >
          <div className="flex items-center justify-between border-b border-sand-300 px-5 py-4 dark:border-husk-50">
            <Dialog.Title className="text-base font-semibold text-coconut-700 dark:text-sand-50">
              {title}
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

          <div className="space-y-3 px-5 py-5">
            <p className="text-xs text-coconut-400 dark:text-sand-300">
              {description}
            </p>

            <a
              href={GITHUB_LOGIN_URL}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-sand-300 bg-sand-100 px-4 py-2 text-sm font-medium text-coconut-700 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:hover:bg-husk-50 transition-colors"
            >
              {providerIcon('github')}
              Continue with GitHub
            </a>

            <a
              href={GOOGLE_LOGIN_URL}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-sand-300 bg-sand-100 px-4 py-2 text-sm font-medium text-coconut-700 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:hover:bg-husk-50 transition-colors"
            >
              {providerIcon('google')}
              Continue with Google
            </a>

            <a
              href={DISCORD_LOGIN_URL}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-sand-300 bg-sand-100 px-4 py-2 text-sm font-medium text-coconut-700 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:hover:bg-husk-50 transition-colors"
            >
              {providerIcon('discord')}
              Continue with Discord
            </a>

            {/*
              Sign in with Apple. Apple's HIG locks this button down: official
              logo glyph, prescribed copy ("Sign in with Apple" / "Continue
              with Apple"), minimum tap target (44pt — the px-4 py-2 + text-sm
              footprint clears it), and only the black/white/black-bordered-
              white color pairings. We use black-on-white in light mode and
              white-on-black in dark mode to stay inside the approved palette
              regardless of the surrounding theme.
              Reference: https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
            */}
            <a
              href={APPLE_LOGIN_URL}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-black bg-black px-4 py-2 text-sm font-medium text-white hover:bg-husk-500 dark:border-white dark:bg-white dark:text-black dark:hover:bg-sand-100 transition-colors"
            >
              {providerIcon('apple')}
              Continue with Apple
            </a>

            {magicMode === 'collapsed' && (
              <button
                type="button"
                onClick={() => setMagicMode('form')}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-sand-300 bg-sand-100 px-4 py-2 text-sm font-medium text-coconut-700 hover:bg-sand-200 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:hover:bg-husk-50 transition-colors"
              >
                {providerIcon('magic')}
                Email me a magic link
              </button>
            )}

            {(magicMode === 'form' || magicMode === 'error') && (
              <form onSubmit={handleMagicSubmit} className="space-y-2">
                <label htmlFor="magic-email" className="block text-xs font-medium text-coconut-600 dark:text-sand-200">
                  Email
                </label>
                <input
                  id="magic-email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-sand-300 bg-sand-50 px-3 py-2 text-sm text-coconut-700 placeholder:text-coconut-400 focus:border-palm-400 focus:outline-none focus:ring-1 focus:ring-palm-400 dark:border-husk-50 dark:bg-husk-100 dark:text-sand-50 dark:placeholder:text-sand-400 dark:focus:border-sun-300 dark:focus:ring-sun-300"
                />
                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-palm-500 px-4 py-2 text-sm font-medium text-sand-50 hover:bg-palm-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sun-300 dark:text-husk-500 dark:hover:bg-sun-200 transition-colors"
                >
                  {submitting ? 'Sending…' : 'Send magic link'}
                </button>
                {magicMode === 'error' && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-300">
                    Couldn&apos;t send the link. Try again in a moment.
                  </p>
                )}
              </form>
            )}

            {magicMode === 'sent' && (
              <div
                role="status"
                className="rounded-md border border-palm-300 bg-palm-50 px-3 py-2 text-sm text-palm-700 dark:border-palm-500 dark:bg-palm-500/15 dark:text-palm-100"
              >
                Check your inbox for a sign-in link.
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
