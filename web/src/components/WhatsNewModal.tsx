/**
 * WhatsNewModal — a header-triggered release-notes panel.
 *
 * Surfaces shipped changes inside the app so returning users discover
 * features that landed since their last visit. Release data comes from the
 * shared `GET /api/v1/changelog` endpoint (the same source the marketing
 * site reads), so there's one parser and the copy never drifts.
 *
 * Discovery without nagging: the trigger button shows a small dot when a
 * release newer than the user's last-seen version has shipped. Opening the
 * panel marks the latest version seen, clearing the dot. A first-time
 * visitor (no stored version) is silently caught up to the current latest
 * — no dot — so the panel never competes with the Help button's
 * first-visit hint.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchChangelog } from '../api/client'
import { useAppStore } from '../store'
import type { ChangelogRelease } from '../types'
import { renderInlineMarkdown } from '../utils/inlineMarkdown'

const REPO_CHANGELOG_URL =
  'https://github.com/mgzwarrior/mgz-pkmn/blob/main/CHANGELOG.md'

// Section-name → badge accent. Unknown names fall back to a neutral chip.
const SECTION_ACCENT: Record<string, string> = {
  Added: 'text-emerald-400 border-emerald-400/30',
  Changed: 'text-sky-400 border-sky-400/30',
  Fixed: 'text-amber-400 border-amber-400/30',
  Removed: 'text-rose-400 border-rose-400/30',
  Deprecated: 'text-orange-400 border-orange-400/30',
  Security: 'text-violet-400 border-violet-400/30',
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function WhatsNewModal() {
  const [open, setOpen] = useState(false)
  const [releases, setReleases] = useState<ChangelogRelease[] | null>(null)
  const [error, setError] = useState(false)

  const lastSeen = useAppStore((s) => s.lastSeenChangelogVersion)
  const setLastSeen = useAppStore((s) => s.setLastSeenChangelogVersion)

  const latest = releases?.[0]?.version ?? null

  // Fetch once on mount. A failure leaves `releases` null + `error` true;
  // the button still renders (no dot) and the panel shows a fallback.
  useEffect(() => {
    let cancelled = false
    fetchChangelog(5)
      .then((data) => {
        if (!cancelled) setReleases(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Silent first-time catch-up: a visitor with no stored version is pinned
  // to the current latest so the dot never shows on a first visit.
  useEffect(() => {
    if (latest && lastSeen === null) setLastSeen(latest)
  }, [latest, lastSeen, setLastSeen])

  const hasUnseen = !!latest && lastSeen !== null && latest !== lastSeen

  function handleOpenChange(next: boolean) {
    setOpen(next)
    // Mark the latest version seen the moment the panel opens.
    if (next && latest) setLastSeen(latest)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          className="relative flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors sm:px-3"
          title="What's new"
          aria-label={hasUnseen ? "What's new (new release available)" : "What's new"}
        >
          <Sparkles size={15} />
          <span className="hidden sm:inline">What's new</span>
          {hasUnseen && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-zinc-950"
            />
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-zinc-100">
              What's new
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div
            tabIndex={0}
            className="flex-1 overflow-y-auto px-5 py-4 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {error || (releases && releases.length === 0) ? (
              <p className="text-zinc-400">
                Release notes couldn't be loaded right now. See the{' '}
                <a
                  href={REPO_CHANGELOG_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline hover:text-blue-300"
                >
                  full changelog
                </a>
                .
              </p>
            ) : releases === null ? (
              <p className="text-zinc-500">Loading release notes…</p>
            ) : (
              <ol className="space-y-8">
                {releases.map((release) => (
                  <li
                    key={release.version}
                    className="border-l border-zinc-800 pl-4"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="text-base font-semibold text-zinc-100">
                        v{release.version}
                      </h3>
                      {release.date && (
                        <time className="text-xs text-zinc-500">
                          {formatDate(release.date)}
                        </time>
                      )}
                    </div>
                    <div className="mt-3 space-y-4">
                      {release.sections.map((section) => (
                        <div key={section.name}>
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                              SECTION_ACCENT[section.name] ??
                              'text-zinc-400 border-zinc-700'
                            }`}
                          >
                            {section.name}
                          </span>
                          <ul className="mt-2 space-y-1.5">
                            {section.entries.map((entry, i) => (
                              <li key={i} className="flex gap-2 leading-relaxed">
                                <span
                                  aria-hidden="true"
                                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-600"
                                />
                                <span>{renderInlineMarkdown(entry)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex items-center justify-end border-t border-zinc-700 px-5 py-3">
            <a
              href={REPO_CHANGELOG_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
            >
              Full changelog →
            </a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
